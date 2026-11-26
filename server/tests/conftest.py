from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from patentflow import timeutil
from patentflow.app import create_app
from patentflow.config import Settings
from patentflow.notify import LoggingNotifier


@pytest.fixture(autouse=True)
def frozen_time() -> Iterator[None]:
    timeutil.freeze(datetime(2026, 11, 26, 10, 0))
    yield
    timeutil.freeze(None)


@pytest.fixture
def notifier() -> LoggingNotifier:
    return LoggingNotifier()


@pytest.fixture
def app(tmp_path, notifier):  # type: ignore[no-untyped-def]
    s = Settings(db_path=str(tmp_path / "t.db"), demo=True, reminder_interval_seconds=0,
                 sysadmin_username="admin", sysadmin_password="rescue-me-123")
    return create_app(s, notifier)


@pytest.fixture
def client(app) -> Iterator[TestClient]:  # type: ignore[no-untyped-def]
    with TestClient(app) as c:
        yield c
