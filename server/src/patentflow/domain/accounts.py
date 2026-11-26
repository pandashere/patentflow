"""账号相关的共用工具:一次性设置密码链接(激活 / 重置)。"""
from __future__ import annotations

import secrets
from datetime import timedelta

import aiosqlite

from ..security import sha256
from ..timeutil import now, now_dt

ACTIVATION_TTL_MINUTES = 7 * 24 * 60


async def issue_password_link(conn: aiosqlite.Connection, uid: str, base_url: str, ttl_minutes: int) -> str:
    token = secrets.token_urlsafe(24)
    await conn.execute(
        "INSERT INTO password_resets(token_hash, user_id, created_at, expires_at) VALUES(?,?,?,?)",
        (sha256(token), uid, now(), (now_dt() + timedelta(minutes=ttl_minutes)).strftime("%Y-%m-%d %H:%M")),
    )
    return f"{base_url.rstrip('/')}/reset?token={token}"
