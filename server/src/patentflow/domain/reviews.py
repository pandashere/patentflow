"""可专利性审查:邀请 / 撤销 / 拒绝 / 打分(可修改)/ 轮次。

门禁 = 本轮 ≥ n 名 reviewer「通过」且加权均分 ≥ 下限,且本轮无打回。
打回不自动回退,只阻断本轮;发明人修改后发起新一轮(名单继承、分数清零)。
"""
from __future__ import annotations

from typing import Any

from ..db import dumps
from ..timeutil import add_days, now, today
from . import access
from .common import bump, get_operable, get_visible
from .ctx import Ctx
from .errors import bad_request, conflict, forbidden
from .notifications import notify


def weighted(score: dict[str, Any], cfg: dict[str, Any]) -> float:
    dims = cfg["reviewDims"]
    total = sum(float(d["weight"]) for d in dims) or 1.0
    return sum(float(score.get(d["key"], 0)) * float(d["weight"]) for d in dims) / total


def _active(p: dict[str, Any]) -> list[dict[str, Any]]:
    # 门禁只统计未拒绝、且不是当前负责人的 reviewer(转交给 reviewer 后其票作废,决策 32)
    return [r for r in p["stageData"]["patentability"]["reviewers"]
            if not r.get("declined") and r["userId"] != p["ownerId"]]


def rejected(p: dict[str, Any]) -> bool:
    return any((r.get("score") or {}).get("verdict") == "reject" for r in _active(p))


def pass_count(p: dict[str, Any], cfg: dict[str, Any]) -> int:
    return sum(
        1 for r in _active(p)
        if (s := r.get("score")) and s.get("verdict") == "pass" and weighted(s, cfg) >= float(cfg["reviewMinWeighted"])
    )


def gate_open(p: dict[str, Any], cfg: dict[str, Any]) -> bool:
    return not rejected(p) and pass_count(p, cfg) >= int(cfg["reviewPassCount"])


async def next_round(ctx: Ctx, p: dict[str, Any], outcome: str) -> bool:
    """当前轮已有提交时开启新一轮:旧轮归档,名单继承(去掉已拒绝/已停用)并重置。返回是否开启。"""
    cur = p["stageData"]["patentability"]
    if not any(r.get("score") or r.get("declined") for r in cur["reviewers"]):
        return False
    rnd = cur["round"]
    await ctx.conn.execute(
        "INSERT OR IGNORE INTO review_rounds(patent_id, round, closed_at, outcome) VALUES(?,?,?,?)", (p["id"], rnd, now(), outcome)
    )
    due = add_days(today(), int(ctx.cfg["reviewerDueDays"]))
    await ctx.conn.execute(
        """INSERT INTO review_assignments(patent_id, round, user_id, invited_by, invited_at, due_date)
           SELECT a.patent_id, ?, a.user_id, a.invited_by, ?, ? FROM review_assignments a
           JOIN users u ON u.id = a.user_id
           WHERE a.patent_id = ? AND a.round = ? AND a.declined_at IS NULL AND u.deactivated_at IS NULL
             AND a.user_id != ?""",
        (rnd + 1, now(), due, p["id"], rnd, p["ownerId"]),
    )
    await ctx.conn.execute("UPDATE patents SET review_round = ? WHERE id = ?", (rnd + 1, p["id"]))
    return True


def _in_review(p: dict[str, Any]) -> None:
    if p["archived"] or p["stage"] != "patentability":
        raise conflict("专利当前不在可专利性审查阶段")


async def invite(ctx: Ctx, pid: str, user_id: str) -> None:
    p = await get_visible(ctx, pid)
    if not access.can_edit(ctx.me, p):
        raise forbidden()
    _in_review(p)
    if user_id == p["ownerId"]:
        raise bad_request("不能邀请负责人本人审查")  # 决策:不设其他回避规则
    async with ctx.conn.execute("SELECT name FROM users WHERE id = ? AND deactivated_at IS NULL", (user_id,)) as c:
        u = await c.fetchone()
    if not u:
        raise bad_request("被邀请人不存在或已停用")
    rnd = p["stageData"]["patentability"]["round"]
    if any(r["userId"] == user_id for r in p["stageData"]["patentability"]["reviewers"]):
        raise conflict("该成员已在本轮名单中")
    await ctx.conn.execute(
        "INSERT INTO review_assignments(patent_id, round, user_id, invited_by, invited_at, due_date) VALUES(?,?,?,?,?,?)",
        (pid, rnd, user_id, ctx.me["id"], now(), add_days(today(), int(ctx.cfg["reviewerDueDays"]))),
    )
    await bump(ctx, pid)
    await notify(ctx, "review", f"{u['name']} 被邀请审查《{p['title']}》", p, extra=[user_id])


