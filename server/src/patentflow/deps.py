"""FastAPI 依赖:数据库、当前用户(Cookie 会话 或 Bearer Token)。"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Depends, Request

from .config import Settings
from .db import Database
from .domain.errors import DomainError
from .domain.repo import load_user
from .security import sha256
from .timeutil import now, today

SESSION_COOKIE = "pf_session"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass
class Auth:
    user: dict[str, Any]
    via: str  # session | token
    scope: str  # read | read-write

    @property
    def id(self) -> str:
        return self.user["id"]


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def current_auth(request: Request, db: Database = Depends(get_db)) -> Auth:
    sid = request.cookies.get(SESSION_COOKIE)
    if sid:
        row = await db.one(
            """SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.id = ? AND s.expires_at > ? AND s.epoch = u.session_epoch
                 AND u.deactivated_at IS NULL AND u.pending_at IS NULL""",
            (sha256(sid), now()),
        )
        if row:
            user = await load_user(db.reader, row["user_id"])  # type: ignore[arg-type]
            assert user
            return Auth(user, "session", "read-write")

    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        tok = header[7:].strip()
        row = await db.one(
            """SELECT t.user_id, t.scope FROM api_tokens t JOIN users u ON u.id = t.user_id
               WHERE t.token_hash = ? AND t.revoked = 0 AND t.expires_at >= ? AND u.deactivated_at IS NULL""",
            (sha256(tok), today()),
        )
        if row:
            if row["scope"] == "read" and request.method not in SAFE_METHODS:
                raise DomainError(403, "token_read_only", "该 Token 为只读权限,不能调用写接口")
            user = await load_user(db.reader, row["user_id"])  # type: ignore[arg-type]
            assert user
            return Auth(user, "token", row["scope"])
        raise DomainError(401, "invalid_token", "Token 无效、已过期或已吊销")

    raise DomainError(401, "unauthenticated", "请先登录")


def require_gl(auth: Auth = Depends(current_auth)) -> Auth:
    if auth.user["role"] != "gl":
        raise DomainError(403, "forbidden", "仅 GL 可执行该操作")
    return auth


def link_base(request: Request) -> str:
    """生成邮件 / IM 中链接的根地址:优先使用部署配置的 public_url,避免 Host 头被伪造后链接指向他处。"""
    settings: Settings = request.app.state.settings
    return settings.public_url or str(request.base_url).rstrip("/")
