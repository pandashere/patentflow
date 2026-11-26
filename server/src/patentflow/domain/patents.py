"""专利生命周期:创建、阶段数据(版本)、推进 / 回退、可见性、归档、协作、转交、迁移、删除。"""
from __future__ import annotations

from typing import Any

from ..db import dumps
from ..security import new_id
from ..timeutil import now, today
from . import access
from .common import (
    add_transition, bump, cycle_for_new, default_due, patent_cycle, get_operable, get_visible, has_left_draft, label, overdue_days,
    void_pending_extensions,
)
from .constants import STAGE_FIELDS, STAGE_KEYS, VIS_LABEL, VISIBILITIES, stage_index
from .ctx import Ctx
from .errors import bad_request, conflict, forbidden, not_found
from .notifications import notify
from .reviews import gate_open, next_round, rejected


async def _next_code(ctx: Ctx) -> str:
    year = today()[:4]
    prefix = f"{ctx.cfg['numberPrefix']}-{year}-"
    async with ctx.conn.execute("SELECT code FROM patents WHERE code LIKE ?", (prefix + "%",)) as cur:
        nums = [int(r["code"][len(prefix):]) for r in await cur.fetchall() if r["code"][len(prefix):].isdigit()]
    return f"{prefix}{(max(nums) + 1 if nums else 1):03d}"


def _draft_code() -> str:
    # 私有草案不占用正式流水号(否则编号空缺会让 GL 推算出私有件数,违反决策 9)
    import secrets

    return f"DRAFT-{secrets.token_hex(3).upper()}"


async def publish_code(ctx: Ctx, pid: str, code: str) -> None:
    """私有草案首次变为团队可见 / 公开时分配正式编号。"""
    if code.startswith("DRAFT-"):
        await ctx.conn.execute("UPDATE patents SET code = ? WHERE id = ?", (await _next_code(ctx), pid))


async def create(ctx: Ctx, title: str, visibility: str) -> str:
    title = title.strip()
    if not title:
        raise bad_request("标题不能为空")
    if visibility not in VISIBILITIES:
        raise bad_request("可见性非法")
    pid = new_id("p")
    created = today()
    cycle = await cycle_for_new(ctx.conn, created)
    due = await default_due(ctx, "draft", {"cycleId": cycle["id"] if cycle else None, "createdAt": created})
    await ctx.conn.execute(
        """INSERT INTO patents(id, code, title, owner_id, team_id, visibility, stage, due_dates, created_at, cycle_id)
           VALUES(?,?,?,?,?,?,'draft',?,?,?)""",
        (pid, _draft_code() if visibility == "private" else await _next_code(ctx), title, ctx.me["id"],
         ctx.me["teamId"], visibility, dumps({"draft": due}), created, cycle["id"] if cycle else None),
    )
    await add_transition(ctx, pid, None, "draft", "advance", "创建专利")
    return pid


