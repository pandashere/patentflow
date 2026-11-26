from __future__ import annotations

from typing import Any, Awaitable, Callable, TypeVar

from fastapi import Request

from ..deps import Auth
from ..domain.ctx import Ctx, write_ctx
from ..domain.repo import load_patent, public_patent

T = TypeVar("T")


async def run(request: Request, auth: Auth, fn: Callable[[Ctx], Awaitable[T]]) -> T:
    """在写事务中执行业务函数,提交后投递通知。"""
    app = request.app
    async with write_ctx(app.state.db, auth.user, app.state.settings, app.state.notifier) as ctx:
        return await fn(ctx)


async def patent_out(request: Request, pid: str) -> dict[str, Any] | None:
    p = await load_patent(request.app.state.db.reader, pid)
    return public_patent(p) if p else None
