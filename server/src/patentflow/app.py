"""应用工厂:create_app(settings) —— 单进程内网部署。"""
from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import timeutil
from .bootstrap import ensure_bootstrap
from .config import Settings, load_settings
from .db import Database
from .domain.errors import DomainError
from .notify import Notifier, WebhookNotifier


async def sync_webhook(app: FastAPI) -> None:
    """回调地址以 GL 在界面中的配置为准,未配置时回退部署配置。"""
    from .domain.sysconfig import get_system

    n = app.state.notifier
    if isinstance(n, WebhookNotifier):
        cfg = await get_system(app.state.db.reader)
        n.url = cfg.get("webhookUrl") or app.state.settings.webhook_url


def create_app(settings: Settings | None = None, notifier: Notifier | None = None) -> FastAPI:
    settings = settings or load_settings()
    timeutil.set_timezone(settings.timezone)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        db = Database(settings.db_path)
        await db.connect()
        app.state.db = db
        await ensure_bootstrap(db, settings)
        await sync_webhook(app)
        from .scheduler import reminder_loop

        task = asyncio.create_task(reminder_loop(app)) if settings.reminder_interval_seconds > 0 else None
        try:
            yield
        finally:
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            await db.close()

    app = FastAPI(title="PATENTFLOW", version="0.2.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.notifier = notifier or WebhookNotifier(settings.webhook_url, settings.webhook_secret)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
            allow_methods=["*"], allow_headers=["*"],
        )

    @app.exception_handler(DomainError)
    async def _domain_error(_: Request, e: DomainError) -> JSONResponse:
        return JSONResponse({"code": e.code, "message": e.message, **e.extra}, status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, e: RequestValidationError) -> JSONResponse:
        return JSONResponse({"code": "invalid", "message": "请求参数不合法", "detail": e.errors()}, status_code=422)

    from .api import register_routers

    register_routers(app)

    # 生产部署:同源托管前端构建产物(SPA 回退到 index.html)
    if settings.static_dir and Path(settings.static_dir).is_dir():
        static = Path(settings.static_dir).resolve()
        app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str) -> FileResponse:
            f = (static / path).resolve()
            # 只返回发布目录内的文件,其余(含 ../ 穿越)一律回退到 index.html
            if path and f.is_file() and f.is_relative_to(static):
                return FileResponse(f)
            return FileResponse(static / "index.html")

    return app
