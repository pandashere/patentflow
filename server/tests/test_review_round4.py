"""Codex review 第 4 轮修复的回归测试。"""
from __future__ import annotations

from tests.helpers import H, db_exec, world
from tests.test_patents import mk


def test_gl_cannot_change_member_email(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.patch("/api/users/u1", json={"email": "attacker@corp.local"}, headers=H("gl"))
    u1 = next(u for u in client.get("/api/users", headers=H("gl")).json() if u["id"] == "u1")
    assert u1["email"] == "u1@corp.local"


def test_private_drafts_do_not_consume_formal_numbers(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    a = mk(client)["code"]
    priv = mk(client, vis="private")
    c = mk(client)["code"]
    assert (a, c) == ("PF-2026-001", "PF-2026-002") and priv["code"].startswith("DRAFT-")
    p = client.patch(f"/api/patents/{priv['id']}/visibility", json={"visibility": "team"}, headers=H("u1")).json()
    assert p["code"] == "PF-2026-003"


def test_shortening_cycle_clamps_dates(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]  # draft due 2026-12-10
    rid = client.post("/api/kpi/rules", json={"name": "R", "scope": {"type": "global"}, "cycleId": "c26",
                      "targets": [{"stage": "doi", "deadline": "2026-12-20"}]}, headers=H("gl")).json()["id"]
    client.post("/api/cycles", json={"id": "c26", "name": "2026", "start": "2026-01-01", "end": "2026-12-01"}, headers=H("gl"))
    assert client.get(f"/api/patents/{pid}", headers=H("u1")).json()["dueDates"]["draft"] == "2026-12-01"
    rule = next(r for r in client.get("/api/kpi/rules", headers=H("gl")).json() if r["id"] == rid)
    assert rule["targets"][0]["deadline"] == "2026-12-01"


def test_new_patent_prefers_active_cycle(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    db_exec(client, "UPDATE cycles SET end='2026-12-01', status='closed', closed_at='2026-11-20 10:00' WHERE id='c26'")
    db_exec(client, "INSERT INTO cycles VALUES('c27','新周期','2026-11-25','2027-06-30','active',NULL)")
    p = mk(client)
    assert p["dueDates"]["draft"] == "2026-12-10"  # 未被已收口旧周期(12-01 结束)截断


def test_team_pl_notification_follows_assignment(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.put("/api/teams/t1/pl", json={"userId": "gl"}, headers=H("gl"))  # GL 兼任 t1 负责人,pl1 降级
    cfg = [{"stage": "draft", "userIds": [], "includePl": True, "includeOwner": False, "events": ["transition"]}]
    pid = mk(client)["id"]
    rows = client.post(f"/api/patents/{pid}/notification-settings/preview", json={"event": "transition", "config": cfg},
                       headers=H("u1")).json()["recipients"]
    assert [r["id"] for r in rows] == ["gl"]


def test_reject_registration_requires_reason(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.post("/api/auth/register", json={"name": "新", "email": "n@corp.local", "teamId": "t1", "password": "newpass123"})
    uid = client.get("/api/registrations", headers=H("gl")).json()[0]["id"]
    assert client.post(f"/api/registrations/{uid}/reject", json={"reason": "  "}, headers=H("gl")).status_code == 400
    client.post("/api/sysadmin/login", json={"username": "admin", "password": "rescue-me-123"})
    assert client.post(f"/api/sysadmin/registrations/{uid}/reject", json={}).status_code == 400
    assert client.post(f"/api/sysadmin/registrations/{uid}/reject", json={"reason": "非员工"}).status_code == 200


def test_private_transfer_voids_pending_extension(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client, "pl1", vis="private")["id"]
    client.post(f"/api/patents/{pid}/extensions", json={"newDue": "2026-12-30", "reason": "x"}, headers=H("pl1"))
    p = client.post(f"/api/patents/{pid}/transfer", json={"to": "u1"}, headers=H("pl1")).json()
    assert p["extensions"][-1]["status"] == "void"
