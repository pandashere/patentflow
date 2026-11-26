"""延期(分级审批)、催办、跨周期。

- 同一阶段累计已生效延期 + 本次 ≤ GL 阈值 → 自动生效,否则挂起待本组 PL / GL 审批
- 不可超出所属周期结束日(跨周期项目除外)
- PL 可审批自己专利的延期(决策 35),记录 selfApproved 留痕
"""
from __future__ import annotations

from ..security import new_id
from ..timeutil import days_between, now
from . import access
from .common import bump, get_operable, patent_cycle, get_visible, label, overdue_days
from .ctx import Ctx
from .errors import bad_request, conflict, forbidden, not_found
from .notifications import notify


async def request_extension(ctx: Ctx, pid: str, new_due: str, reason: str, stage: str | None = None) -> str:
    p = await get_operable(ctx, pid)
    if stage and stage != p["stage"]:
        raise conflict(f"专利已进入「{label(p['stage'])}」阶段,请按当前阶段的截止日重新填写延期")
    old = p["dueDates"].get(p["stage"])
    if not reason.strip():
        raise bad_request("请填写延期原因")
    if not old or new_due <= old:
        raise bad_request("新截止日必须晚于当前截止日")
    c = await patent_cycle(ctx.conn, p)
    if c and not p["crossCycle"] and new_due > c["end"]:
        raise bad_request(f"超出所属周期结束日({c['end']}),跨周期项目请由 GL 标记", code="beyond_cycle")
    if any(e["status"] == "pending" and e["stage"] == p["stage"] for e in p["extensions"]):
        raise conflict("本阶段已有待审批的延期申请")
    days = days_between(old, new_due)
    used = sum(days_between(e["oldDue"], e["newDue"]) for e in p["extensions"]
               if e["stage"] == p["stage"] and e["status"] == "applied")
    auto = used + days <= int(ctx.cfg["overdue"]["extensionApprovalThreshold"])
    if not auto and p["visibility"] == "private" and ctx.me["role"] == "user":
        # 私有草案对 PL/GL 不可见,无人能审批;PL/GL 负责人可按决策 35 自批
        raise bad_request(f"私有草案的延期需在 {ctx.cfg['overdue']['extensionApprovalThreshold']} 天内"
                          "(含已生效延期);如需更长,请先改为团队可见再申请审批", code="private_over_threshold")
    status = "applied" if auto else "pending"
    await ctx.conn.execute(
        """INSERT INTO extensions(id, patent_id, stage, old_due, new_due, reason, by_user, at, status)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (new_id("ex"), pid, p["stage"], old, new_due, reason.strip(), ctx.me["id"], now(), status),
    )
    if auto:
        await bump(ctx, pid, due_dates={**p["dueDates"], p["stage"]: new_due})
    else:
        await bump(ctx, pid)
    text = (f"《{p['title']}》{label(p['stage'])}阶段延期 {days} 天(自动生效)" if auto else
            f"{ctx.me['name']} 申请《{p['title']}》{label(p['stage'])}阶段延期 {days} 天,待 PL/GL 批准")
    await notify(ctx, "due", text, p)
    return status


async def review_extension(ctx: Ctx, pid: str, ext_id: str, approve: bool) -> None:
    p = await get_visible(ctx, pid)
    self_owned = p["ownerId"] == ctx.me["id"] and ctx.me["role"] in ("pl", "gl")
    if not (self_owned or (access.is_team_manager(ctx.me, p) and p["visibility"] != "private")):
        raise forbidden("仅本组 PL 或 GL 可审批延期")
    e = next((x for x in p["extensions"] if x["id"] == ext_id), None)
    if not e:
        raise not_found("延期申请")
    if e["status"] != "pending":
        raise conflict("该申请已处理或已作废")
    if approve:
        # 批准时按当前跨周期标记与周期结束日复核(申请后 GL 可能取消了跨周期标记)
        c = await patent_cycle(ctx.conn, p)
        if c and not p["crossCycle"] and e["newDue"] > c["end"]:
            raise conflict(f"申请的截止日已超出所属周期结束日({c['end']}),只能驳回", reason="beyond_cycle")
    self_approved = 1 if (e["by"] == ctx.me["id"] or p["ownerId"] == ctx.me["id"]) else 0
    await ctx.conn.execute(
        "UPDATE extensions SET status = ?, approved_by = ?, self_approved = ? WHERE id = ?",
        ("applied" if approve else "rejected", ctx.me["id"], self_approved, ext_id),
    )
    if approve:
        await bump(ctx, pid, due_dates={**p["dueDates"], e["stage"]: e["newDue"]})
    else:
        await bump(ctx, pid)
    await notify(ctx, "due", f"《{p['title']}》{label(e['stage'])}阶段延期申请已{'批准' if approve else '驳回'}({ctx.me['name']})",
                 p, extra=[e["by"]])


async def nudge(ctx: Ctx, pid: str) -> None:
    """手动催办(不做自动升级)。"""
    p = await get_visible(ctx, pid)
    if not access.is_team_manager(ctx.me, p):
        raise forbidden("仅本组 PL 或 GL 可催办")
    days = overdue_days(p)
    await notify(ctx, "due", f"{ctx.me['name']} 催办:《{p['title']}》{label(p['stage'])}阶段"
                 + (f"已逾期 {days} 天" if days else "临近截止") + ",请尽快处理",
                 p, only=[p["ownerId"], *p["collaborators"]])
