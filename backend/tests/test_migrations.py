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
