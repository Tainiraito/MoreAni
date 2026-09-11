"""数据库迁移执行器。

迁移必须按固定 revision 顺序执行，并在成功后写入版本表。迁移异常会向上抛出，
让应用启动失败，而不是带着不完整的数据库结构继续提供请求。
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from sqlalchemy import Engine, text

MIGRATION_TABLE = 'schema_migrations'


@dataclass(frozen=True)
class Migration:
    """一个可重复检查、成功后记录的数据库迁移步骤。"""

    revision: str
    description: str
    upgrade: Callable[[], None]


def run_pending_migrations(engine: Engine, migrations: Sequence[Migration]) -> None:
    """执行尚未记录的迁移；任一步骤失败都会阻止应用启动。"""
    with engine.begin() as connection:
        connection.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {MIGRATION_TABLE} (
                    revision VARCHAR(128) PRIMARY KEY,
                    description VARCHAR(255) NOT NULL,
                    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """,
            ),
        )

    with engine.connect() as connection:
        applied = {
            row[0]
            for row in connection.execute(
                text(f'SELECT revision FROM {MIGRATION_TABLE}'),
            )
        }

    for migration in migrations:
        if migration.revision in applied:
            continue

        migration.upgrade()
        with engine.begin() as connection:
            connection.execute(
                text(
                    f'INSERT INTO {MIGRATION_TABLE} (revision, description) VALUES (:revision, :description)',
                ),
                {'revision': migration.revision, 'description': migration.description},
            )
