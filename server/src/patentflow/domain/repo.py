"""读取专利聚合,序列化为与前端 types.ts 一致的 JSON 结构。"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

import aiosqlite

from ..db import loads
from .constants import EMPTY_STAGE_DATA, STAGE_KEYS


def user_json(r: aiosqlite.Row, sso: set[str] | None = None, issuers: dict[str, str] | None = None) -> dict[str, Any]:
    u: dict[str, Any] = {
        "id": r["id"], "name": r["name"], "email": r["email"], "title": r["title"],
        "role": r["role"], "teamId": r["team_id"],
        "ssoBound": bool(sso and r["id"] in sso),
    }
    if issuers and r["id"] in issuers:
        u["ssoIssuer"] = issuers[r["id"]]
    if r["deactivated_at"]:
        u["deactivated"] = {"at": r["deactivated_at"], "by": r["deactivated_by"]}
    return u


async def load_users(conn: aiosqlite.Connection) -> list[dict[str, Any]]:
    async with conn.execute("SELECT * FROM users ORDER BY created_at, id") as cur:
        rows = await cur.fetchall()
    async with conn.execute("SELECT user_id, issuer FROM external_identities") as cur:
        ext = await cur.fetchall()
    issuers = {e["user_id"]: e["issuer"] for e in ext}
    return [user_json(r, set(issuers), issuers) for r in rows]


async def load_user(conn: aiosqlite.Connection, uid: str) -> dict[str, Any] | None:
    async with conn.execute("SELECT * FROM users WHERE id=?", (uid,)) as cur:
        r = await cur.fetchone()
    if not r:
        return None
    async with conn.execute("SELECT issuer FROM external_identities WHERE user_id=? LIMIT 1", (uid,)) as cur:
        e = await cur.fetchone()
    return user_json(r, {uid} if e else set(), {uid: e["issuer"]} if e else None)


def _assignment(r: aiosqlite.Row) -> dict[str, Any]:
    a: dict[str, Any] = {
        "userId": r["user_id"], "invitedBy": r["invited_by"], "invitedAt": r["invited_at"],
        "score": loads(r["score"]),
    }
    if r["due_date"]:
        a["dueDate"] = r["due_date"]
    if r["declined_at"]:
        a["declined"] = {"at": r["declined_at"], "reason": r["decline_reason"] or ""}
    return a


async def load_patents(conn: aiosqlite.Connection, ids: Iterable[str] | None = None) -> list[dict[str, Any]]:
    where, params = "", ()
    if ids is not None:
        ids = list(ids)
        if not ids:
            return []
        where = f" WHERE id IN ({','.join('?' * len(ids))})"
        params = tuple(ids)
    async with conn.execute(f"SELECT * FROM patents{where} ORDER BY created_at DESC, id", params) as cur:
        rows = await cur.fetchall()
    if not rows:
        return []
    pids = [r["id"] for r in rows]
    ph = ",".join("?" * len(pids))

    async with conn.execute(
        f"""SELECT s.patent_id, s.stage, s.data FROM stage_data s
            JOIN (SELECT patent_id, stage, MAX(version) v FROM stage_data WHERE patent_id IN ({ph}) GROUP BY 1, 2) m
              ON s.patent_id = m.patent_id AND s.stage = m.stage AND s.version = m.v""",
        pids,
    ) as cur:
        data: dict[str, dict[str, Any]] = defaultdict(dict)
        for r in await cur.fetchall():
            data[r["patent_id"]][r["stage"]] = loads(r["data"])

    async with conn.execute(
        f"SELECT * FROM review_assignments WHERE patent_id IN ({ph}) ORDER BY invited_at, user_id", pids
    ) as cur:
        assigns: dict[tuple[str, int], list] = defaultdict(list)
        all_reviewers: dict[str, set[str]] = defaultdict(set)
        for r in await cur.fetchall():
            assigns[(r["patent_id"], r["round"])].append(_assignment(r))
            all_reviewers[r["patent_id"]].add(r["user_id"])

    async with conn.execute(f"SELECT * FROM review_rounds WHERE patent_id IN ({ph}) ORDER BY round", pids) as cur:
        rounds: dict[str, list] = defaultdict(list)
        for r in await cur.fetchall():
            rounds[r["patent_id"]].append(
                {"round": r["round"], "closedAt": r["closed_at"], "outcome": r["outcome"],
                 "reviewers": assigns.get((r["patent_id"], r["round"]), [])}
            )

    async with conn.execute(f"SELECT * FROM extensions WHERE patent_id IN ({ph}) ORDER BY at, id", pids) as cur:
        exts: dict[str, list] = defaultdict(list)
        for r in await cur.fetchall():
            e = {"id": r["id"], "stage": r["stage"], "oldDue": r["old_due"], "newDue": r["new_due"],
                 "reason": r["reason"], "by": r["by_user"], "at": r["at"], "status": r["status"]}
            if r["approved_by"]:
                e["approvedBy"] = r["approved_by"]
            if r["self_approved"]:
                e["selfApproved"] = True
            exts[r["patent_id"]].append(e)

    out = []
    for r in rows:
        pid = r["id"]
        sd = {k: {**EMPTY_STAGE_DATA[k], **data[pid].get(k, {})} for k in STAGE_KEYS}
        sd["patentability"] = {
            **sd["patentability"],
            "round": r["review_round"],
            "reviewers": assigns.get((pid, r["review_round"]), []),
            "pastRounds": rounds.get(pid, []),
        }
        out.append({
            "id": pid, "code": r["code"], "title": r["title"], "ownerId": r["owner_id"],
            "collaborators": loads(r["collaborators"], []), "teamId": r["team_id"],
            "visibility": r["visibility"], "stage": r["stage"], "crossCycle": bool(r["cross_cycle"]),
            "archived": loads(r["archived"]), "createdAt": r["created_at"],
            "dueDates": loads(r["due_dates"], {}), "extensions": exts.get(pid, []),
            "stageData": sd, "notify": loads(r["notify"], []),
            "needsRecheck": loads(r["needs_recheck"], []), "rev": r["rev"],
            "_reviewerIds": all_reviewers.get(pid, set()),
        })
    return out


async def load_patent(conn: aiosqlite.Connection, pid: str) -> dict[str, Any] | None:
    ps = await load_patents(conn, [pid])
    return ps[0] if ps else None


def public_patent(p: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in p.items() if not k.startswith("_")}


def transition_json(r: aiosqlite.Row) -> dict[str, Any]:
    return {"id": r["id"], "patentId": r["patent_id"], "from": r["from_stage"], "to": r["to_stage"],
            "operatorId": r["operator_id"], "at": r["at"], "reason": r["reason"], "kind": r["kind"]}


async def load_transitions(conn: aiosqlite.Connection, patent_ids: Iterable[str] | None = None) -> list[dict[str, Any]]:
    if patent_ids is None:
        sql, params = "SELECT * FROM transitions ORDER BY at, id", ()
    else:
        ids = list(patent_ids)
        if not ids:
            return []
        sql = f"SELECT * FROM transitions WHERE patent_id IN ({','.join('?' * len(ids))}) ORDER BY at, id"
        params = tuple(ids)
    async with conn.execute(sql, params) as cur:
        return [transition_json(r) for r in await cur.fetchall()]


async def load_versions(conn: aiosqlite.Connection, patent_ids: Iterable[str]) -> list[dict[str, Any]]:
    ids = list(patent_ids)
    if not ids:
        return []
    async with conn.execute(
        f"SELECT * FROM stage_data WHERE patent_id IN ({','.join('?' * len(ids))}) ORDER BY at, version", ids
    ) as cur:
        return [
            {"version": r["version"], "patentId": r["patent_id"], "stage": r["stage"], "note": r["note"],
             "authorId": r["author_id"], "at": r["at"], "snapshot": loads(r["data"])}
            for r in await cur.fetchall()
        ]