async def withdraw(ctx: Ctx, pid: str, user_id: str) -> None:
    p = await get_visible(ctx, pid)
    if not access.can_edit(ctx.me, p):
        raise forbidden()
    _in_review(p)
    r = next((r for r in p["stageData"]["patentability"]["reviewers"] if r["userId"] == user_id), None)
    if not r:
        raise bad_request("该成员不在本轮名单中")
    if r.get("score"):
        raise conflict("对方已提交意见,不能撤销")
    await ctx.conn.execute(
        "DELETE FROM review_assignments WHERE patent_id = ? AND round = ? AND user_id = ?",
        (pid, p["stageData"]["patentability"]["round"], user_id),
    )
    await bump(ctx, pid)
    await notify(ctx, "review", f"《{p['title']}》的审查邀请已撤销", p, only=[user_id])


async def decline(ctx: Ctx, pid: str, reason: str) -> None:
    p = await get_visible(ctx, pid)
    _in_review(p)
    if not reason.strip():
        raise bad_request("请填写拒绝原因")
    r = next((r for r in p["stageData"]["patentability"]["reviewers"] if r["userId"] == ctx.me["id"]), None)
    if not r:
        raise forbidden("你不在本轮审查名单中")
    if r.get("score"):
        raise conflict("你已提交意见,不能再拒绝")
    await ctx.conn.execute(
        "UPDATE review_assignments SET declined_at = ?, decline_reason = ? WHERE patent_id = ? AND round = ? AND user_id = ?",
        (now(), reason.strip(), pid, p["stageData"]["patentability"]["round"], ctx.me["id"]),
    )
    await bump(ctx, pid)
    await notify(ctx, "review", f"{ctx.me['name']} 拒绝了《{p['title']}》的审查邀请:{reason.strip()}", p)


async def submit(ctx: Ctx, pid: str, score: dict[str, Any]) -> None:
    """提交或修改本轮意见(本轮结束前可改)。"""
    p = await get_visible(ctx, pid)
    _in_review(p)
    r = next((r for r in p["stageData"]["patentability"]["reviewers"] if r["userId"] == ctx.me["id"]), None)
    if not r or r.get("declined"):
        raise forbidden("你不在本轮审查名单中")
    if ctx.me["id"] == p["ownerId"]:
        raise forbidden("你已是该专利的负责人,不能审查自己的专利")
    rnd = p["stageData"]["patentability"]["round"]
    if score.get("round") is not None and int(score["round"]) != rnd:
        raise conflict(f"审查已进入第 {rnd} 轮,材料可能已修改,请刷新后重新查看再评分", reason="stale_round")
    verdict = score.get("verdict")
    if verdict not in ("pass", "reject"):
        raise bad_request("verdict 必须是 pass 或 reject")
    clean = {k: int(score.get(k, 0)) for k in ("difficulty", "nonObviousness", "novelty")}
    if any(not 1 <= v <= 5 for v in clean.values()):
        raise bad_request("三个维度评分必须在 1–5 之间")
    comment = str(score.get("comment", "")).strip()
    if verdict == "reject" and not comment:
        raise bad_request("打回时必须填写审查意见")
    ws = weighted(clean, ctx.cfg)
    if verdict == "pass" and ws < float(ctx.cfg["reviewMinWeighted"]):
        raise bad_request(f"加权均分 {ws:.1f} 低于下限 {ctx.cfg['reviewMinWeighted']},不能判「通过」", code="below_min")
    full = {**clean, "comment": comment, "verdict": verdict, "submittedAt": now()}
    await ctx.conn.execute(
        "UPDATE review_assignments SET score = ? WHERE patent_id = ? AND round = ? AND user_id = ?",
        (dumps(full), pid, p["stageData"]["patentability"]["round"], ctx.me["id"]),
    )
    await bump(ctx, pid)
    edited = "修改了" if r.get("score") else "提交了"
    await notify(ctx, "review",
                 f"{ctx.me['name']} {edited}对《{p['title']}》的审查意见:{'通过' if verdict == 'pass' else '打回'}", p)


async def start_new_round(ctx: Ctx, pid: str) -> int:
    p = await get_operable(ctx, pid)
    _in_review(p)
    outcome = "rejected" if rejected(p) else "superseded"
    if not await next_round(ctx, p, outcome):
        raise conflict("本轮还没有任何提交,无需发起新一轮")
    await bump(ctx, pid)
    rnd = p["stageData"]["patentability"]["round"] + 1
    await notify(ctx, "review", f"《{p['title']}》发起第 {rnd} 轮审查,请 reviewer 重新评审", p,
                 extra=[r["userId"] for r in p["stageData"]["patentability"]["reviewers"] if not r.get("declined")])
    return rnd
