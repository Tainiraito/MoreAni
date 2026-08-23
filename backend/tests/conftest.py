import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from auth import create_access_token, get_password_hash  # noqa: E402
from database import Base, get_db  # noqa: E402
from main import app  # noqa: E402
from models import User  # noqa: E402


@pytest.fixture
def db_engine(tmp_path):
    engine = create_engine(
        f'sqlite:///{tmp_path / "test.db"}',
        connect_args={'check_same_thread': False, 'timeout': 10},
    )

    @event.listens_for(engine, 'connect')
    def enable_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute('PRAGMA foreign_keys=ON')
        cursor.close()

    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def session_factory(db_engine):
    return sessionmaker(bind=db_engine, autocommit=False, autoflush=False)


@pytest.fixture
def db(session_factory) -> Iterator[Session]:
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(session_factory) -> Iterator[TestClient]:
    def override_db():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_db
    test_client = TestClient(app)
    try:
        yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def make_user(db):
    created: list[User] = []

    def factory(
        username: str,
        role: str = 'user',
        avatar_url: str | None = None,
        avatar_crop: str | None = None,
    ) -> User:
        user = User(
            username=username,
            nickname=f'{username}-nick',
            password_hash=get_password_hash('a-test-password'),
            role=role,
            avatar_url=avatar_url,
            avatar_crop=avatar_crop,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        created.append(user)
        return user

    return factory


def auth_cookie(user: User) -> dict[str, str]:
    return {'access_token': create_access_token({'sub': user.id})}
