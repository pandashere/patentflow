"""延期 / 催办 / KPI 规则与报表 / 专利周期。"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from ..db import Database, loads
from ..deps import Auth, current_auth, get_db
from ..domain import access, kpi, schedule
from ..domain.errors import not_found
from ..domain.repo import load_patents, load_transitions
from ..domain.sysconfig import get_system
from ._util import patent_out, run

router = APIRouter(tags=["planning"])


class ExtIn(BaseModel):
    newDue: str
    reason: str
    stage: str | None = None  # 打开延期框时的阶段;阶段已变化返回 409


class CycleIn(BaseModel):
    id: str | None = None
    name: str
    start: str
    end: str


@router.post("/patents/{pid}/extensions")
async def request_ext(pid: str, body: ExtIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    status = await run(request, auth, lambda ctx: schedule.request_extension(ctx, pid, body.newDue, body.reason, body.stage))
    return {"status": status, "patent": await patent_out(request, pid)}


@router.post("/patents/{pid}/extensions/{eid}/{action}")
async def decide_ext(pid: str, eid: str, action: Literal["approve", "reject"], request: Request,
                     auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: schedule.review_extension(ctx, pid, eid, action == "approve"))
    return await patent_out(request, pid)  # type: ignore[return-value]


@router.post("/patents/{pid}/nudge")
async def nudge(pid: str, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, bool]:
    await run(request, auth, lambda ctx: schedule.nudge(ctx, pid))
    return {"ok": True}


# —— KPI ——
def rule_visible(me: dict[str, Any], r: dict[str, Any]) -> bool:
    return me["role"] == "gl" or r["scope"]["type"] == "global" or r["scope"].get("teamId") == me["teamId"]


async def all_rules(db: Database) -> list[dict[str, Any]]:
    return [kpi.rule_json(r) for r in await db.all("SELECT * FROM kpi_rules ORDER BY updated_at")]


async def all_cycles(db: Database) -> list[dict[str, Any]]:
    return [kpi.cycle_json(r) for r in await db.all("SELECT * FROM cycles ORDER BY start")]


async def reports_for(db: Database, me: dict[str, Any], rules: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """计算(或读取冻结快照)规则报表;非 GL 对不可见专利做标题脱敏。"""
    patents = await load_patents(db.reader)  # type: ignore[arg-type]
    transitions = await load_transitions(db.reader)  # type: ignore[arg-type]
    cycles = await all_cycles(db)
    cfg = await get_system(db.reader)  # type: ignore[arg-type]
    visible = {p["id"] for p in patents if access.can_see(me, p)}
    snaps = {r["rule_id"]: r for r in await db.all("SELECT * FROM kpi_snapshots")}
    out = {}
    for rule in rules:
        cyc = next((c for c in cycles if c["id"] == rule["cycleId"]), None)
        if cyc and cyc["status"] == "closed":
            # 已收口:只展示冻结快照;无快照(旧数据)时展示空报表,不做实时重算
            s = snaps.get(rule["id"])
            items = loads(s["items"], []) if s else []
            rep = {"ruleId": rule["id"], "items": items, "overall": s["overall"] if s else 0.0,
                   "frozenAt": s["frozen_at"] if s else cyc.get("closedAt", ""),
                   "fullyAchieved": sum(1 for i in items if i["score"] == 1)}
        else:
            rep = kpi.compute(rule, patents, transitions, cycles, cfg)
        # 收口快照可能含后来改回私有的草案:当前私有且对我不可见的明细一律剔除(决策 9)
        # 已删除的专利同样剔除;冻结的总分与件数按决策 21 保持不变
        shown = {p["id"] for p in patents if p["visibility"] != "private" or p["id"] in visible}
        rep = {**rep, "items": [i for i in rep["items"] if i["patentId"] in shown]}
        out[rule["id"]] = rep if me["role"] == "gl" else kpi.redact(rep, visible)
    return out


@router.get("/kpi/rules")
async def list_rules(auth: Auth = Depends(current_auth), db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    return [r for r in await all_rules(db) if rule_visible(auth.user, r)]


@router.post("/kpi/rules")
async def save_rule(body: dict[str, Any], request: Request, auth: Auth = Depends(current_auth),
                    db: Database = Depends(get_db)) -> dict[str, Any]:
    rid = await run(request, auth, lambda ctx: kpi.save_rule(ctx, body))
    return next(r for r in await all_rules(db) if r["id"] == rid)


@router.post("/kpi/rules/{rid}/toggle")
async def toggle_rule(rid: str, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, bool]:
    return {"enabled": await run(request, auth, lambda ctx: kpi.toggle_rule(ctx, rid))}


@router.get("/kpi/rules/{rid}/report")
async def rule_report(rid: str, auth: Auth = Depends(current_auth), db: Database = Depends(get_db)) -> dict[str, Any]:
    rule = next((r for r in await all_rules(db) if r["id"] == rid and rule_visible(auth.user, r)), None)
    if not rule:
        raise not_found("规则")
    return (await reports_for(db, auth.user, [rule]))[rid]


# —— 周期 ——
@router.get("/cycles")
async def list_cycles(auth: Auth = Depends(current_auth), db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    return await all_cycles(db)


@router.post("/cycles")
async def save_cycle(body: CycleIn, request: Request, auth: Auth = Depends(current_auth),
                     db: Database = Depends(get_db)) -> dict[str, Any]:
    cid = await run(request, auth, lambda ctx: kpi.save_cycle(ctx, body.model_dump()))
    return next(c for c in await all_cycles(db) if c["id"] == cid)


@router.post("/cycles/{cid}/close")
async def close_cycle(cid: str, request: Request, auth: Auth = Depends(current_auth),
                      db: Database = Depends(get_db)) -> dict[str, Any]:
    n = await run(request, auth, lambda ctx: kpi.close_cycle(ctx, cid))
    return {"frozenRules": n}
