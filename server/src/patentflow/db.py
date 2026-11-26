"""SQLite 存储层:WAL 模式 + 全局写锁(写串行、读并发)。

- 写:单写连接,`async with db.tx()` 持有 asyncio.Lock 并开启 BEGIN IMMEDIATE 事务
- 读:独立读连接,WAL 下与写互不阻塞
- 乐观锁:patents.rev / stage_data.version,冲突由业务层返回 409
"""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import aiosqlite

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, pl_id TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('user','pl','gl')),
  team_id TEXT NOT NULL REFERENCES teams(id),
  password_hash TEXT,
  session_epoch INTEGER NOT NULL DEFAULT 0,   -- 改密/改角色/停用时 +1,使旧会话失效
  deactivated_at TEXT, deactivated_by TEXT,
  created_at TEXT NOT NULL
);

-- SSO 绑定:(issuer, subject) 多对一绑定本地用户
CREATE TABLE IF NOT EXISTS external_identities (
  issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  bound_at TEXT NOT NULL, PRIMARY KEY (issuer, subject)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  epoch INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read','read-write')),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS patents (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  visibility TEXT NOT NULL CHECK (visibility IN ('private','team','public')),
  stage TEXT NOT NULL,
  cross_cycle INTEGER NOT NULL DEFAULT 0,
  collaborators TEXT NOT NULL DEFAULT '[]',
  due_dates TEXT NOT NULL DEFAULT '{}',
  needs_recheck TEXT NOT NULL DEFAULT '[]',
  notify TEXT NOT NULL DEFAULT '[]',
  archived TEXT,                       -- JSON {kind, at, by, reason}
  review_round INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1       -- 乐观锁
);

-- 阶段数据:只追加,当前内容 = 最大 version
CREATE TABLE IF NOT EXISTS stage_data (
  patent_id TEXT NOT NULL REFERENCES patents(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, version INTEGER NOT NULL,
  data TEXT NOT NULL, author_id TEXT NOT NULL, at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (patent_id, stage, version)
);

CREATE TABLE IF NOT EXISTS review_assignments (
  patent_id TEXT NOT NULL REFERENCES patents(id) ON DELETE CASCADE,
  round INTEGER NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  invited_by TEXT NOT NULL, invited_at TEXT NOT NULL, due_date TEXT,
  declined_at TEXT, decline_reason TEXT,
  score TEXT,                          -- JSON ReviewScore
  PRIMARY KEY (patent_id, round, user_id)
);

CREATE TABLE IF NOT EXISTS review_rounds (
  patent_id TEXT NOT NULL REFERENCES patents(id) ON DELETE CASCADE,
  round INTEGER NOT NULL, closed_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('passed','rejected','superseded')),
  PRIMARY KEY (patent_id, round)
);

CREATE TABLE IF NOT EXISTS transitions (
  id TEXT PRIMARY KEY, patent_id TEXT NOT NULL REFERENCES patents(id) ON DELETE CASCADE,
  from_stage TEXT, to_stage TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('advance','rollback','reject','archive','unarchive')),
  operator_id TEXT NOT NULL, at TEXT NOT NULL, reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_transitions_patent ON transitions(patent_id, at);

CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY, patent_id TEXT NOT NULL REFERENCES patents(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, old_due TEXT NOT NULL, new_due TEXT NOT NULL, reason TEXT NOT NULL,
  by_user TEXT NOT NULL, at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied','pending','rejected','void')),
  approved_by TEXT, self_approved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','closed')), closed_at TEXT
);

CREATE TABLE IF NOT EXISTS kpi_rules (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('team','global')), team_id TEXT,
  cycle_id TEXT NOT NULL REFERENCES cycles(id),
  targets TEXT NOT NULL, scoring TEXT NOT NULL, scorer_hook TEXT,
  enabled INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, rule_id TEXT NOT NULL,
  frozen_at TEXT NOT NULL, overall REAL NOT NULL, items TEXT NOT NULL
);

-- 站内通知(每人一份收件箱);外部投递经 Notifier 回调
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  event TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0, patent_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications(user_id, at);

-- 截止提醒去重
CREATE TABLE IF NOT EXISTS reminder_log (key TEXT PRIMARY KEY, at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS user_prefs (user_id TEXT PRIMARY KEY REFERENCES users(id), prefs TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def dumps(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def loads(s: str | None, default: Any = None) -> Any:
    return default if s is None else json.loads(s)


class Database:
    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = asyncio.Lock()
        self.writer: aiosqlite.Connection | None = None
        self.reader: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        self.writer = await self._open()
        await self.writer.executescript(SCHEMA)
        await self.writer.commit()
        # :memory: 无法跨连接共享,测试时读写共用一个连接
        self.reader = self.writer if self.path == ":memory:" else await self._open()

    async def _open(self) -> aiosqlite.Connection:
        conn = await aiosqlite.connect(self.path, isolation_level=None)
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.execute("PRAGMA busy_timeout=5000")
        return conn

    async def close(self) -> None:
        if self.reader is not None and self.reader is not self.writer:
            await self.reader.close()
        if self.writer is not None:
            await self.writer.close()

    @asynccontextmanager
    async def tx(self) -> AsyncIterator[aiosqlite.Connection]:
        """写事务:全局写锁 + BEGIN IMMEDIATE,异常回滚。"""
        assert self.writer is not None
        async with self._lock:
            await self.writer.execute("BEGIN IMMEDIATE")
            try:
                yield self.writer
            except BaseException:
                await self.writer.execute("ROLLBACK")
                raise
            else:
                await self.writer.execute("COMMIT")

    async def all(self, sql: str, params: tuple | list = ()) -> list[aiosqlite.Row]:
        assert self.reader is not None
        async with self.reader.execute(sql, params) as cur:
            return list(await cur.fetchall())

    async def one(self, sql: str, params: tuple | list = ()) -> aiosqlite.Row | None:
        assert self.reader is not None
        async with self.reader.execute(sql, params) as cur:
            return await cur.fetchone()
