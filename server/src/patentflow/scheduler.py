"""后台定时任务(asyncio,不引入 Celery/APScheduler):扫描截止日发送提醒。实现见 domain/reminders。"""
from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI

log = logging.getLogger("patentflow.scheduler")


async def reminder_loop(app: FastAPI) -> None:
    from .domain.reminders import run_reminders

    while True:
        try:
            await run_reminders(app.state.db, app.state.settings, app.state.notifier)
        except Exception:  # noqa: BLE001
            log.exception("截止提醒扫描失败")
        await asyncio.sleep(app.state.settings.reminder_interval_seconds)
