"""测试辅助:直接写库建团队/用户(跳过 API),并提供登录后的客户端。"""
from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient

from patentflow.security import hash_password, sha256

PWD = "secret123"


def db_exec(client: TestClient, sql: str, params: tuple = ()) -> None:
    path = client.app.state.settings.db_path  # type: ignore[attr-defined]
    with sqlite3.connect(path) as c:
        c.execute(sql, params)


def add_team(client: TestClient, tid: str, name: str, pl: str | None = None) -> None:
    db_exec(client, "INSERT OR REPLACE INTO teams(id, name, pl_id) VALUES(?,?,?)", (tid, name, pl))


def add_user(client: TestClient, uid: str, role: str = "user", team: str = "t1", email: str | None = None) -> str:
    email = email or f"{uid}@corp.local"
    db_exec(
        client,
        "INSERT INTO users(id, name, email, title, role, team_id, password_hash, created_at) VALUES(?,?,?,?,?,?,?,?)",
        (uid, uid.upper(), email, "", role, team, hash_password(PWD), "2026-01-01 00:00"),
    )
    db_exec(
        client,
        "INSERT INTO api_tokens(id, user_id, name, token_hash, prefix, scope, created_at, expires_at) VALUES(?,?,?,?,?,?,?,?)",
        (f"tk-{uid}", uid, "test", sha256(f"tok-{uid}"), "tok", "read-write", "2026-01-01 00:00", "2099-01-01"),
    )
    return email


def H(uid: str) -> dict[str, str]:
    """以某用户身份调用 API 的请求头"""
    return {"Authorization": f"Bearer tok-{uid}"}


def world(client: TestClient) -> None:
    """标准测试数据:两个团队、各角色成员、一个进行中的周期。"""
    add_team(client, "t1", "平台组", "pl1")
    add_team(client, "t2", "算法组", "pl2")
    for uid, role, team in [("u1", "user", "t1"), ("u2", "user", "t1"), ("u3", "user", "t2"),
                            ("pl1", "pl", "t1"), ("pl2", "pl", "t2"), ("gl", "gl", "t1"),
                            ("r1", "user", "t2"), ("r2", "user", "t2"), ("r3", "user", "t2")]:
        add_user(client, uid, role, team)
    db_exec(client, "INSERT INTO cycles(id, name, start, end, status) VALUES('c26', '2026', '2026-01-01', '2026-12-31', 'active')")
