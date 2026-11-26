from __future__ import annotations

from tests.helpers import H, db_exec, world
from tests.test_patents import adv, mk


def ext(client, pid, due, uid="u1"):  # type: ignore[no-untyped-def]
    return client.post(f"/api/patents/{pid}/extensions", json={"newDue": due, "reason": "排期"}, headers=H(uid))


def test_extension_cumulative_threshold_and_approval(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]  # draft due 2026-12-10,阈值 14 天
    assert ext(client, pid, "2026-12-18").json()["status"] == "applied"  # +8
    r = ext(client, pid, "2026-12-25").json()  # +7,累计 15 > 14 → 待审批
    assert r["status"] == "pending"
    assert ext(client, pid, "2026-12-26").status_code == 409  # 已有待批
    eid = r["patent"]["extensions"][-1]["id"]
    assert client.post(f"/api/patents/{pid}/extensions/{eid}/approve", headers=H("u2")).status_code == 403
    p = client.post(f"/api/patents/{pid}/extensions/{eid}/approve", headers=H("pl1")).json()
    assert p["dueDates"]["draft"] == "2026-12-25" and p["extensions"][-1]["approvedBy"] == "pl1"
    # 超出周期结束日
    assert ext(client, pid, "2027-01-10").json()["code"] == "beyond_cycle"


def test_pl_self_approval_is_marked(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client, "pl1")["id"]
    e = ext(client, pid, "2026-12-30", "pl1").json()["patent"]["extensions"][-1]
    p = client.post(f"/api/patents/{pid}/extensions/{e['id']}/approve", headers=H("pl1")).json()
    assert p["extensions"][-1]["selfApproved"] is True


def test_pending_extension_voided_on_stage_change(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    ext(client, pid, "2026-12-30")
    p = adv(client, pid).json()
    assert p["extensions"][-1]["status"] == "void"


def _seed_reach(client, pid, stage, at, kind="advance"):  # type: ignore[no-untyped-def]
    db_exec(client, "INSERT INTO transitions(id, patent_id, from_stage, to_stage, kind, operator_id, at, reason) "
            "VALUES(?,?,?,?,?,?,?,?)", (f"t{pid}{stage}{at}{kind}", pid, None, stage, kind, "u1", at, ""))


def rule(client, uid="gl", **kw):  # type: ignore[no-untyped-def]
    body = {"name": "R", "scope": {"type": "global"}, "cycleId": "c26",
            "targets": [{"stage": "patentability", "deadline": "2026-12-31"}], **kw}
    r = client.post("/api/kpi/rules", json=body, headers=H(uid))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def report(client, rid, uid="gl"):  # type: ignore[no-untyped-def]
    return client.get(f"/api/kpi/rules/{rid}/report", headers=H(uid)).json()


def test_kpi_first_advance_only_and_private_excluded(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    a = mk(client, title="A")["id"]
    b = mk(client, title="B")["id"]
    mk(client, vis="private", title="私有")
    _seed_reach(client, a, "patentability", "2026-03-01 10:00")
    # B 只有回退/恢复类事件「到达」审查阶段 —— 不计
    _seed_reach(client, b, "patentability", "2026-03-01 10:00", "rollback")
    _seed_reach(client, b, "patentability", "2026-03-02 10:00", "unarchive")
    rid = rule(client)
    rep = report(client, rid)
    assert {i["title"]: i["score"] for i in rep["items"]} == {"A": 1.0, "B": 0.0}
    assert rep["overall"] == 0.5


def test_kpi_reached_in_previous_cycle_not_recounted(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    a = mk(client)["id"]
    _seed_reach(client, a, "patentability", "2025-12-20 10:00")  # 往期首次到达
    _seed_reach(client, a, "patentability", "2026-02-01 10:00")  # 回退后再次推进
    assert report(client, rule(client))["items"][0]["score"] == 0.0


def test_kpi_abandon_window(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    early, late = mk(client, title="早放弃")["id"], mk(client, title="晚放弃")["id"]
    db_exec(client, "UPDATE patents SET archived=? WHERE id=?",
            ('{"kind":"abandoned","at":"2026-10-01 10:00","by":"u1","reason":"x"}', early))
    db_exec(client, "UPDATE patents SET archived=? WHERE id=?",
            ('{"kind":"abandoned","at":"2026-12-20 10:00","by":"u1","reason":"x"}', late))
    titles = [i["title"] for i in report(client, rule(client))["items"]]
    assert titles == ["晚放弃"]  # 结束前 30 天之后才放弃的仍计入分母


def test_kpi_tiered_scoring_and_redaction(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    a, b = mk(client)["id"], mk(client, "u3")["id"]
    for pid in (a, b):
        _seed_reach(client, pid, "patentability", "2026-05-01 10:00")
    rid = rule(client, scoring={"mode": "tiered", "tiers": [{"minCount": 2, "score": 1}, {"minCount": 1, "score": 0.5}],
                                "elseScore": 0})
    assert report(client, rid)["overall"] == 1.0
    # u1 看全局规则:别组 u3 的团队专利标题脱敏
    titles = sorted(i["title"] for i in report(client, rid, "u1")["items"])
    assert titles == ["(其他团队专利)", "测试专利"]


def test_kpi_rule_permissions(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    assert client.post("/api/kpi/rules", json={"name": "x", "scope": {"type": "global"}, "cycleId": "c26",
                       "targets": [{"stage": "doi", "deadline": "2026-12-31"}]}, headers=H("pl1")).status_code == 403
    assert client.post("/api/kpi/rules", json={"name": "x", "scope": {"type": "team", "teamId": "t2"}, "cycleId": "c26",
                       "targets": [{"stage": "doi", "deadline": "2026-12-31"}]}, headers=H("pl1")).status_code == 403
    rid = rule(client, "pl1", scope={"type": "team", "teamId": "t1"},
               targets=[{"stage": "doi", "deadline": "2027-06-30"}])
    r = next(x for x in client.get("/api/kpi/rules", headers=H("u1")).json() if x["id"] == rid)
    assert r["targets"][0]["deadline"] == "2026-12-31"  # 超出周期自动截断
    assert all(x["id"] != rid for x in client.get("/api/kpi/rules", headers=H("u3")).json())


def test_close_cycle_freezes_snapshot(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    a = mk(client)["id"]
    rid = rule(client)
    assert report(client, rid)["overall"] == 0.0
    assert client.post("/api/cycles/c26/close", headers=H("pl1")).status_code == 403
    assert client.post("/api/cycles/c26/close", headers=H("gl")).json()["frozenRules"] == 1
    _seed_reach(client, a, "patentability", "2026-05-01 10:00")  # 收口后的变化不影响快照
    rep = report(client, rid)
    assert rep["overall"] == 0.0 and "frozenAt" in rep