async def save_stage(ctx: Ctx, pid: str, stage: str, data: dict[str, Any], note: str,
                     base_version: int | None) -> int:
    """保存阶段数据为新版本(只增不改)。base_version 与当前版本不一致 → 409,附当前内容供前端对比。"""
    if stage not in STAGE_KEYS:
        raise not_found("阶段")
    p = await get_visible(ctx, pid)
    if not access.can_edit(ctx.me, p):
        raise forbidden()
    if p["archived"]:
        raise conflict("专利已归档,内容只读")
    if stage_index(stage) > stage_index(p["stage"]):
        raise conflict("尚未到达该阶段,不能编辑")
    fields = STAGE_FIELDS[stage]
    clean: dict[str, Any] = {}
    for k in fields:
        v = data.get(k, p["stageData"][stage].get(k))
        if k == "selfAssessment":
            v = {**p["stageData"]["patentability"]["selfAssessment"], **(v or {})}
            for dim in ("difficulty", "nonObviousness", "novelty"):
                if not 0 <= int(v.get(dim, 0)) <= 5:
                    raise bad_request("自评分数必须在 0–5 之间")
        elif not isinstance(v, str):
            raise bad_request(f"字段 {k} 必须是字符串")
        clean[k] = v
    async with ctx.conn.execute(
        "SELECT COALESCE(MAX(version), 0) v FROM stage_data WHERE patent_id = ? AND stage = ?", (pid, stage)
    ) as cur:
        current = (await cur.fetchone())["v"]
    if base_version is not None and base_version != current:
        theirs = {k: p["stageData"][stage].get(k) for k in fields}
        raise conflict("保存冲突:该阶段已被他人更新", reason="stale_version", currentVersion=current, current=theirs)
    await ctx.conn.execute(
        "INSERT INTO stage_data(patent_id, stage, version, data, author_id, at, note) VALUES(?,?,?,?,?,?,?)",
        (pid, stage, current + 1, dumps(clean), ctx.me["id"], now(), note.strip() or "更新内容"),
    )
    recheck = [s for s in p["needsRecheck"] if s != stage]
    await bump(ctx, pid, needs_recheck=recheck)
    return current + 1


async def advance(ctx: Ctx, pid: str, reason: str, rev: int | None = None) -> str:
    p = await get_operable(ctx, pid)
    if not reason.strip():
        raise bad_request("请填写推进说明")
    idx = stage_index(p["stage"])
    if idx >= len(STAGE_KEYS) - 1:
        raise conflict("已是最后一个阶段,可选择完成归档")
    nxt = STAGE_KEYS[idx + 1]
    if p["visibility"] == "private":
        raise conflict("私有专利只能停留在草案阶段,请先调整为团队可见或公开")
    if ctx.cfg["overdue"]["freezeAdvanceOnOverdue"] and overdue_days(p) > 0:
        raise conflict("当前阶段已逾期,GL 已开启「逾期冻结推进」,请先申请延期")
    if p["stage"] == "patentability" and not gate_open(p, ctx.cfg):
        msg = "本轮审查有打回,请修改后发起新一轮" if rejected(p) else (
            f"审查门禁未满足:需 {ctx.cfg['reviewPassCount']} 名 reviewer 通过(加权均分 ≥ {ctx.cfg['reviewMinWeighted']})")
        raise conflict(msg, reason="review_gate")

    # 截止日:无设定 / 已过期 / 回退后重新进入 → 按默认周期重算
    due_dates = dict(p["dueDates"])
    async with ctx.conn.execute(
        "SELECT 1 FROM transitions WHERE patent_id = ? AND kind = 'advance' AND to_stage = ? LIMIT 1", (pid, nxt)
    ) as cur:
        reentered = await cur.fetchone() is not None or nxt in p["needsRecheck"]
    existing = due_dates.get(nxt)
    if not existing or existing < today() or reentered:
        due_dates[nxt] = await default_due(ctx, nxt, p)

    await void_pending_extensions(ctx, pid)
    if p["stage"] == "patentability":
        await ctx.conn.execute(
            "INSERT OR IGNORE INTO review_rounds(patent_id, round, closed_at, outcome) VALUES(?,?,?, 'passed')",
            (pid, p["stageData"]["patentability"]["round"], now()),
        )
    if nxt == "patentability":
        await next_round(ctx, p, "rejected" if rejected(p) else "superseded")
    await bump(ctx, pid, rev, stage=nxt, due_dates=due_dates)
    await add_transition(ctx, pid, p["stage"], nxt, "advance", reason.strip())
    p["stage"] = nxt
    await notify(ctx, "transition", f"《{p['title']}》已推进至「{label(nxt)}」", p)
    return nxt


