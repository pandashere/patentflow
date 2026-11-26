"""Codex review 第 9 轮修复的回归测试。"""
from __future__ import annotations

from tests.helpers import H, world
from tests.test_patents import adv, mk


def test_tightened_visibility_stops_outside_recipients(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client, vis="public")["id"]
    cfg = [{"stage": "draft", "userIds": ["u3"], "includePl": False, "includeOwner": False, "events": ["transition"]}]
    client.put(f"/api/patents/{pid}/notification-settings", json=cfg, headers=H("u1"))
    client.patch(f"/api/patents/{pid}/visibility", json={"visibility": "team"}, headers=H("u1"))
    client.post(f"/api/patents/{pid}/archive", json={"kind": "abandoned", "reason": "x"}, headers=H("u1"))
    import sqlite3

    with sqlite3.connect(client.app.state.settings.db_path) as c:
        n = c.execute("SELECT COUNT(*) FROM notifications WHERE user_id='u3' AND text LIKE '%放弃归档%'").fetchone()[0]
    assert n == 0


def test_webhook_url_hidden_from_non_gl(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.put("/api/config", json={"webhookUrl": "https://im.corp/hook?key=SECRET"}, headers=H("gl"))
    assert "SECRET" not in client.get("/api/config", headers=H("u1")).json()["webhookUrl"]
    assert "SECRET" in client.get("/api/config", headers=H("gl")).json()["webhookUrl"]


def test_stale_kpi_rule_form_rejected(client) -> None:  # type: ignore[no-untyped-def]
    from patentflow import timeutil
    from datetime import datetime

    world(client)
    body = {"name": "R", "scope": {"type": "global"}, "cycleId": "c26", "targets": [{"stage": "doi", "deadline": "2026-12-01"}]}
    rule = client.post("/api/kpi/rules", json=body, headers=H("gl")).json()
    timeutil.freeze(datetime(2026, 11, 26, 10, 5))
    client.post("/api/kpi/rules", json={**rule, "targets": [{"stage": "doi", "deadline": "2026-12-15"}]}, headers=H("gl"))
    r = client.post("/api/kpi/rules", json={**rule, "name": "改名"}, headers=H("gl"))  # 旧表单
    assert r.status_code == 409


def test_no_review_reminder_for_new_owner(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    adv(client, pid)
    client.post(f"/api/patents/{pid}/reviewers", json={"userId": "u2"}, headers=H("u1"))
    client.post(f"/api/patents/{pid}/transfer", json={"to": "u2"}, headers=H("u1"))
    from tests.test_reminders import run
    from patentflow import timeutil
    from datetime import datetime

    timeutil.freeze(datetime(2026, 11, 30, 9, 0))
    run(client)
    texts = [n["text"] for n in client.get("/api/notifications", headers=H("u2")).json()]
    assert not any(t.startswith("请审查《") for t in texts), texts
