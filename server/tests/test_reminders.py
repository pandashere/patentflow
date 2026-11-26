from __future__ import annotations

import asyncio
from datetime import datetime

from patentflow import timeutil
from patentflow.domain.reminders import run_reminders
from tests.helpers import H, world
from tests.test_patents import mk


def run(client) -> int:  # type: ignore[no-untyped-def]
    app = client.app
    return asyncio.run(_run(app))


async def _run(app):  # type: ignore[no-untyped-def]
    # TestClient 的事件循环在另一个线程,这里用独立连接执行一次扫描
    from patentflow.db import Database

    db = Database(app.state.settings.db_path)
    await db.connect()
    try:
        return await run_reminders(db, app.state.settings, app.state.notifier)
    finally:
        await db.close()


def test_due_reminders_are_idempotent_and_follow_prefs(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]  # draft 截止 2026-12-10
    client.put("/api/me/prefs", json={"dueReminderDays": [1]}, headers=H("pl1"))
    timeutil.freeze(datetime(2026, 12, 7, 9, 0))  # 剩 3 天
    assert run(client) == 1 and run(client) == 0  # 去重
    owner = [n["text"] for n in client.get("/api/notifications", headers=H("u1")).json()]
    assert any("3 天后到期" in t for t in owner)
    assert client.get("/api/notifications", headers=H("pl1")).json() == []  # PL 只订阅了前 1 天
    timeutil.freeze(datetime(2026, 12, 9, 9, 0))
    run(client)
    assert any("1 天后到期" in n["text"] for n in client.get("/api/notifications", headers=H("pl1")).json())
    assert pid


def test_auto_nudge(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    mk(client)
    cfg = client.get("/api/config", headers=H("gl")).json()
    cfg["overdue"]["autoNudge"] = "3d"
    client.put("/api/config", json=cfg, headers=H("gl"))
    timeutil.freeze(datetime(2026, 12, 13, 9, 0))  # 逾期 3 天
    run(client)
    assert any("自动催办" in n["text"] for n in client.get("/api/notifications", headers=H("u1")).json())
