"""Codex review 第 8 轮修复的回归测试。"""
from __future__ import annotations

from tests.helpers import H, world
from tests.test_patents import adv, mk, score


def test_reviewer_access_ends_with_review_stage(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    adv(client, pid)
    for r in ("r1", "r2", "r3"):
        client.post(f"/api/patents/{pid}/reviewers", json={"userId": r}, headers=H("u1"))
    for r in ("r1", "r2"):
        client.post(f"/api/patents/{pid}/reviews", json=score(), headers=H(r))
    assert client.get(f"/api/patents/{pid}", headers=H("r3")).status_code == 200
    adv(client, pid)  # 进入实施
    assert client.get(f"/api/patents/{pid}", headers=H("r3")).status_code == 404


def test_cannot_delete_archived_or_stale(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    p = mk(client)
    client.post(f"/api/patents/{p['id']}/archive", json={"kind": "abandoned", "reason": "x"}, headers=H("pl1"))
    assert client.delete(f"/api/patents/{p['id']}?rev={p['rev']}", headers=H("u1")).status_code == 409
    assert client.delete(f"/api/patents/{p['id']}", headers=H("u1")).status_code == 403


def test_offboarding_keeps_original_owner_as_inventor(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    client.put(f"/api/patents/{pid}/collaborators", json={"userIds": ["u2"]}, headers=H("u1"))
    client.post("/api/users/u1/deactivate", json={"assignments": {pid: "u2"}}, headers=H("gl"))
    p = client.get(f"/api/patents/{pid}", headers=H("u2")).json()
    assert p["ownerId"] == "u2" and p["collaborators"] == ["u1"]


def test_notify_settings_patch_merges_by_stage(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    url = f"/api/patents/{pid}/notification-settings"
    cfg = lambda st, uid: {"stage": st, "userIds": [uid], "includePl": True, "includeOwner": True, "events": ["due"]}  # noqa: E731
    client.patch(url, json={"upsert": [cfg("search", "r1")]}, headers=H("u1"))
    r = client.patch(url, json={"upsert": [cfg("doi", "r2")]}, headers=H("pl1"))  # 另一位有编辑权的人改另一阶段
    assert r.status_code == 200
    stages = {n["stage"] for n in client.get(f"/api/patents/{pid}", headers=H("u1")).json()["notify"]}
    assert stages == {"search", "doi"}
    client.patch(url, json={"remove": ["search"]}, headers=H("u1"))
    assert [n["stage"] for n in client.get(f"/api/patents/{pid}", headers=H("u1")).json()["notify"]] == ["doi"]
