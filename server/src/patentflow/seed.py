"""演示种子数据:导入与前端 Demo 相同的数据(seed_data.json 由 src/lib/data.ts 导出)。"""
from __future__ import annotations

import json
from importlib import resources
from typing import Any

from .db import Database, dumps
from .domain.constants import EMPTY_STAGE_DATA, STAGE_KEYS
from .domain.sysconfig import get_system, save_system, validate_system
from .security import hash_password
from .timeutil import now

DEMO_PASSWORD = "demo1234"


def _data() -> dict[str, Any]:
    return json.loads(resources.files("patentflow").joinpath("seed_data.json").read_text(encoding="utf-8"))


def _nonempty(stage: str, d: dict[str, Any]) -> bool:
    if stage == "patentability":
        return bool(d.get("summary")) or any(d.get("selfAssessment", {}).get(k) for k in ("difficulty", "novelty"))
    return any(v for v in d.values())


async def seed(db: Database, *, force: bool = False) -> dict[str, int]:
    data = _data()
    async with db.tx() as conn:
        async with conn.execute("SELECT COUNT(*) n FROM patents") as cur:
            if (await cur.fetchone())["n"] and not force:
                raise RuntimeError("数据库已有专利数据;如确定要覆盖演示数据请加 --force")
        if force:
            for t in ("notifications", "kpi_snapshots", "kpi_rules", "extensions", "transitions", "review_rounds",
                      "review_assignments", "stage_data", "patents", "cycles", "api_tokens", "sessions",
                      "external_identities", "user_prefs", "reminder_log", "password_resets"):
                await conn.execute(f"DELETE FROM {t}")

        for t in data["teams"]:
            await conn.execute("INSERT OR REPLACE INTO teams(id, name, pl_id) VALUES(?,?,?)", (t["id"], t["name"], t["plId"]))
        pwd = hash_password(DEMO_PASSWORD)
        for u in data["users"]:
            # 启动引导可能已按配置文件 admins 用随机 id 建号:按邮箱对齐到种子 id
            await conn.execute("UPDATE users SET id = ? WHERE email = ? AND id != ?", (u["id"], u["email"], u["id"]))
            await conn.execute(
                """INSERT INTO users(id, name, email, title, role, team_id, password_hash, created_at)
                   VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET
                   name=excluded.name, title=excluded.title, role=excluded.role, team_id=excluded.team_id,
                   password_hash=excluded.password_hash""",
                (u["id"], u["name"], u["email"], u["title"], u["role"], u["teamId"], pwd, "2026-01-01 09:00"),
            )
            if u.get("ssoBound") and u.get("ssoIssuer"):
                await conn.execute("INSERT OR IGNORE INTO external_identities VALUES(?,?,?,?)",
                                   (u["ssoIssuer"], u["email"], u["id"], "2026-01-01 09:00"))
        cfg = await get_system(conn)
        demo_cfg = data["config"]
        for k in ("reviewPassCount", "reviewMinWeighted", "reviewerDueDays", "reviewDims", "stageDefaults",
                  "classSuggestions", "numberPrefix", "notifyDefaults", "overdue"):
            cfg[k] = demo_cfg[k]
        await save_system(conn, validate_system(cfg))

        for c in data["cycles"]:
            await conn.execute("INSERT INTO cycles(id, name, start, end, status, closed_at) VALUES(?,?,?,?,?,?)",
                               (c["id"], c["name"], c["start"], c["end"], c["status"], c.get("closedAt")))

        versions_by: dict[tuple[str, str], list] = {}
        for v in data["versions"]:
            versions_by.setdefault((v["patentId"], v["stage"]), []).append(v)

        for p in data["patents"]:
            pa = p["stageData"]["patentability"]
            await conn.execute(
                """INSERT INTO patents(id, code, title, owner_id, team_id, visibility, stage, cross_cycle, collaborators,
                   due_dates, needs_recheck, notify, archived, review_round, created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (p["id"], p["code"], p["title"], p["ownerId"], p["teamId"], p["visibility"], p["stage"],
                 int(p["crossCycle"]), dumps(p["collaborators"]), dumps(p["dueDates"]), dumps(p["needsRecheck"]),
                 dumps(p["notify"]), dumps(p["archived"]) if p["archived"] else None, pa["round"], p["createdAt"]),
            )
            for stage in STAGE_KEYS:
                cur_data = p["stageData"][stage]
                if stage == "patentability":
                    cur_data = {"summary": pa["summary"], "selfAssessment": pa["selfAssessment"]}
                vs = sorted(versions_by.get((p["id"], stage), []), key=lambda v: v["version"])
                if not vs and not _nonempty(stage, {**EMPTY_STAGE_DATA[stage], **cur_data}):
                    continue
                if not vs:
                    vs = [{"version": 1, "authorId": p["ownerId"], "at": f"{p['createdAt']} 09:00", "note": "初始内容",
                           "snapshot": None}]
                for i, v in enumerate(vs):
                    snap = v["snapshot"] if isinstance(v["snapshot"], dict) else cur_data
                    if i == len(vs) - 1:
                        snap = cur_data  # 最新版本 = 当前内容
                    snap = {k: snap.get(k, EMPTY_STAGE_DATA[stage].get(k)) for k in EMPTY_STAGE_DATA[stage]}
                    await conn.execute(
                        "INSERT INTO stage_data(patent_id, stage, version, data, author_id, at, note) VALUES(?,?,?,?,?,?,?)",
                        (p["id"], stage, v["version"], dumps(snap), v["authorId"], v["at"], v["note"]),
                    )
            for rnd in pa["pastRounds"]:
                await conn.execute("INSERT INTO review_rounds VALUES(?,?,?,?)",
                                   (p["id"], rnd["round"], rnd["closedAt"], rnd["outcome"]))
            for rnd, revs in [(r["round"], r["reviewers"]) for r in pa["pastRounds"]] + [(pa["round"], pa["reviewers"])]:
                for r in revs:
                    await conn.execute(
                        """INSERT INTO review_assignments(patent_id, round, user_id, invited_by, invited_at, due_date, score)
                           VALUES(?,?,?,?,?,?,?)""",
                        (p["id"], rnd, r["userId"], r["invitedBy"], r["invitedAt"], r.get("dueDate"),
                         dumps(r["score"]) if r["score"] else None),
                    )
            if p["archived"]:
                a = p["archived"]
                await conn.execute(
                    "INSERT INTO transitions VALUES(?,?,?,?,?,?,?,?)",
                    (f"tr-a-{p['id']}", p["id"], p["stage"], p["stage"], "archive", a["by"], a["at"],
                     f"{'完成归档' if a['kind'] == 'completed' else '放弃归档'}:{a['reason']}"),
                )

        for t in data["transitions"]:
            await conn.execute("INSERT INTO transitions VALUES(?,?,?,?,?,?,?,?)",
                               (t["id"], t["patentId"], t["from"], t["to"], t["kind"], t["operatorId"], t["at"], t["reason"]))
        for r in data["kpiRules"]:
            await conn.execute(
                "INSERT INTO kpi_rules VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (r["id"], r["name"], r["scope"]["type"], r["scope"].get("teamId"), r["cycleId"], dumps(r["targets"]),
                 dumps(r["scoring"]), r["scorerHook"], int(r["enabled"]), r["createdBy"], r["updatedAt"]),
            )
        owners = {p["id"]: [p["ownerId"], *p["collaborators"]] for p in data["patents"]}
        for n in data["notifications"]:
            for uid in owners.get(n["patentId"], []):
                await conn.execute("INSERT INTO notifications VALUES(?,?,?,?,?,?,?)",
                                   (f"{n['id']}-{uid}", uid, n["event"], n["text"], n["at"], int(n["read"]), n["patentId"]))
        await conn.execute("INSERT OR REPLACE INTO meta VALUES('seeded_at', ?)", (now(),))
    return {"users": len(data["users"]), "patents": len(data["patents"])}
