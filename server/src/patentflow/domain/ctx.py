"""写操作上下文:持有事务连接、当前用户、业务配置与发件箱(事务提交后才投递通知)。"""
from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import aiosqlite

from ..config import Settings
from ..db import Database
from ..notify import Notifier
from .sysconfig import get_system


@dataclass
class Ctx:
    conn: aiosqlite.Connection
    me: dict[str, Any]
    cfg: dict[str, Any]
    settings: Settings
    outbox: list[dict[str, Any]] = field(default_factory=list)


@asynccontextmanager
async def write_ctx(db: Database, me: dict[str, Any], settings: Settings, notifier: Notifier) -> AsyncIterator[Ctx]:
    async with db.tx() as conn:
        ctx = Ctx(conn, me, await get_system(conn), settings)
        yield ctx
    for ev in ctx.outbox:
        await notifier.send(ev)