async def rollback(ctx: Ctx, pid: str, to: str, reason: str, rev: int | None = None) -> None:
    p = await get_operable(ctx, pid)
    if to not in STAGE_KEYS or stage_index(to) >= stage_index(p["stage"]):
        raise bad_request("只能回退到更早的阶段")
    if not reason.strip():
        raise bad_request("请填写回退原因")
    skipped = STAGE_KEYS[stage_index(to) + 1: stage_index(p["stage"]) + 1]
    recheck = list(dict.fromkeys([*p["needsRecheck"], *skipped]))
    await void_pending_extensions(ctx, pid)
    if to == "patentability":
        # 从后续阶段回到审查:上一轮已通过并结束,不能沿用旧票,开启新一轮(名单继承、分数清零)
        await next_round(ctx, p, "superseded")
    await bump(ctx, pid, rev, stage=to, needs_recheck=recheck)
    await add_transition(ctx, pid, p["stage"], to, "rollback", reason.strip())
    p["stage"] = to
    await notify(ctx, "transition", f"《{p['title']}》已回退至「{label(to)}」:{reason.strip()}", p)


async def set_visibility(ctx: Ctx, pid: str, v: str) -> None:
    p = await get_operable(ctx, pid)
    if v not in VISIBILITIES:
        raise bad_request("可见性非法")
    if v == p["visibility"]:
        return
    if v == "private" and await has_left_draft(ctx.conn, p):
        raise conflict("离开过草案的专利不能再设为私有")
    if v == "private":
        # 私有后 PL/GL 不可见,待批延期将无人能处理:作废,负责人可在阈值内重新申请
        await void_pending_extensions(ctx, pid)
    else:
        await publish_code(ctx, pid, p["code"])
    await bump(ctx, pid, visibility=v)
    p["visibility"] = v
    await notify(ctx, "transition", f"《{p['title']}》可见性调整为「{VIS_LABEL[v]}」", p)


async def archive(ctx: Ctx, pid: str, kind: str, reason: str) -> None:
    p = await get_operable(ctx, pid)
    if kind not in ("completed", "abandoned"):
        raise bad_request("归档类型非法")
    if not reason.strip():
        raise bad_request("请填写归档原因")
    await void_pending_extensions(ctx, pid)
    await bump(ctx, pid, archived={"kind": kind, "at": now(), "by": ctx.me["id"], "reason": reason.strip()})
    kl = "完成归档" if kind == "completed" else "放弃归档"
    await add_transition(ctx, pid, p["stage"], p["stage"], "archive", f"{kl}:{reason.strip()}")
    await notify(ctx, "transition", f"《{p['title']}》已{kl}", p)


async def unarchive(ctx: Ctx, pid: str, reason: str) -> None:
    p = await get_operable(ctx, pid, allow_archived=True)
    if not p["archived"]:
        raise conflict("专利未归档")
    if not reason.strip():
        raise bad_request("请填写恢复原因")
    await bump(ctx, pid, archived=None)
    await add_transition(ctx, pid, p["stage"], p["stage"], "unarchive", f"恢复归档:{reason.strip()}")
    await notify(ctx, "transition", f"《{p['title']}》已恢复到「{label(p['stage'])}」", p)


async def _active_user(ctx: Ctx, uid: str) -> dict[str, Any]:
    async with ctx.conn.execute(
        "SELECT * FROM users WHERE id = ? AND deactivated_at IS NULL AND pending_at IS NULL", (uid,)
    ) as cur:
        u = await cur.fetchone()
    if not u:
        raise bad_request("该成员不存在、已停用或尚未通过注册审批")
    return dict(u)


async def set_collaborators(ctx: Ctx, pid: str, ids: list[str], rev: int | None = None) -> None:
    """整表替换共同发明人。rev 用于防止旧页面把他人已移除的成员加回来;
    只校验本次新增的成员(已停用的原成员可以保留或移除)。"""
    p = await get_operable(ctx, pid)
    clean = []
    for uid in dict.fromkeys(ids):
        if uid == p["ownerId"]:
            continue
        if uid not in p["collaborators"]:
            await _active_user(ctx, uid)
        clean.append(uid)
    await bump(ctx, pid, rev, collaborators=clean)


