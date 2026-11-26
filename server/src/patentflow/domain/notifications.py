"""通知分发:收件人解析 + 站内信落库 + 外部回调入发件箱。

收件人三级:专利级阶段配置(覆盖)→ GL 事件默认接收人 → 个人订阅偏好(事件屏蔽 / 免打扰)。
私有专利:只发给负责人与共同发明人,不受任何默认配置影响(决策 9:私有对 GL/PL 完全透明)。
安全事件(如重置密码)强制送达,不受订阅与免打扰影响。
"""
from __future__ import annotations

from typing import Any, Iterable

from ..security import new_id
from ..timeutil import now
from .ctx import Ctx
from .prefs import get_prefs, in_quiet_hours


async def _users(ctx: Ctx, ids: Iterable[str]) -> list[dict[str, Any]]:
    ids = list(dict.fromkeys(ids))
    if not ids:
        return []
    async with ctx.conn.execute(
        f"SELECT id, name, email, role, team_id FROM users WHERE id IN ({','.join('?' * len(ids))}) AND deactivated_at IS NULL",
        ids,
    ) as cur:
        return [dict(r) for r in await cur.fetchall()]


async def _team_pl(ctx: Ctx, team_id: str) -> list[str]:
    async with ctx.conn.execute(
        "SELECT id FROM users WHERE role='pl' AND team_id=? AND deactivated_at IS NULL", (team_id,)
    ) as cur:
        return [r["id"] for r in await cur.fetchall()]


async def _gls(ctx: Ctx) -> list[str]:
    async with ctx.conn.execute("SELECT id FROM users WHERE role='gl' AND deactivated_at IS NULL") as cur:
        return [r["id"] for r in await cur.fetchall()]


async def resolve_recipients(ctx: Ctx, event: str, patent: dict[str, Any] | None) -> list[str]:
    if patent is None:
        return []
    owners = [patent["ownerId"], *patent["collaborators"]]
    if patent["visibility"] == "private":
        return owners
    stage_cfg = next((n for n in patent.get("notify", []) if n.get("stage") == patent["stage"]), None)
    ids: list[str] = []
    if stage_cfg is not None:
        if event not in stage_cfg.get("events", []):
            return []
        if stage_cfg.get("includeOwner"):
            ids += owners
        if stage_cfg.get("includePl"):
            ids += await _team_pl(ctx, patent["teamId"])
        ids += stage_cfg.get("userIds", [])
    else:
        d = ctx.cfg["notifyDefaults"].get(event, {})
        if d.get("owner"):
            ids += owners
        if d.get("pl"):
            ids += await _team_pl(ctx, patent["teamId"])
        if d.get("gl"):
            ids += await _gls(ctx)
    return ids


async def notify(
    ctx: Ctx,
    event: str,
    text: str,
    patent: dict[str, Any] | None = None,
    *,
    extra: Iterable[str] = (),
    only: Iterable[str] | None = None,
    security: bool = False,
    include_actor: bool = False,
) -> list[str]:
    """分发一条通知,返回实际站内收件人 id 列表。"""
    if only is not None:
        ids = list(only)
    else:
        ids = await resolve_recipients(ctx, event, patent) + list(extra)
        if patent is not None and patent["visibility"] == "private":
            allowed = {patent["ownerId"], *patent["collaborators"]}
            ids = [i for i in ids if i in allowed]
    if not include_actor:
        ids = [i for i in ids if i != ctx.me.get("id")]
    users = await _users(ctx, ids)
    hhmm = now()[11:16]
    inbox, external = [], []
    for u in users:
        prefs = await get_prefs(ctx.conn, u["id"])
        if not security and prefs["notifyEvents"].get(event, True) is False:
            continue
        inbox.append(u)
        if security or not in_quiet_hours(prefs["quietHours"], hhmm):
            external.append(u)
    pid = patent["id"] if patent else ""
    for u in inbox:
        await ctx.conn.execute(
            "INSERT INTO notifications(id, user_id, event, text, at, read, patent_id) VALUES(?,?,?,?,?,0,?)",
            (new_id("n"), u["id"], event, text, now(), pid),
        )
    if external:
        ctx.outbox.append({
            "event": event, "text": text, "patentId": pid, "at": now(), "security": security,
            "recipients": [{"id": u["id"], "name": u["name"], "email": u["email"]} for u in external],
        })
    return [u["id"] for u in inbox]
