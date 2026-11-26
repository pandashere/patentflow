"""Codex review 第 1 轮修复的回归测试。"""
from __future__ import annotations

from tests.helpers import H, db_exec, world
from tests.test_patents import adv, mk, score


def invite(client, pid, uid, by="u1"):  # type: ignore[no-untyped-def]
    assert client.post(f"/api/patents/{pid}/reviewers", json={"userId": uid}, headers=H(by)).status_code == 200


def rv(client, pid, uid, body):  # type: ignore[no-untyped-def]
    return client.post(f"/api/patents/{pid}/reviews", json=body, headers=H(uid))


def test_static_spa_blocks_path_traversal(tmp_path) -> None:  # type: ignore[no-untyped-def]
    from fastapi.testclient import TestClient

    from patentflow.app import create_app
    from patentflow.config import Settings

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("INDEX")
    (tmp_path / "secret.txt").write_text("TOP-SECRET")
    s = Settings(db_path=str(tmp_path / "x.db"), static_dir=str(dist), reminder_interval_seconds=0)
    with TestClient(create_app(s)) as c:
        for path in ("/..%2fsecret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"):
            assert "TOP-SECRET" not in c.get(path).text


def test_reset_link_never_stored_in_app_notifications(client, notifier) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.post("/api/auth/password/forgot", json={"email": "u1@corp.local"})
    texts = [n["text"] for n in client.get("/api/notifications", headers=H("u1")).json()]
    assert texts and all("token=" not in t for t in texts)
    assert "token=" in notifier.sent[-1]["text"]  # 外部渠道仍拿到链接


def test_rollback_into_review_requires_new_votes(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    adv(client, pid)
    invite(client, pid, "r1"); invite(client, pid, "r2")
    rv(client, pid, "r1", score()); rv(client, pid, "r2", score())
    assert adv(client, pid).json()["stage"] == "implementation"
    p = client.post(f"/api/patents/{pid}/rollback", json={"to": "patentability", "reason": "重审"}, headers=H("u1")).json()
    pa = p["stageData"]["patentability"]
    assert pa["round"] == 2 and all(r["score"] is None for r in pa["reviewers"])
    assert adv(client, pid).json()["reason"] == "review_gate"


def test_withdrawn_cross_team_reviewer_loses_access(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    adv(client, pid)
    invite(client, pid, "r1"); invite(client, pid, "r2")
    rv(client, pid, "r1", score("reject", 2, "不行"))
    client.post(f"/api/patents/{pid}/reviews/rounds", headers=H("u1"))
    client.delete(f"/api/patents/{pid}/reviewers/r1", headers=H("u1"))
    assert client.get(f"/api/patents/{pid}", headers=H("r1")).status_code == 404


def test_owner_cannot_review_own_patent_after_transfer(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    adv(client, pid)
    invite(client, pid, "u2"); invite(client, pid, "r1")
    rv(client, pid, "u2", score())
    rv(client, pid, "r1", score())
    client.post(f"/api/patents/{pid}/transfer", json={"to": "u2"}, headers=H("u1"))
    # u2 的票不再计入门禁,也不能再提交
    assert adv(client, pid, "u2").json()["reason"] == "review_gate"
    assert rv(client, pid, "u2", score()).status_code == 403


def test_offboard_private_goes_to_current_team_pl(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    # 现任 PL 是 u2(id 排序在 pl1 之后),pl1 保留 PL 角色
    client.put("/api/teams/t1/pl", json={"userId": "pl1"}, headers=H("gl"))
    client.put("/api/teams/t1/pl", json={"userId": "u2", "demoteOld": False}, headers=H("gl"))
    priv = mk(client, "u1", vis="private")["id"]
    client.post("/api/users/u1/deactivate", json={}, headers=H("gl"))
    assert client.get(f"/api/patents/{priv}", headers=H("u2")).json()["ownerId"] == "u2"


def test_notifications_hidden_after_patent_turns_private(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]  # 团队可见草案
    client.post(f"/api/patents/{pid}/archive", json={"kind": "abandoned", "reason": "x"}, headers=H("u1"))
    client.post(f"/api/patents/{pid}/unarchive", json={"reason": "y"}, headers=H("u1"))
    assert any(n["patentId"] == pid for n in client.get("/api/notifications", headers=H("pl1")).json())
    client.patch(f"/api/patents/{pid}/visibility", json={"visibility": "private"}, headers=H("u1"))
    assert all(n["patentId"] != pid for n in client.get("/api/notifications", headers=H("pl1")).json())


def test_frozen_snapshot_hides_later_private(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client, title="会变私有")["id"]
    client.post("/api/kpi/rules", json={"name": "R", "scope": {"type": "global"}, "cycleId": "c26",
                "targets": [{"stage": "doi", "deadline": "2026-12-31"}]}, headers=H("gl"))
    rid = client.get("/api/kpi/rules", headers=H("gl")).json()[0]["id"]
    client.post("/api/cycles/c26/close", headers=H("gl"))
    assert any(i["patentId"] == pid for i in client.get(f"/api/kpi/rules/{rid}/report", headers=H("gl")).json()["items"])
    client.patch(f"/api/patents/{pid}/visibility", json={"visibility": "private"}, headers=H("u1"))
    assert all(i["patentId"] != pid for i in client.get(f"/api/kpi/rules/{rid}/report", headers=H("gl")).json()["items"])


def test_close_cycle_counts_committed_progress(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    client.post("/api/kpi/rules", json={"name": "R", "scope": {"type": "global"}, "cycleId": "c26",
                "targets": [{"stage": "patentability", "deadline": "2026-12-31"}]}, headers=H("gl"))
    adv(client, pid)
    client.post("/api/cycles/c26/close", headers=H("gl"))
    rid = client.get("/api/kpi/rules", headers=H("gl")).json()[0]["id"]
    assert client.get(f"/api/kpi/rules/{rid}/report", headers=H("gl")).json()["overall"] == 1.0
    assert db_exec  # noqa: B018
