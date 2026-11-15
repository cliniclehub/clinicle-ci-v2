"""Shared pytest fixtures — local Postgres via make start-db."""

from __future__ import annotations

import os
from typing import Callable, Generator
from urllib.parse import urlparse

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

# Use "test" (not "unittest") so database_pool accepts Postgres URLs.
os.environ.setdefault("ENVIRONMENT", "test")

DEFAULT_TEST_DATABASE_URL = (
    "postgresql://ci_user:ci_user@localhost:5432/ci_db_unit_test"
)

_test_db_url = os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)
os.environ.setdefault("TEST_DATABASE_URL", _test_db_url)
os.environ.setdefault("DATABASE_URL", _test_db_url)

import app.v1.models  # noqa: F401 — register ORM mappers before integration fixtures


def _admin_database_url(url: str) -> str:
    parsed = urlparse(url)
    return parsed._replace(path="/postgres").geturl()


def _ensure_test_database(url: str) -> None:
    db_name = urlparse(url).path.lstrip("/") or "ci_db_unit_test"
    admin_engine = create_engine(_admin_database_url(url), isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": db_name},
            ).scalar()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    finally:
        admin_engine.dispose()


@pytest.fixture(scope="session")
def test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


@pytest.fixture(scope="session")
def test_engine(test_database_url: str) -> Generator[Engine, None, None]:
    engine = create_engine(test_database_url, pool_pre_ping=True)
    with engine.connect() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS app"))
        conn.commit()
    # Schema comes from ci_db via make setup-test-db. No create_all.
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def test_session_factory(test_engine: Engine):
    return sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture
def db_session(test_session_factory, test_engine) -> Generator[Session, None, None]:
    """Per-test session with nested savepoint rollback."""
    connection = test_engine.connect()
    transaction = connection.begin()
    session = test_session_factory(bind=connection)
    nested = connection.begin_nested()

    @event.listens_for(session, "after_transaction_end")
    def _restart_savepoint(sess: Session, trans) -> None:
        nonlocal nested
        if trans.nested and not trans._parent.nested:
            nested = connection.begin_nested()

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def create_org(db_session: Session) -> Callable:
    from uuid import uuid4

    from app.v1.organizations.model import Organization

    def _create(name: str | None = None) -> Organization:
        suffix = uuid4().hex[:8]
        org = Organization(
            name=name or f"Test Org {suffix}",
            domain=f"test-{suffix}.example.com",
        )
        db_session.add(org)
        db_session.flush()
        return org

    return _create


def pytest_configure(config):
    config.addinivalue_line("markers", "unit: pure unit test (no database)")
    config.addinivalue_line("markers", "integration: requires Postgres (make start-db)")
    config.addinivalue_line("markers", "slow: slow-running test")
