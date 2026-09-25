from sqlalchemy import create_engine, text

from migrations import Migration, run_pending_migrations


def test_pending_migrations_are_recorded_and_idempotent(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "migrations.db"}')
    calls: list[str] = []

    migrations = [
        Migration('0001-first', 'first migration', lambda: calls.append('first')),
        Migration('0002-second', 'second migration', lambda: calls.append('second')),
    ]

    run_pending_migrations(engine, migrations)
    run_pending_migrations(engine, migrations)

    assert calls == ['first', 'second']
    with engine.connect() as connection:
        revisions = connection.execute(text('SELECT revision FROM schema_migrations ORDER BY revision')).scalars().all()
    assert revisions == ['0001-first', '0002-second']


def test_migration_failure_is_propagated_and_not_recorded(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "failed-migrations.db"}')

    def fail() -> None:
        raise RuntimeError('schema change failed')

    try:
        run_pending_migrations(engine, [Migration('0001-failing', 'failing migration', fail)])
    except RuntimeError as exc:
        assert str(exc) == 'schema change failed'
    else:
        raise AssertionError('expected migration failure to stop startup')

    with engine.connect() as connection:
        revisions = connection.execute(text('SELECT revision FROM schema_migrations')).scalars().all()
    assert revisions == []


def test_pre_red_blue_database_upgrades_with_legacy_rating_and_revision_rows(tmp_path, monkeypatch):
    """旧评分表尚无 score_anchor 时，应先建立修订基线再应用红蓝迁移。"""
    from sqlalchemy.orm import sessionmaker

    import main
    from database import Base

    engine = create_engine(f'sqlite:///{tmp_path / "pre-red-blue.db"}')
    monkeypatch.setattr(main, 'engine', engine)
    monkeypatch.setattr(main, 'SessionLocal', sessionmaker(bind=engine, autocommit=False, autoflush=False))
    Base.metadata.create_all(engine, tables=[table for table in Base.metadata.sorted_tables if table.name != 'ratings'])

    with engine.begin() as connection:
        connection.execute(
            text(
                'CREATE TABLE ratings ('
                'id INTEGER PRIMARY KEY, content_id INTEGER NOT NULL, user_id INTEGER NOT NULL, '
                "score INTEGER NOT NULL DEFAULT 0, recommend INTEGER NOT NULL DEFAULT 0, review TEXT DEFAULT '', "
                'created_at DATETIME, updated_at DATETIME, UNIQUE(content_id, user_id))',
            ),
        )
        connection.execute(
            text(
                'INSERT INTO users (id, username, nickname, password_hash, role) '
                "VALUES (1, 'stage8-user', 'Stage 8 User', 'unused', 'user')",
            ),
        )
        connection.execute(
            text(
                'INSERT INTO content_items (id, title, content_type, created_by) '
                "VALUES (1, 'Legacy comparison rated', 'anime', 1), "
                "(2, 'Legacy rating without revision', 'anime', 1)",
            ),
        )
        connection.execute(
            text(
                'INSERT INTO ratings (id, content_id, user_id, score, review) '
                "VALUES (1, 1, 1, 83, 'preserve me'), (2, 2, 1, 72, 'baseline me')",
            ),
        )
        connection.execute(
            text(
                'INSERT INTO rating_revisions '
                '(id, rating_id, content_id, user_id, previous_score, new_score, changed_at, source, comparison_id) '
                "VALUES (1, 1, 1, 1, 80, 83, CURRENT_TIMESTAMP, 'comparison', 'legacy-cmp-7')",
            ),
        )

    run_pending_migrations(engine, main.MIGRATIONS)
    run_pending_migrations(engine, main.MIGRATIONS)

    with engine.connect() as connection:
        ratings = connection.execute(
            text('SELECT id, score, score_anchor, review FROM ratings ORDER BY id'),
        ).all()
        revisions = connection.execute(
            text(
                'SELECT rating_id, previous_score, new_score, source, comparison_id FROM rating_revisions ORDER BY id',
            ),
        ).all()
        applied = connection.execute(text('SELECT COUNT(*) FROM schema_migrations')).scalar_one()

    assert [tuple(row) for row in ratings] == [
        (1, 83, 83, 'preserve me'),
        (2, 72, 72, 'baseline me'),
    ]
    assert [tuple(row) for row in revisions] == [
        (1, 80, 83, 'comparison', 'legacy-cmp-7'),
        (2, 0, 72, 'migration_snapshot', None),
    ]
    assert applied == len(main.MIGRATIONS)
    engine.dispose()


def test_interrupted_resource_subscription_migration_recovers_and_drops_legacy_table(tmp_path, monkeypatch):
    """旧表迁移中断后，新表已复制的行应保留且 legacy 表可安全删除。"""
    import main
    from database import Base

    engine = create_engine(f'sqlite:///{tmp_path / "subscription-recovery.db"}')
    monkeypatch.setattr(main, 'engine', engine)
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                'INSERT INTO users (id, username, nickname, password_hash, role) '
                "VALUES (1, 'subscription-stage8', 'Stage 8', 'unused', 'user')",
            ),
        )
        connection.execute(
            text(
                'INSERT INTO content_items (id, title, content_type, created_by) '
                "VALUES (1, 'Subscription row', 'anime', 1)",
            ),
        )
        connection.execute(
            text(
                'INSERT INTO resource_subscriptions '
                '(id, user_id, content_id, subject_id, source, fansub_key, fansub_name, active) '
                "VALUES (7, 1, 1, 100, 'animegarden', 'fansub-a', 'Fansub A', 1)",
            ),
        )
        connection.execute(
            text(
                'CREATE TABLE resource_subscriptions_legacy ('
                'id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, content_id INTEGER NOT NULL, '
                'subject_id INTEGER NOT NULL, fansub_key VARCHAR(120) NOT NULL, '
                'fansub_name VARCHAR(120) NOT NULL, active BOOLEAN NOT NULL, '
                'last_seen_created_at DATETIME, last_seen_resource_key VARCHAR(255), '
                'created_at DATETIME, updated_at DATETIME)',
            ),
        )
        connection.execute(
            text(
                'INSERT INTO resource_subscriptions_legacy '
                '(id, user_id, content_id, subject_id, fansub_key, fansub_name, active) '
                "VALUES (7, 1, 1, 100, 'fansub-a', 'Fansub A', 1)",
            ),
        )

    main._migrate_interrupted_resource_subscription_cleanup()
    main._migrate_interrupted_resource_subscription_cleanup()

    with engine.connect() as connection:
        subscriptions = connection.execute(
            text('SELECT id, source, fansub_key FROM resource_subscriptions'),
        ).all()
        legacy_tables = connection.execute(
            text("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='resource_subscriptions_legacy'"),
        ).scalar_one()
        foreign_key_violations = connection.execute(
            text('PRAGMA foreign_key_check(resource_subscriptions)'),
        ).all()
    assert [tuple(row) for row in subscriptions] == [(7, 'animegarden', 'fansub-a')]
    assert legacy_tables == 0
    assert foreign_key_violations == []
    engine.dispose()