async def save_notify(ctx: Ctx, pid: str, cfgs: list[dict[str, Any]]) -> None:
    p = await get_visible(ctx, pid)
    if not access.can_edit(ctx.me, p):
        raise forbidden()
    clean = []
    for c in cfgs:
        if c.get("stage") not in STAGE_KEYS:
            raise bad_request("阶段非法")
        clean.append({
            "stage": c["stage"],
            "userIds": [str(u) for u in c.get("userIds", [])],
            "includePl": bool(c.get("includePl")),
            "includeOwner": bool(c.get("includeOwner")),
            "events": [e for e in c.get("events", []) if e in ("review", "due", "transition")],
        })
    await bump(ctx, pid, notify=clean)


async def toggle_cross_cycle(ctx: Ctx, pid: str) -> bool:
    if ctx.me["role"] != "gl":
        raise forbidden("仅 GL 可标记跨周期")
    p = await get_operable(ctx, pid)
    if not p["crossCycle"]:
        await bump(ctx, pid, cross_cycle=1)
        return True
    # 取消豁免:超出所属周期结束日的截止日按决策 18 截断(延期记录保留供追溯)
    due_dates = dict(p["dueDates"])
    c = await patent_cycle(ctx.conn, p)
    if c:
        due_dates = {k: (c["end"] if v > c["end"] else v) for k, v in due_dates.items()}
    await bump(ctx, pid, cross_cycle=0, due_dates=due_dates)
    return False


async def transfer(ctx: Ctx, pid: str, to: str, keep_as_collaborator: bool = True, *, quiet: bool = False) -> None:
    """专利转交:接收人成为负责人;原负责人默认保留为共同发明人;团队归属不变;私有仍私有。"""
    p = await get_operable(ctx, pid, allow_archived=True)
    if to == p["ownerId"]:
        raise bad_request("接收人已是负责人")
    target = await _active_user(ctx, to)
    collab = [c for c in p["collaborators"] if c != to]
    if keep_as_collaborator and p["ownerId"] not in collab:
        collab.append(p["ownerId"])
    if p["visibility"] == "private":
        # 私有草案的待批延期只有负责人本人(PL/GL)能自批,换了负责人即失去审批人:作废
        await void_pending_extensions(ctx, pid)
    await bump(ctx, pid, owner_id=to, collaborators=collab)
    if not quiet:
        p["ownerId"], p["collaborators"] = to, collab
        await notify(ctx, "transition", f"《{p['title']}》已转交给 {target['name']}", p, extra=[to])


async def migrate_team(ctx: Ctx, pid: str, team_id: str) -> None:
    p = await get_operable(ctx, pid)
    if not access.is_team_manager(ctx.me, p) or p["visibility"] == "private":
        raise forbidden("仅原组 PL 或 GL 可迁移团队")
    async with ctx.conn.execute("SELECT name FROM teams WHERE id = ?", (team_id,)) as cur:
        t = await cur.fetchone()
    if not t:
        raise bad_request("团队不存在")
    await bump(ctx, pid, team_id=team_id)
    p["teamId"] = team_id  # 按迁移后的团队解析收件人
    await notify(ctx, "transition", f"《{p['title']}》已迁移至「{t['name']}」", p)


async def can_delete(ctx: Ctx, p: dict[str, Any]) -> bool:
    if p["ownerId"] != ctx.me["id"] or await has_left_draft(ctx.conn, p):
        return False
    async with ctx.conn.execute("SELECT 1 FROM review_assignments WHERE patent_id = ? LIMIT 1", (p["id"],)) as cur:
        return await cur.fetchone() is None


async def delete(ctx: Ctx, pid: str) -> None:
    p = await get_visible(ctx, pid)
    if not await can_delete(ctx, p):
        raise forbidden("只有负责人可以删除从未离开草案、且从未邀请过 reviewer 的专利")
    await ctx.conn.execute("DELETE FROM patents WHERE id = ?", (pid,))
