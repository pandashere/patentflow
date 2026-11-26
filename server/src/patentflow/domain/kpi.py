"""KPI 引擎(与前端 computeKpi 同口径)。

- 到达事件:只认 advance 流转,取该专利首次到达(≥)目标阶段的日期,需落在 [周期开始, min(目标截止, 周期结束)]
- 分母:周期内活跃的非私有专利;完成归档保留;放弃归档仅当放弃日 ≤ 周期结束 - N 天才退出
- 计分:ratio 按比例取均值;tiered 按「全部目标达成」件数落档
- scorerHook:预留自由计算回调(compute_item / compute_kpi),当前未加载外部代码,按内置计分
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from ..db import dumps, loads
from ..security import new_id
from ..timeutil import add_days, now
from .constants import STAGE_KEYS, stage_index
from .ctx import Ctx
from .errors import bad_request, conflict, forbidden, not_found


def in_scope(p: dict[str, Any], rule: dict[str, Any], cycle: dict[str, Any] | None, cfg: dict[str, Any]) -> bool:
    if not cycle or p["visibility"] == "private" or p["createdAt"] > cycle["end"]:
        return False
    arch = p.get("archived")
    if arch and arch["kind"] == "abandoned" and arch["at"][:10] <= add_days(cycle["end"], -int(cfg["overdue"]["abandonExcludeDays"])):
        return False
    if arch and arch["at"][:10] < cycle["start"]:
        return False
    if p["crossCycle"] and not cfg["overdue"]["includeCrossCycleInKpi"]:
        return False
    if rule["scope"]["type"] == "team" and p["teamId"] != rule["scope"].get("teamId"):
        return False
    return True


def first_reach(trs: list[dict[str, Any]], stage: str) -> str | None:
    hits = sorted(t["at"] for t in trs if t["kind"] == "advance" and stage_index(t["to"]) >= stage_index(stage))
    return hits[0][:10] if hits else None


def compute(rule: dict[str, Any], patents: list[dict[str, Any]], transitions: list[dict[str, Any]],
            cycles: list[dict[str, Any]], cfg: dict[str, Any]) -> dict[str, Any]:
    cycle = next((c for c in cycles if c["id"] == rule["cycleId"]), None)
    by_patent: dict[str, list] = defaultdict(list)
    for t in transitions:
        by_patent[t["patentId"]].append(t)
    items = []
    for p in patents:
        if not in_scope(p, rule, cycle, cfg):
            continue
        achieved = []
        for t in rule["targets"]:
            assert cycle
            deadline = min(t["deadline"], cycle["end"])
            at = first_reach(by_patent[p["id"]], t["stage"])
            achieved.append(bool(at and cycle["start"] <= at <= deadline))
        items.append({
            "patentId": p["id"], "title": p["title"], "ownerId": p["ownerId"], "collaborators": p["collaborators"],
            "currentStage": p["stage"], "achievedTargets": achieved,
            "score": sum(achieved) / len(rule["targets"]) if rule["targets"] else 0.0,
        })
    full = sum(1 for i in items if i["score"] == 1)
    sc = rule["scoring"]
    if sc.get("mode") == "tiered":
        tier = next((t for t in sorted(sc["tiers"], key=lambda t: -t["minCount"]) if full >= t["minCount"]), None)
        overall = float(tier["score"]) if tier else float(sc.get("elseScore", 0))
    else:
        overall = sum(i["score"] for i in items) / len(items) if items else 0.0
    return {"ruleId": rule["id"], "items": items, "overall": overall, "fullyAchieved": full}


def redact(report: dict[str, Any], visible_ids: set[str]) -> dict[str, Any]:
    """非 GL 查看全局规则时,别组的团队可见专利不暴露标题(只保留计分)。"""
    items = [i if i["patentId"] in visible_ids else {**i, "title": "(其他团队专利)", "collaborators": []}
             for i in report["items"]]
    return {**report, "items": items}


def rule_json(r: Any) -> dict[str, Any]:
    scope: dict[str, Any] = {"type": r["scope_type"]}
    if r["team_id"]:
        scope["teamId"] = r["team_id"]
    return {"id": r["id"], "name": r["name"], "scope": scope, "cycleId": r["cycle_id"],
            "targets": loads(r["targets"], []), "scoring": loads(r["scoring"], {"mode": "ratio"}),
            "scorerHook": r["scorer_hook"], "enabled": bool(r["enabled"]),
            "createdBy": r["created_by"], "updatedAt": r["updated_at"]}


def cycle_json(r: Any) -> dict[str, Any]:
    c = {"id": r["id"], "name": r["name"], "start": r["start"], "end": r["end"], "status": r["status"]}
    if r["closed_at"]:
        c["closedAt"] = r["closed_at"]
    return c


def _check_scoring(sc: dict[str, Any]) -> dict[str, Any]:
    if sc.get("mode") == "ratio":
        return {"mode": "ratio"}
    if sc.get("mode") != "tiered" or not sc.get("tiers"):
        raise bad_request("计分方式非法")
    tiers = [{"minCount": int(t["minCount"]), "score": float(t["score"])} for t in sc["tiers"]]
    if any(t["minCount"] < 0 or not 0 <= t["score"] <= 1 for t in tiers):
        raise bad_request("档位件数需 ≥ 0,得分需在 0–1 之间")
    else_score = float(sc.get("elseScore", 0))
    if not 0 <= else_score <= 1:
        raise bad_request("否则得分需在 0–1 之间")
    return {"mode": "tiered", "tiers": tiers, "elseScore": else_score}


async def save_rule(ctx: Ctx, rule: dict[str, Any]) -> str:
    me = ctx.me
    if me["role"] not in ("pl", "gl"):
        raise forbidden("仅 PL / GL 可管理 KPI 规则")
    name = str(rule.get("name", "")).strip()
    if not name:
        raise bad_request("规则名称不能为空")
    scope = rule.get("scope") or {}
    if scope.get("type") == "global":
        if me["role"] != "gl":
            raise forbidden("只有 GL 可创建全局规则")
        team_id = None
    else:
        team_id = scope.get("teamId") or me["teamId"]
        if me["role"] == "pl" and team_id != me["teamId"]:
            raise forbidden("PL 只能管理本组规则")
    async with ctx.conn.execute("SELECT * FROM cycles WHERE id = ?", (rule.get("cycleId"),)) as cur:
        cycle = await cur.fetchone()
    if not cycle:
        raise bad_request("请绑定有效的专利周期")
    targets = []
    for t in rule.get("targets") or []:
        if t.get("stage") not in STAGE_KEYS or not t.get("deadline"):
            raise bad_request("目标节点非法")
        targets.append({"stage": t["stage"], "deadline": min(t["deadline"], cycle["end"])})  # 超出周期自动截断
    if not targets:
        raise bad_request("至少需要一个目标节点")
    scoring = _check_scoring(rule.get("scoring") or {"mode": "ratio"})
    rid = rule.get("id") or new_id("k")
    async with ctx.conn.execute("SELECT * FROM kpi_rules WHERE id = ?", (rid,)) as cur:
        existing = await cur.fetchone()
    if existing:
        if me["role"] == "pl" and existing["team_id"] != me["teamId"]:
            raise forbidden("PL 只能管理本组规则")
        await ctx.conn.execute(
            """UPDATE kpi_rules SET name=?, scope_type=?, team_id=?, cycle_id=?, targets=?, scoring=?, scorer_hook=?,
               updated_at=? WHERE id=?""",
            (name, "global" if team_id is None else "team", team_id, cycle["id"], dumps(targets), dumps(scoring),
             rule.get("scorerHook") or None, now(), rid),
        )
    else:
        await ctx.conn.execute(
            """INSERT INTO kpi_rules(id, name, scope_type, team_id, cycle_id, targets, scoring, scorer_hook, enabled,
               created_by, updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)""",
            (rid, name, "global" if team_id is None else "team", team_id, cycle["id"], dumps(targets),
             dumps(scoring), rule.get("scorerHook") or None, me["id"], now()),
        )
    return rid


async def toggle_rule(ctx: Ctx, rid: str) -> bool:
    async with ctx.conn.execute("SELECT * FROM kpi_rules WHERE id = ?", (rid,)) as cur:
        r = await cur.fetchone()
    if not r:
        raise not_found("规则")
    if ctx.me["role"] == "user" or (ctx.me["role"] == "pl" and r["team_id"] != ctx.me["teamId"]):
        raise forbidden()
    await ctx.conn.execute("UPDATE kpi_rules SET enabled = ?, updated_at = ? WHERE id = ?",
                           (0 if r["enabled"] else 1, now(), rid))
    return not r["enabled"]


async def save_cycle(ctx: Ctx, c: dict[str, Any]) -> str:
    if ctx.me["role"] != "gl":
        raise forbidden("仅 GL 可管理专利周期")
    name, start, end = str(c.get("name", "")).strip(), c.get("start", ""), c.get("end", "")
    if not name or not start or not end or start > end:
        raise bad_request("请填写名称,且开始日不晚于结束日")
    cid = c.get("id") or new_id("c")
    async with ctx.conn.execute("SELECT status FROM cycles WHERE id = ?", (cid,)) as cur:
        ex = await cur.fetchone()
    if ex and ex["status"] == "closed":
        raise conflict("已收口的周期不可修改")
    await ctx.conn.execute(
        """INSERT INTO cycles(id, name, start, end, status) VALUES(?,?,?,?, 'active')
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, start=excluded.start, end=excluded.end""",
        (cid, name, start, end),
    )
    return cid


async def close_cycle(ctx: Ctx, cid: str) -> int:
    """收口:周期关闭,绑定该周期的启用规则冻结为快照,之后不再随流转变化。
    专利与流转在同一写事务内读取,避免漏记收口前刚提交的进展。"""
    from .repo import load_patents, load_transitions

    if ctx.me["role"] != "gl":
        raise forbidden("仅 GL 可收口周期")
    async with ctx.conn.execute("SELECT * FROM cycles WHERE id = ?", (cid,)) as cur:
        c = await cur.fetchone()
    if not c:
        raise not_found("周期")
    if c["status"] != "active":
        raise conflict("周期已收口")
    async with ctx.conn.execute("SELECT * FROM cycles") as cur:
        cycles = [cycle_json(r) for r in await cur.fetchall()]
    async with ctx.conn.execute("SELECT * FROM kpi_rules WHERE cycle_id = ? AND enabled = 1", (cid,)) as cur:
        rules = [rule_json(r) for r in await cur.fetchall()]
    patents = await load_patents(ctx.conn)
    transitions = await load_transitions(ctx.conn)
    for rule in rules:
        rep = compute(rule, patents, transitions, cycles, ctx.cfg)
        await ctx.conn.execute(
            "INSERT INTO kpi_snapshots(id, cycle_id, rule_id, frozen_at, overall, items) VALUES(?,?,?,?,?,?)",
            (new_id("ks"), cid, rule["id"], now(), rep["overall"], dumps(rep["items"])),
        )
    await ctx.conn.execute("UPDATE cycles SET status = 'closed', closed_at = ? WHERE id = ?", (now(), cid))
    return len(rules)
