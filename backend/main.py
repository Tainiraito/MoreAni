"""MoreAni v2 — FastAPI application entry point.

Includes all v1 routers under /api/v1, CORS middleware,
rate limit middleware, and creates tables on startup.
"""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope

from database import Base, SessionLocal, engine
from middleware import OriginGuardMiddleware, RateLimitMiddleware, SecurityHeadersMiddleware
from migrations import Migration, run_pending_migrations
from models import (
    ContentItem,
    PreferenceModelRun,
    PreferenceResult,
    Rating,
    RatingRevision,
    RatingRevisionSource,
    RedBlueComparison,
    RedBlueUserState,
    ResourceSubscription,
    ScoreSuggestion,
    ScoreSuggestionAction,
)
from routers.v1.admin import router as admin_router
from routers.v1.airing import router as airing_router
from routers.v1.analytics import router as analytics_router
from routers.v1.auth import router as auth_router
from routers.v1.bangumi import router as bangumi_router
from routers.v1.content import router as content_router
from routers.v1.notifications import router as notifications_router
from routers.v1.notifications import subscription_router
from routers.v1.proxy import close_proxy_clients
from routers.v1.proxy import router as proxy_router
from routers.v1.rating import router as rating_router
from routers.v1.red_blue import router as red_blue_router
from routers.v1.status import router as status_router
from routers.v1.tag import router as tag_router
from routers.v1.user import router as user_router
from services import covers as covers_svc
from services.airing_calendar import run_worker as run_airing_calendar_worker
from services.bangumi import close_bangumi_clients
from services.mikan import close_mikan_clients
from services.notifications import run_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the development schema and apply recorded migrations on startup."""
    Base.metadata.create_all(bind=engine)
    run_pending_migrations(engine, MIGRATIONS)
    worker_task = None
    airing_task = None
    stop_event = asyncio.Event()
    worker_enabled = os.getenv('MOREANI_NOTIFICATION_WORKER', 'false').lower() in {'1', 'true', 'yes', 'on'}
    if worker_enabled:
        interval = max(60, int(os.getenv('MOREANI_NOTIFICATION_INTERVAL_SECONDS', '1800')))
        worker_task = asyncio.create_task(run_worker(stop_event, interval_seconds=interval))
    airing_enabled = os.getenv('MOREANI_AIRING_CALENDAR_WORKER', 'true').lower() in {'1', 'true', 'yes', 'on'}
    if airing_enabled:
        airing_task = asyncio.create_task(run_airing_calendar_worker(stop_event))
    try:
        yield
    finally:
        if worker_task or airing_task:
            stop_event.set()
        if worker_task:
            await worker_task
        if airing_task:
            await airing_task
        await close_mikan_clients()
        await close_bangumi_clients()
        await close_proxy_clients()


def _migrate_invite_codes_expires() -> None:
    """SQLite 轻量迁移：invite_codes 表补 expires_at 列（幂等）。"""
    try:
        from sqlalchemy import text

        with engine.connect() as conn:
            cols = [r[1] for r in conn.execute(text('PRAGMA table_info(invite_codes)'))]
            if cols and 'expires_at' not in cols:
                conn.execute(text('ALTER TABLE invite_codes ADD COLUMN expires_at DATETIME'))
                conn.commit()
                print('[migrate] invite_codes.expires_at 已添加')
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f'[migrate] invite_codes 迁移失败: {e}') from e

    # users.avatar_url（头像上传）
    try:
        from sqlalchemy import text

        with engine.connect() as conn:
            cols = [r[1] for r in conn.execute(text('PRAGMA table_info(users)'))]
            if cols and 'avatar_url' not in cols:
                conn.execute(text('ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255)'))
                conn.commit()
                print('[migrate] users.avatar_url 已添加')
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f'[migrate] users.avatar_url 迁移失败: {e}') from e


def _migrate_users_avatar_crop() -> None:
    """SQLite 轻量迁移：users 表补 avatar_crop 列（幂等）。"""
    try:
        from sqlalchemy import text

        with engine.connect() as conn:
            cols = [r[1] for r in conn.execute(text('PRAGMA table_info(users)'))]
            if cols and 'avatar_crop' not in cols:
                conn.execute(text('ALTER TABLE users ADD COLUMN avatar_crop TEXT'))
                conn.commit()
                print('[migrate] users.avatar_crop 已添加')
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f'[migrate] users.avatar_crop 迁移失败: {e}') from e


def _migrate_legacy_anime_movies() -> None:
    """Move Bangumi-linked legacy movie records into the explicit anime_movie type."""
    try:
        with SessionLocal() as db:
            candidates = (
                db.query(ContentItem)
                .filter(
                    ContentItem.content_type == 'movie',
                    ContentItem.source_type == 'bangumi',
                    ContentItem.source_id.isnot(None),
                    ContentItem.source_id != '',
                )
                .all()
            )
            migrated = 0
            for item in candidates:
                try:
                    if int(item.source_id) <= 0:
                        continue
                except (TypeError, ValueError):
                    continue
                item.content_type = 'anime_movie'
                migrated += 1
            if migrated:
                db.commit()
            print(f'[migrate] legacy anime_movie 条目: {migrated}')
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'[migrate] anime_movie 迁移失败: {exc}') from exc


def _migrate_resource_subscriptions() -> None:
    """Upgrade subscriptions to source-aware rows while preserving cursors."""
    from sqlalchemy import text

    table_name = ResourceSubscription.__tablename__
    try:
        with engine.connect() as conn:
            columns = [row[1] for row in conn.execute(text(f'PRAGMA table_info({table_name})'))]
            if not columns:
                return
            indexes = []
            for index in conn.execute(text(f'PRAGMA index_list({table_name})')).mappings():
                index_name = index['name']
                index_columns = [row[2] for row in conn.execute(text(f'PRAGMA index_info("{index_name}")'))]
                indexes.append((bool(index['unique']), index_columns))
            has_new_unique = any(
                unique and index_columns == ['user_id', 'subject_id', 'source', 'fansub_key']
                for unique, index_columns in indexes
            )
            if {'source', 'fansub_id'} <= set(columns) and has_new_unique:
                return

        legacy_table = f'{table_name}_legacy'
        with engine.begin() as conn:
            conn.exec_driver_sql('PRAGMA foreign_keys=OFF')
            conn.exec_driver_sql(f'ALTER TABLE {table_name} RENAME TO {legacy_table}')
            ResourceSubscription.__table__.create(conn)
            source_expr = "COALESCE(source, 'animegarden')" if 'source' in columns else "'animegarden'"
            fansub_id_expr = 'fansub_id' if 'fansub_id' in columns else 'NULL'
            conn.execute(
                text(
                    f"""INSERT INTO {table_name} (
                        id, user_id, content_id, subject_id, source, fansub_key,
                        fansub_name, fansub_id, active, last_seen_created_at,
                        last_seen_resource_key, created_at, updated_at
                    )
                    SELECT id, user_id, content_id, subject_id, {source_expr}, fansub_key,
                        fansub_name, {fansub_id_expr}, active, last_seen_created_at,
                        last_seen_resource_key, created_at, updated_at
                    FROM {legacy_table}""",
                )
            )
            conn.exec_driver_sql(f'DROP TABLE {legacy_table}')
            conn.exec_driver_sql('PRAGMA foreign_keys=ON')
        print('[migrate] resource_subscriptions 已升级为多资源源订阅表')
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'[migrate] resource_subscriptions 迁移失败: {exc}') from exc


def _migrate_legacy_cover_assets() -> None:
    """Register existing content-id cover files without downloading them again."""
    try:
        with SessionLocal() as db:
            migrated = covers_svc.register_legacy_local_covers(db)
            print(f'[migrate] legacy cover assets: {migrated}')
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'[migrate] cover_assets 迁移失败: {exc}') from exc


def _migrate_airing_calendar_failure_tracking() -> None:
    """SQLite 轻量迁移：为周历同步状态增加连续失败通知字段（幂等）。"""
    try:
        from sqlalchemy import text

        with engine.begin() as conn:
            columns = {row[1] for row in conn.execute(text('PRAGMA table_info(airing_calendar_sync_state)'))}
            if not columns:
                return
            additions = {
                'consecutive_failure_days': 'INTEGER NOT NULL DEFAULT 0',
                'last_failure_at': 'DATETIME',
                'failure_notified_at': 'DATETIME',
            }
            for column, definition in additions.items():
                if column not in columns:
                    conn.execute(
                        text(f'ALTER TABLE airing_calendar_sync_state ADD COLUMN {column} {definition}'),
                    )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'[migrate] airing calendar failure tracking 迁移失败: {exc}') from exc


def _migrate_rating_revisions() -> None:
    """Create a baseline snapshot for existing positive ratings, once."""
    from sqlalchemy import text

    try:
        with engine.begin() as conn:
            rating_columns = {
                row[1] for row in conn.execute(text('PRAGMA table_info(ratings)'))
            }
            revision_columns = {
                row[1] for row in conn.execute(text('PRAGMA table_info(rating_revisions)'))
            }
            if not rating_columns or not revision_columns:
                return

            required_rating_columns = {'id', 'content_id', 'user_id', 'score'}
            required_revision_columns = {
                'rating_id',
                'content_id',
                'user_id',
                'previous_score',
                'new_score',
                'changed_at',
                'source',
            }
            if not required_rating_columns <= rating_columns:
                raise RuntimeError('ratings 表缺少建立历史评分基线所需字段')
            if not required_revision_columns <= revision_columns:
                raise RuntimeError('rating_revisions 表缺少建立历史评分基线所需字段')

            revision_values = {
                'rating_id': 'ratings.id',
                'content_id': 'ratings.content_id',
                'user_id': 'ratings.user_id',
                'previous_score': '0',
                'new_score': 'ratings.score',
                'changed_at': 'CURRENT_TIMESTAMP',
                'source': "'migration_snapshot'",
            }
            columns = [column for column in revision_values if column in revision_columns]
            inserted = conn.execute(
                text(
                    'INSERT INTO rating_revisions ('
                    + ', '.join(columns)
                    + ') SELECT '
                    + ', '.join(revision_values[column] for column in columns)
                    + ' FROM ratings WHERE ratings.score > 0 '
                    'AND NOT EXISTS (SELECT 1 FROM rating_revisions '
                    'WHERE rating_revisions.rating_id = ratings.id)',
                ),
            )
            snapshot_count = max(inserted.rowcount, 0)
        if snapshot_count:
            print(f'[migrate] rating revisions baseline snapshots: {snapshot_count}')
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'[migrate] rating revisions 迁移失败: {exc}') from exc

def _migrate_red_blue_preference_foundation() -> None:
    """建立红蓝合战事实、模型运行、排名快照和评分建议基础结构。"""
    from sqlalchemy import text

    try:
        # 显式按外键依赖顺序创建，兼容直接运行迁移函数的场景；正常启动前
        # Base.metadata.create_all 已经执行过，这些操作仍然是幂等的。
        with engine.begin() as conn:
            for table in (
                RedBlueComparison.__table__,
                PreferenceModelRun.__table__,
                PreferenceResult.__table__,
                ScoreSuggestion.__table__,
                ScoreSuggestionAction.__table__,
            ):
                table.create(bind=conn, checkfirst=True)

            rating_columns = {
                row[1]
                for row in conn.execute(text('PRAGMA table_info(ratings)'))
            }
            score_anchor_added = 'score_anchor' not in rating_columns
            if score_anchor_added:
                conn.execute(
                    text(
                        'ALTER TABLE ratings '
                        'ADD COLUMN score_anchor INTEGER NOT NULL DEFAULT 0',
                    ),
                )
                # 只在首次补列时初始化；若未来迁移已存在该列，绝不覆盖用户
                # 已经形成的独立评分锚点。
                conn.execute(text('UPDATE ratings SET score_anchor = score'))

            conn.execute(
                text(
                    'CREATE INDEX IF NOT EXISTS ix_ratings_user_score_anchor '
                    'ON ratings (user_id, score_anchor)',
                ),
            )

            revision_columns = {
                row[1]
                for row in conn.execute(text('PRAGMA table_info(rating_revisions)'))
            }
            if 'score_suggestion_id' not in revision_columns:
                conn.execute(
                    text(
                        'ALTER TABLE rating_revisions '
                        'ADD COLUMN score_suggestion_id INTEGER '
                        'REFERENCES score_suggestions(id) ON DELETE SET NULL',
                    ),
                )
            if 'score_suggestion_action_id' not in revision_columns:
                conn.execute(
                    text(
                        'ALTER TABLE rating_revisions '
                        'ADD COLUMN score_suggestion_action_id INTEGER '
                        'REFERENCES score_suggestion_actions(id) ON DELETE SET NULL',
                    ),
                )
            conn.execute(
                text(
                    'CREATE INDEX IF NOT EXISTS ix_rating_revisions_score_suggestion_id '
                    'ON rating_revisions (score_suggestion_id)',
                ),
            )
            conn.execute(
                text(
                    'CREATE INDEX IF NOT EXISTS ix_rating_revisions_score_suggestion_action_id '
                    'ON rating_revisions (score_suggestion_action_id)',
                ),
            )

        if score_anchor_added:
            print('[migrate] ratings.score_anchor 已按当前评分初始化')
        print('[migrate] 红蓝合战偏好模型基础表已就绪')
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'[migrate] 红蓝合战偏好模型基础结构迁移失败: {exc}') from exc


def _migrate_preference_model_run_input_metadata() -> None:
    """为模型运行补充 score_anchor watermark 和算法配置快照。"""
    from sqlalchemy import text

    try:
        with engine.begin() as conn:
            columns = {
                row[1]
                for row in conn.execute(text('PRAGMA table_info(preference_model_runs)'))
            }
            if not columns:
                return
            if 'input_rating_revision_max_id' not in columns:
                conn.execute(
                    text(
                        'ALTER TABLE preference_model_runs '
                        'ADD COLUMN input_rating_revision_max_id INTEGER',
                    ),
                )
            if 'algorithm_config_json' not in columns:
                conn.execute(
                    text(
                        "ALTER TABLE preference_model_runs "
                        "ADD COLUMN algorithm_config_json TEXT NOT NULL DEFAULT '{}'",
                    ),
                )
            conn.execute(
                text(
                    'CREATE INDEX IF NOT EXISTS ix_preference_model_runs_user_input_watermarks '
                    'ON preference_model_runs '
                    '(user_id, input_comparison_max_id, input_rating_revision_max_id)',
                ),
            )
        print('[migrate] preference_model_runs 输入 watermark 和算法配置已就绪')
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'[migrate] 模型运行输入元数据迁移失败: {exc}') from exc


def _migrate_red_blue_realtime_state() -> None:
    """补充实时 Fast State 所需的 comparison watermark 和用户状态表。"""
    from sqlalchemy import text

    try:
        with engine.begin() as conn:
            RedBlueUserState.__table__.create(bind=conn, checkfirst=True)
            columns = {
                row[1]
                for row in conn.execute(text('PRAGMA table_info(preference_model_runs)'))
            }
            if columns:
                if 'input_comparison_state_version' not in columns:
                    conn.execute(
                        text(
                            'ALTER TABLE preference_model_runs '
                            'ADD COLUMN input_comparison_state_version INTEGER NOT NULL DEFAULT 0',
                        ),
                    )
                if 'input_revoke_version' not in columns:
                    conn.execute(
                        text(
                            'ALTER TABLE preference_model_runs '
                            'ADD COLUMN input_revoke_version INTEGER NOT NULL DEFAULT 0',
                        ),
                    )
                conn.execute(
                    text(
                        'CREATE INDEX IF NOT EXISTS ix_preference_model_runs_user_realtime_watermarks '
                        'ON preference_model_runs '
                        '(user_id, input_comparison_state_version, input_revoke_version)',
                    ),
                )

            # 对 4B 之前已经存在的事实建立保守 watermark；旧 Model Run 的新字段
            # 默认 0，若无法证明兼容，Service 会要求重新 Full Ranker。
            conn.execute(
                text(
                    """
                    INSERT OR IGNORE INTO red_blue_user_states (
                        user_id, comparison_state_version, revoke_version, updated_at
                    )
                    SELECT user_id,
                           COUNT(*) AS comparison_state_version,
                           SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoke_version,
                           CURRENT_TIMESTAMP
                    FROM red_blue_comparisons
                    GROUP BY user_id
                    """,
                ),
            )
        print('[migrate] 红蓝合战实时 watermark 和用户状态表已就绪')
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'[migrate] 红蓝合战实时状态迁移失败: {exc}') from exc


def _migrate_red_blue_score_suggestion_actions() -> None:
    """为建议缓存和 Action 事实补充展示字段、evidence watermark 与幂等键。"""
    from sqlalchemy import text

    try:
        with engine.begin() as conn:
            suggestion_columns = {
                row[1] for row in conn.execute(text('PRAGMA table_info(score_suggestions)'))
            }
            if suggestion_columns:
                additions = {
                    'direction': 'VARCHAR(16)',
                    'severity': 'FLOAT',
                    'reason_code': 'VARCHAR(64)',
                }
                for column, definition in additions.items():
                    if column not in suggestion_columns:
                        conn.execute(
                            text(
                                f'ALTER TABLE score_suggestions ADD COLUMN {column} {definition}',
                            ),
                        )

            action_columns = {
                row[1] for row in conn.execute(text('PRAGMA table_info(score_suggestion_actions)'))
            }
            if action_columns:
                additions = {
                    'comparison_state_version_at_action': 'INTEGER NOT NULL DEFAULT 0',
                    'effective_comparison_max_id_at_action': 'INTEGER',
                    'client_event_id': 'VARCHAR(64)',
                }
                for column, definition in additions.items():
                    if column not in action_columns:
                        conn.execute(
                            text(
                                f'ALTER TABLE score_suggestion_actions ADD COLUMN {column} {definition}',
                            ),
                        )
                conn.execute(
                    text(
                        'CREATE UNIQUE INDEX IF NOT EXISTS '
                        'uq_score_suggestion_action_user_client_event '
                        'ON score_suggestion_actions (user_id, client_event_id)',
                    ),
                )
                conn.execute(
                    text(
                        'CREATE INDEX IF NOT EXISTS '
                        'ix_score_suggestion_actions_user_effective_comparison '
                        'ON score_suggestion_actions (user_id, effective_comparison_max_id_at_action)',
                    ),
                )
        print('[migrate] 红蓝合战评分建议 Action watermark 和幂等字段已就绪')
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'[migrate] 评分建议 Action 迁移失败: {exc}') from exc


def _migrate_red_blue_score_suggestion_key_uniqueness() -> None:
    """允许同一 Full run 下因证据变化产生多个 suggestion key。"""
    from sqlalchemy import text

    try:
        with engine.begin() as conn:
            table_columns = {
                row[1] for row in conn.execute(text('PRAGMA table_info(score_suggestions)'))
            }
            if not table_columns:
                return

            current_columns = [
                'id',
                'user_id',
                'content_id',
                'model_run_id',
                'suggestion_key',
                'current_score',
                'suggested_score_low',
                'suggested_score_high',
                'recommended_score',
                'direction',
                'confidence',
                'severity',
                'reason_code',
                'status',
                'created_at',
                'handled_at',
            ]

            def copy_legacy_rows(source_table: str) -> None:
                """把中断迁移留下的旧表数据补回当前表。"""
                source_columns = {
                    row[1] for row in conn.execute(text(f'PRAGMA table_info("{source_table}")'))
                }
                copied_columns = [column for column in current_columns if column in source_columns]
                missing_optional = set(current_columns) - set(copied_columns)
                if missing_optional - {'direction', 'severity', 'reason_code'}:
                    raise RuntimeError(f'评分建议旧表缺少不可选字段: {sorted(missing_optional)}')
                select_columns = [
                    column if column in copied_columns else 'NULL'
                    for column in current_columns
                ]
                conn.execute(
                    text(
                        'INSERT OR IGNORE INTO score_suggestions ('
                        + ', '.join(current_columns)
                        + ') SELECT '
                        + ', '.join(select_columns)
                        + f' FROM "{source_table}"',
                    ),
                )

            legacy_table_columns = {
                row[1]
                for row in conn.execute(text('PRAGMA table_info(score_suggestions_legacy)'))
            }
            if legacy_table_columns:
                # 上一次启动在创建新表索引时失败后，SQLite 会保留新表和旧表。
                # 先补数据、再删除旧表释放同名索引，最后只补当前模型声明的索引。
                copy_legacy_rows('score_suggestions_legacy')
                conn.execute(text('DROP TABLE score_suggestions_legacy'))
                for index in ScoreSuggestion.__table__.indexes:
                    index.create(bind=conn, checkfirst=True)
                print('[migrate] score_suggestions suggestion_key 唯一语义中断状态已修复')
                return

            unique_indexes = []
            for row in conn.execute(text('PRAGMA index_list(score_suggestions)')):
                index_name = row[1]
                is_unique = bool(row[2])
                if not is_unique:
                    continue
                columns = [
                    index_row[2]
                    for index_row in conn.execute(text(f'PRAGMA index_info("{index_name}")'))
                ]
                unique_indexes.append((index_name, columns))

            has_legacy_unique = any(
                columns == ['model_run_id', 'user_id', 'content_id']
                for _index_name, columns in unique_indexes
            )
            if not has_legacy_unique:
                return

            for row in conn.execute(text('PRAGMA index_list(score_suggestions)')):
                index_name = row[1]
                if not index_name.startswith('sqlite_autoindex'):
                    conn.execute(text(f'DROP INDEX IF EXISTS "{index_name}"'))
            conn.execute(text('PRAGMA foreign_keys=OFF'))
            conn.execute(text('ALTER TABLE score_suggestions RENAME TO score_suggestions_legacy'))
            ScoreSuggestion.__table__.create(bind=conn, checkfirst=True)

            copy_legacy_rows('score_suggestions_legacy')
            conn.execute(text('DROP TABLE score_suggestions_legacy'))
            conn.execute(text('PRAGMA foreign_keys=ON'))
        print('[migrate] score_suggestions suggestion_key 唯一语义已升级')
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'[migrate] 评分建议 suggestion_key 唯一语义迁移失败: {exc}') from exc


def _migrate_interrupted_resource_subscription_cleanup() -> None:
    """恢复旧订阅表迁移中断后留下的 legacy 表，且先验证行已保留。"""
    from sqlalchemy import text

    table_name = ResourceSubscription.__tablename__
    legacy_table = f'{table_name}_legacy'
    try:
        with engine.begin() as conn:
            legacy_columns = {
                row[1] for row in conn.execute(text(f'PRAGMA table_info("{legacy_table}")'))
            }
            if not legacy_columns:
                return
            target_columns = {
                row[1] for row in conn.execute(text(f'PRAGMA table_info("{table_name}")'))
            }
            required = {
                'id', 'user_id', 'content_id', 'subject_id', 'source', 'fansub_key',
                'fansub_name', 'fansub_id', 'active', 'last_seen_created_at',
                'last_seen_resource_key', 'created_at', 'updated_at',
            }
            if not required <= target_columns:
                raise RuntimeError('resource_subscriptions 当前表结构尚未完成')
            copy_columns = [
                'id', 'user_id', 'content_id', 'subject_id', 'source', 'fansub_key',
                'fansub_name', 'fansub_id', 'active', 'last_seen_created_at',
                'last_seen_resource_key', 'created_at', 'updated_at',
            ]
            select_expressions = [
                column if column in legacy_columns else (
                    "'animegarden'" if column == 'source' else
                    'NULL' if column == 'fansub_id' else
                    column
                )
                for column in copy_columns
            ]
            conn.execute(
                text(
                    f'INSERT OR IGNORE INTO "{table_name}" ('
                    + ', '.join(copy_columns)
                    + ') SELECT '
                    + ', '.join(select_expressions)
                    + f' FROM "{legacy_table}"',
                ),
            )
            unresolved = conn.execute(
                text(
                    f'SELECT COUNT(*) FROM "{legacy_table}" AS legacy '
                    f'LEFT JOIN "{table_name}" AS current ON current.id = legacy.id '
                    'WHERE current.id IS NULL',
                ),
            ).scalar_one()
            if unresolved:
                raise RuntimeError(f'resource_subscriptions 仍有 {unresolved} 条 legacy 行未安全合并')
            conn.execute(text(f'DROP TABLE "{legacy_table}"'))
        print('[migrate] resource_subscriptions legacy 中断状态已清理')
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'[migrate] 旧订阅迁移中断状态恢复失败: {exc}') from exc


def _migrate_red_blue_order_uncertainty() -> None:
    """持久化与 stability 独立的 Full 后验顺序不确定标记。"""
    from sqlalchemy import text

    with engine.begin() as conn:
        columns = {row[1] for row in conn.execute(text('PRAGMA table_info(preference_results)'))}
        if not columns or 'order_uncertain' in columns:
            return
        conn.execute(
            text(
                'ALTER TABLE preference_results '
                'ADD COLUMN order_uncertain BOOLEAN NOT NULL DEFAULT 0'
            ),
        )
    print('[migrate] preference_results.order_uncertain 已添加')


MIGRATIONS = (
    Migration(
        '0001-invite-codes-expires-and-user-avatar',
        '补充邀请有效期和用户头像地址字段',
        _migrate_invite_codes_expires,
    ),
    Migration('0002-user-avatar-crop', '补充用户头像裁剪字段', _migrate_users_avatar_crop),
    Migration('0003-legacy-anime-movie-type', '迁移旧番剧电影内容类型', _migrate_legacy_anime_movies),
    Migration('0004-resource-subscriptions-source', '升级资源订阅为多来源结构', _migrate_resource_subscriptions),
    Migration('0005-legacy-cover-assets', '登记历史本地封面资源', _migrate_legacy_cover_assets),
    Migration(
        '0006-airing-calendar-failure-tracking',
        '补充周历同步失败追踪字段',
        _migrate_airing_calendar_failure_tracking,
    ),
    Migration('0007-rating-revision-baseline', '为历史评分建立修订基线', _migrate_rating_revisions),
    Migration(
        '0008-red-blue-preference-foundation',
        '建立红蓝合战事实、偏好模型快照和评分建议基础结构',
        _migrate_red_blue_preference_foundation,
    ),
    Migration(
        '0009-preference-model-run-input-metadata',
        '补充模型运行的评分锚点 watermark 和算法配置快照',
        _migrate_preference_model_run_input_metadata,
    ),
    Migration(
        '0010-red-blue-realtime-state',
        '补充红蓝合战 comparison 状态 watermark 和实时状态表',
        _migrate_red_blue_realtime_state,
    ),
    Migration(
        '0011-red-blue-score-suggestion-actions',
        '补充评分建议展示字段、evidence watermark 和 Action 幂等键',
        _migrate_red_blue_score_suggestion_actions,
    ),
    Migration(
        '0012-red-blue-score-suggestion-key-uniqueness',
        '允许同一模型运行下按 suggestion_key 保存建议语义变化',
        _migrate_red_blue_score_suggestion_key_uniqueness,
    ),
    Migration(
        '0013-red-blue-posterior-order-uncertainty',
        '独立保存 Full 后验顺序不确定标记',
        _migrate_red_blue_order_uncertainty,
    ),
    Migration(
        '0014-resource-subscription-interrupted-migration-cleanup',
        '恢复并清理旧订阅表迁移中断残留',
        _migrate_interrupted_resource_subscription_cleanup,
    ),
)


app = FastAPI(
    title='MoreAni API',
    version='2.0.0',
    lifespan=lifespan,
)

# --- CORS ---
# 白名单模式：cookie 认证下不允许通配符（allow_origins=['*'] + credentials=True
# 等于任何网站都能携带 cookie 调用 API）。生产域名 + 本地开发域名显式列出。
MOREANI_ENV = os.getenv('MOREANI_ENV', 'development').lower()
if MOREANI_ENV == 'production':
    default_origins = 'https://moreani.lovelysia.top'
else:
    default_origins = 'http://localhost:5173,http://127.0.0.1:5173,https://moreani.lovelysia.top'
configured_origins = [
    origin.strip() for origin in os.getenv('ALLOWED_ORIGINS', default_origins).split(',') if origin.strip()
]
if MOREANI_ENV == 'production':
    # 防止部署环境误把明文 HTTP 来源带入生产 Cookie 白名单。
    ALLOWED_ORIGINS = [origin for origin in configured_origins if origin.lower().startswith('https://')]
else:
    ALLOWED_ORIGINS = configured_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allow_headers=['Accept', 'Content-Type', 'X-Requested-With'],
)

# --- Rate Limiting ---
app.add_middleware(RateLimitMiddleware)
app.add_middleware(OriginGuardMiddleware, allowed_origins=ALLOWED_ORIGINS)
app.add_middleware(SecurityHeadersMiddleware)

# --- V1 API routers ---
app.include_router(auth_router, prefix='/api/v1')
app.include_router(content_router, prefix='/api/v1')
app.include_router(analytics_router, prefix='/api/v1')
app.include_router(notifications_router, prefix='/api/v1')
app.include_router(subscription_router, prefix='/api/v1')
app.include_router(rating_router, prefix='/api/v1')
app.include_router(red_blue_router, prefix='/api/v1')
app.include_router(status_router, prefix='/api/v1')
app.include_router(tag_router, prefix='/api/v1')
app.include_router(user_router, prefix='/api/v1')
app.include_router(bangumi_router, prefix='/api/v1')
app.include_router(airing_router, prefix='/api/v1')
app.include_router(proxy_router, prefix='/api/v1')
app.include_router(admin_router, prefix='/api/v1')

# --- 封面本地化：/api/covers/{id}.jpg 静态服务（图片下载到本地，不依赖外链 CDN） ---
COVERS_DIR = os.getenv('COVERS_DIR', 'covers')
os.makedirs(COVERS_DIR, exist_ok=True)


class CachedCoverFiles(StaticFiles):
    """Serve local covers with immutable caching for versioned asset URLs."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            query_string = scope.get('query_string', b'')
            if b'v=' in query_string:
                response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
            else:
                response.headers['Cache-Control'] = 'public, max-age=86400'
        return response


app.mount('/api/covers', CachedCoverFiles(directory=COVERS_DIR), name='covers')

# --- 头像静态服务：/api/avatars/{file} ---
AVATARS_DIR = os.getenv('AVATARS_DIR', 'avatars')
os.makedirs(AVATARS_DIR, exist_ok=True)
app.mount('/api/avatars', StaticFiles(directory=AVATARS_DIR), name='avatars')


@app.get('/api/health')
def health_check() -> dict:
    """Health check endpoint."""
    return {'status': 'ok', 'version': '2.0.0'}
