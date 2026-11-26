"""截止提醒扫描(后台定时任务调用,幂等:reminder_log 去重)。

- 阶段截止:按收件人个人偏好的提前量(默认前 3 天 / 前 1 天 / 当天)提醒
- reviewer 审查截止:同样按提前量提醒 reviewer 本人;到期只提醒,不自动处理
- 自动催办:GL 开启 3d / 7d 节奏后,逾期专利每 N 天提醒负责人一次(不做自动升级)
"""
from __future__ import annotations

from ..config import Settings
from ..db import Database
from ..notify import Notifier
from ..timeutil import days_between, now, today
from .constants import stage_label
from .ctx import write_ctx
from .notifications import notify, resolve_recipients
from .prefs import get_prefs
from .repo import load_patents

SYSTEM = {"id": "system", "name": "系统", "role": "gl", "teamId": ""}


async def _once(conn, key: str) -> bool:  # type: ignore[no-untyped-def]
    cur = await conn.execute("INSERT OR IGNORE INTO reminder_log(key, at) VALUES(?, ?)", (key, now()))
    return cur.rowcount == 1


async def run_reminders(db: Database, settings: Settings, notifier: Notifier) -> int:
    sent = 0
    async with write_ctx(db, SYSTEM, settings, notifier) as ctx:
        nudge_every = {"3d": 3, "7d": 7}.get(ctx.cfg["overdue"]["autoNudge"])
        for p in await load_patents(ctx.conn):
            if p["archived"]:
                continue
            due = p["dueDates"].get(p["stage"])
            if due:
                left = days_between(today(), due)
                if 0 <= left <= 30:
                    recips = []
                    for uid in dict.fromkeys(await resolve_recipients(ctx, "due", p)):
                        if left in (await get_prefs(ctx.conn, uid))["dueReminderDays"]:
                            recips.append(uid)
                    if recips and await _once(ctx.conn, f"due:{p['id']}:{p['stage']}:{due}:{left}"):
                        when = "今天到期" if left == 0 else f"将于 {left} 天后到期"
                        sent += bool(await notify(ctx, "due", f"《{p['title']}》{stage_label(p['stage'])}阶段{when}",
                                                  p, only=recips))
                elif left < 0 and nudge_every and (-left) % nudge_every == 0:
                    if await _once(ctx.conn, f"nudge:{p['id']}:{p['stage']}:{due}:{-left}"):
                        sent += bool(await notify(
                            ctx, "due", f"自动催办:《{p['title']}》{stage_label(p['stage'])}阶段已逾期 {-left} 天",
                            p, only=[p["ownerId"], *p["collaborators"]]))
            if p["stage"] == "patentability":
                rnd = p["stageData"]["patentability"]["round"]
                for r in p["stageData"]["patentability"]["reviewers"]:
                    if r.get("score") or r.get("declined") or not r.get("dueDate") or r["userId"] == p["ownerId"]:
                        continue
                    left = days_between(today(), r["dueDate"])
                    if left in (await get_prefs(ctx.conn, r["userId"]))["dueReminderDays"] and await _once(
                        ctx.conn, f"review:{p['id']}:{rnd}:{r['userId']}:{left}"
                    ):
                        when = "今天到期" if left == 0 else f"还剩 {left} 天"
                        sent += bool(await notify(ctx, "review", f"请审查《{p['title']}》:审查截止 {r['dueDate']},{when}",
                                                  p, only=[r["userId"]]))
    return sent
