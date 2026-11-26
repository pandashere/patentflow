"""Codex review 第 2 轮修复的回归测试。"""
from __future__ import annotations

from tests.helpers import H, db_exec, world
from tests.test_patents import adv, mk, score


def test_stale_round_vote_rejected(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    adv(client, pid)
    for r in ("r1", "r2"):
        client.post(f"/api/patents/{pid}/reviewers", json={"userId": r}, headers=H("u1"))
    client.post(f"/api/patents/{pid}/reviews", json=score("reject", 2, "不行"), headers=H("r1"))
    client.post(f"/api/patents/{pid}/reviews/rounds", headers=H("u1"))
    # r2 在旧页面(第 1 轮)提交
    r = client.post(f"/api/patents/{pid}/reviews", json={**score(), "round": 1}, headers=H("r2"))
    assert r.status_code == 409 and r.json()["reason"] == "stale_round"
    assert client.post(f"/api/patents/{pid}/reviews", json={**score(), "round": 2}, headers=H("r2")).status_code == 200


def test_setting_password_invalidates_other_links(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    link = client.post("/api/users", json={"name": "甲", "email": "a@corp.local", "teamId": "t1"}, headers=H("gl")).json()["activationLink"]
    activation = link.split("token=")[1]
    forgot = client.post("/api/auth/password/forgot", json={"email": "a@corp.local"}).json()["demoLink"].split("token=")[1]
    assert client.post("/api/auth/password/reset", json={"token": forgot, "password": "first-pass1"}).status_code == 200
    # 旧的激活链接不能再覆盖新密码
    assert client.post("/api/auth/password/reset", json={"token": activation, "password": "evil-pass1"}).status_code == 400


def test_sysadmin_role_change_clears_team_leader(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.put("/api/teams/t1/pl", json={"userId": "pl1"}, headers=H("gl"))
    client.post("/api/sysadmin/login", json={"username": "admin", "password": "rescue-me-123"})
    client.patch("/api/sysadmin/users/pl1", json={"role": "user", "teamId": "t2"})
    client.cookies.clear()
    t1 = next(t for t in client.get("/api/teams", headers=H("gl")).json() if t["id"] == "t1")
    assert t1["plId"] is None


def test_closed_cycle_rules_are_read_only(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    body = {"name": "R", "scope": {"type": "global"}, "cycleId": "c26", "targets": [{"stage": "draft", "deadline": "2026-12-31"}]}
    rid = client.post("/api/kpi/rules", json=body, headers=H("gl")).json()["id"]
    client.post("/api/cycles/c26/close", headers=H("gl"))
    r = client.post("/api/kpi/rules", json={**body, "id": rid, "targets": [{"stage": "doi", "deadline": "2026-12-31"}]}, headers=H("gl"))
    assert r.status_code == 409
    assert client.post("/api/kpi/rules", json=body, headers=H("gl")).status_code == 409


def test_kpi_deadline_must_be_within_cycle(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    r = client.post("/api/kpi/rules", json={"name": "R", "scope": {"type": "global"}, "cycleId": "c26",
                    "targets": [{"stage": "draft", "deadline": "2025-12-31"}]}, headers=H("gl"))
    assert r.status_code == 400


def test_reject_registration_after_forgot_password(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.post("/api/auth/register", json={"name": "新", "email": "n@corp.local", "teamId": "t1", "password": "newpass123"})
    r = client.post("/api/auth/password/forgot", json={"email": "n@corp.local"}).json()
    assert "demoLink" not in r  # 待审批账号不签发链接
    uid = client.get("/api/registrations", headers=H("gl")).json()[0]["id"]
    db_exec(client, "INSERT INTO password_resets VALUES('h', ?, '2026-11-26 10:00', '2026-11-26 11:00', 0)", (uid,))
    assert client.post(f"/api/registrations/{uid}/reject", json={"reason": "x"}, headers=H("gl")).status_code == 200


def test_extension_approval_rechecks_cycle(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    client.post(f"/api/patents/{pid}/cross-cycle", headers=H("gl"))
    e = client.post(f"/api/patents/{pid}/extensions", json={"newDue": "2027-01-15", "reason": "x"}, headers=H("u1")).json()
    eid = e["patent"]["extensions"][-1]["id"]
    client.post(f"/api/patents/{pid}/cross-cycle", headers=H("gl"))  # 取消跨周期
    r = client.post(f"/api/patents/{pid}/extensions/{eid}/approve", headers=H("pl1"))
    assert r.status_code == 409
    assert client.post(f"/api/patents/{pid}/extensions/{eid}/reject", headers=H("pl1")).status_code == 200


def test_private_draft_extension_rules(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    p = mk(client, "u1", vis="private")["id"]
    r = client.post(f"/api/patents/{p}/extensions", json={"newDue": "2026-12-30", "reason": "x"}, headers=H("u1"))
    assert r.json()["code"] == "private_over_threshold"
    q = mk(client, "pl1", vis="private")["id"]
    e = client.post(f"/api/patents/{q}/extensions", json={"newDue": "2026-12-30", "reason": "x"}, headers=H("pl1")).json()
    eid = e["patent"]["extensions"][-1]["id"]
    p2 = client.post(f"/api/patents/{q}/extensions/{eid}/approve", headers=H("pl1")).json()
    assert p2["extensions"][-1]["selfApproved"] is True


def test_migrate_notifies_new_team_pl(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    client.post(f"/api/patents/{pid}/team", json={"teamId": "t2"}, headers=H("gl"))
    assert any("已迁移至" in n["text"] for n in client.get("/api/notifications", headers=H("pl2")).json())
    assert not any("已迁移至" in n["text"] for n in client.get("/api/notifications", headers=H("pl1")).json())


def test_abandon_on_cutoff_day_stays_in_denominator(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client, title="分界日放弃")["id"]
    db_exec(client, "UPDATE patents SET archived=? WHERE id=?",
            ('{"kind":"abandoned","at":"2026-12-01 10:00","by":"u1","reason":"x"}', pid))
    rid = client.post("/api/kpi/rules", json={"name": "R", "scope": {"type": "global"}, "cycleId": "c26",
                      "targets": [{"stage": "doi", "deadline": "2026-12-31"}]}, headers=H("gl")).json()["id"]
    assert [i["title"] for i in client.get(f"/api/kpi/rules/{rid}/report", headers=H("gl")).json()["items"]] == ["分界日放弃"]
