"""红蓝合战阶段 1 的数据库语义、约束和历史迁移测试。"""

import json
from datetime import UTC, datetime

import pytest
from conftest import auth_cookie
from sqlalchemy import create_engine, func, inspect, text
from sqlalchemy.exc import IntegrityError

import main as main_module
from models import (
    SCORE_ANCHOR_REVISION_SOURCES,
    ContentItem,
    PreferenceModelRun,
    PreferenceModelRunStatus,
    PreferenceResult,
    PreferenceStability,
    Rating,
    RatingRevision,
    RatingRevisionSource,
    RedBlueComparison,
    RedBlueOutcome,
    ScoreSuggestion,
    ScoreSuggestionAction,
    ScoreSuggestionActionType,
    ScoreSuggestionStatus,
)
from services.rating import delete_rating, upsert_rating


def _content(db, owner_id: int, title: str) -> ContentItem:
    """创建测试番剧。"""
    content = ContentItem(
        title=title,
        content_type='anime',
        is_public=True,
        created_by=owner_id,
    )
    db.add(content)
    db.commit()
    db.refresh(content)
    return content


def _latest_anchor_revision_id(db, user_id: int) -> int | None:
    """按数据层来源约定计算当前 score_anchor watermark。"""
    return (
        db.query(func.max(RatingRevision.id))
        .filter(
            RatingRevision.user_id == user_id,
            RatingRevision.source.in_(SCORE_ANCHOR_REVISION_SOURCES),
        )
        .scalar()
    )


def test_rating_anchor_follows_explicit_rating_but_is_separate_column(client, db, make_user):
    """普通评分写入会建立 anchor，未来 PK 建议可只改 score。"""
    user = make_user('anchor-user')
    content = _content(db, user.id, 'Anchor 番剧')

    created = client.post(
        '/api/v1/rating',
        cookies=auth_cookie(user),
        json={'content_id': content.id, 'score': 80},
    )
    assert created.status_code == 200
    rating = db.query(Rating).filter_by(user_id=user.id, content_id=content.id).one()
    assert (rating.score, rating.score_anchor) == (80, 80)

    # 模拟未来的 PK 建议接受：当前评分改变，但 anchor 保持独立表达。
    rating.score = 85
    db.commit()
    assert (rating.score, rating.score_anchor) == (85, 80)

    updated = client.post(
        '/api/v1/rating',
        cookies=auth_cookie(user),
        json={'content_id': content.id, 'score': 90},
    )
    assert updated.status_code == 200
    db.refresh(rating)
    assert (rating.score, rating.score_anchor) == (90, 90)


def test_legacy_calibration_is_explicit_score_input_and_updates_anchor(client, db, make_user):
    """旧评分校准保留 comparison 历史，但属于新的独立评分表达。"""
    user = make_user('legacy-calibration-user')
    content = _content(db, user.id, '旧校准番剧')
    upsert_rating(db, user_id=user.id, content_id=content.id, score=60)

    response = client.post(
        '/api/v1/rating/calibration',
        cookies=auth_cookie(user),
        json={
            'items': [
                {'content_id': content.id, 'expected_score': 60, 'new_score': 80},
            ],
        },
    )
    assert response.status_code == 200
    rating = db.query(Rating).filter_by(user_id=user.id, content_id=content.id).one()
    assert (rating.score, rating.score_anchor) == (80, 80)
    revision = (
        db.query(RatingRevision)
        .filter_by(user_id=user.id, content_id=content.id, source=RatingRevisionSource.COMPARISON.value)
        .one()
    )
    assert revision.comparison_id == response.json()['comparison_id']


def test_import_rating_uses_import_revision_source(db, make_user):
    """项目现有 Excel 导入路径可以留下 import 来源。"""
    user = make_user('import-source-user')
    content = _content(db, user.id, '导入番剧')
    upsert_rating(
        db,
        user_id=user.id,
        content_id=content.id,
        score=75,
        revision_source=RatingRevisionSource.IMPORT,
    )

    revision = db.query(RatingRevision).filter_by(user_id=user.id, content_id=content.id).one()
    assert revision.source == RatingRevisionSource.IMPORT.value


def test_model_run_watermarks_and_algorithm_config_capture_inputs(db, make_user):
    """anchor watermark 排除 PK 建议，comparison watermark 和配置可保存。"""
    user = make_user('model-run-input-user')
    first = _content(db, user.id, '输入版本一')
    second = _content(db, user.id, '输入版本二')

    upsert_rating(db, user_id=user.id, content_id=first.id, score=70)
    initial_revision = (
        db.query(RatingRevision)
        .filter_by(user_id=user.id, content_id=first.id, source=RatingRevisionSource.INITIAL.value)
        .one()
    )
    assert _latest_anchor_revision_id(db, user.id) == initial_revision.id

    upsert_rating(db, user_id=user.id, content_id=first.id, score=80)
    manual_revision = (
        db.query(RatingRevision)
        .filter_by(user_id=user.id, content_id=first.id, source=RatingRevisionSource.MANUAL.value)
        .one()
    )
    assert _latest_anchor_revision_id(db, user.id) == manual_revision.id

    db.add(
        RatingRevision(
            rating_id=None,
            content_id=first.id,
            user_id=user.id,
            previous_score=80,
            new_score=85,
            changed_at=datetime.now(UTC),
            source=RatingRevisionSource.PK_SUGGESTION.value,
        ),
    )
    db.commit()
    assert _latest_anchor_revision_id(db, user.id) == manual_revision.id

    first_comparison = RedBlueComparison(
        user_id=user.id,
        left_content_id=first.id,
        right_content_id=second.id,
        outcome=RedBlueOutcome.LEFT_WIN,
        client_event_id='watermark-event-1',
        selector_version='v1',
    )
    db.add(first_comparison)
    db.commit()
    db.refresh(first_comparison)
    comparison_watermark = first_comparison.id

    run = PreferenceModelRun(
        user_id=user.id,
        algorithm_version='ranker-v1',
        input_comparison_max_id=comparison_watermark,
        input_rating_revision_max_id=manual_revision.id,
        algorithm_config_json=json.dumps(
            {'prior_strength': 0.25, 'tie_weight': 0.5},
            ensure_ascii=False,
            sort_keys=True,
        ),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    assert run.input_comparison_max_id == comparison_watermark
    assert run.input_rating_revision_max_id == manual_revision.id
    assert json.loads(run.algorithm_config_json) == {'prior_strength': 0.25, 'tie_weight': 0.5}

    second_comparison = RedBlueComparison(
        user_id=user.id,
        left_content_id=second.id,
        right_content_id=first.id,
        outcome=RedBlueOutcome.TIE,
        client_event_id='watermark-event-2',
        selector_version='v1',
    )
    db.add(second_comparison)
    db.commit()
    assert second_comparison.id > comparison_watermark
    assert second_comparison.id > run.input_comparison_max_id


def test_delete_rating_revision_advances_anchor_watermark(db, make_user):
    """当前删除逻辑为正分 Rating 写 delete Revision，删除会使 anchor 输入失效。"""
    user = make_user('delete-watermark-user')
    content = _content(db, user.id, '删除输入')
    rating = upsert_rating(db, user_id=user.id, content_id=content.id, score=75)
    delete_rating(db, rating)

    deletion = (
        db.query(RatingRevision)
        .filter_by(user_id=user.id, content_id=content.id, source=RatingRevisionSource.DELETE.value)
        .one()
    )
    assert _latest_anchor_revision_id(db, user.id) == deletion.id


def test_red_blue_comparison_constraints_and_duplicate_client_event(db, make_user):
    """PK 保留方向、允许重复 pair，但同一客户端事件必须幂等。"""
    user = make_user('comparison-user')
    left = _content(db, user.id, '左番')
    right = _content(db, user.id, '右番')

    db.add(
        RedBlueComparison(
            user_id=user.id,
            left_content_id=left.id,
            right_content_id=right.id,
            outcome=RedBlueOutcome.LEFT_WIN,
            client_event_id='event-1',
            selector_version='v1',
        ),
    )
    db.commit()

    # 同一 pair 的另一次比较是合法事实。
    db.add(
        RedBlueComparison(
            user_id=user.id,
            left_content_id=left.id,
            right_content_id=right.id,
            outcome=RedBlueOutcome.TIE,
            client_event_id='event-2',
            selector_version='v1',
        ),
    )
    db.commit()
    assert db.query(RedBlueComparison).filter_by(user_id=user.id).count() == 2

    db.add(
        RedBlueComparison(
            user_id=user.id,
            left_content_id=right.id,
            right_content_id=left.id,
            outcome=RedBlueOutcome.SKIP,
            client_event_id='event-1',
            selector_version='v1',
        ),
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    db.add(
        RedBlueComparison(
            user_id=user.id,
            left_content_id=left.id,
            right_content_id=left.id,
            outcome=RedBlueOutcome.RIGHT_WIN,
            client_event_id='event-3',
            selector_version='v1',
        ),
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_derived_results_can_be_deleted_without_losing_suggestion_action(db, make_user):
    """模型快照可删除重建，用户对建议的处理事实必须保留。"""
    user = make_user('derived-user')
    content = _content(db, user.id, '建议番剧')
    run = PreferenceModelRun(
        user_id=user.id,
        algorithm_version='v1',
        status=PreferenceModelRunStatus.COMPLETED,
        input_comparison_max_id=12,
        started_at=datetime.now(UTC),
        completed_at=datetime.now(UTC),
    )
    db.add(run)
    db.flush()
    result = PreferenceResult(
        model_run_id=run.id,
        user_id=user.id,
        content_id=content.id,
        preference_mean=0.5,
        preference_std=0.2,
        expected_rank=1.0,
        rank_low=1,
        rank_high=2,
        stability=PreferenceStability.ORDER_UNCERTAIN,
        comparison_count=3,
    )
    suggestion = ScoreSuggestion(
        user_id=user.id,
        content_id=content.id,
        model_run_id=run.id,
        suggestion_key='v1:content-1:80-85',
        current_score=80,
        suggested_score_low=80,
        suggested_score_high=90,
        recommended_score=85,
        confidence=0.75,
        status=ScoreSuggestionStatus.DISMISSED,
        handled_at=datetime.now(UTC),
    )
    db.add_all([result, suggestion])
    db.flush()
    action = ScoreSuggestionAction(
        user_id=user.id,
        content_id=content.id,
        score_suggestion_id=suggestion.id,
        model_run_id=run.id,
        suggestion_key=suggestion.suggestion_key,
        action=ScoreSuggestionActionType.DISMISSED,
        current_score=80,
        recommended_score=85,
    )
    db.add(action)
    db.commit()

    db.delete(run)
    db.commit()

    assert db.query(PreferenceResult).filter_by(id=result.id).one_or_none() is None
    assert db.query(ScoreSuggestion).filter_by(id=suggestion.id).one_or_none() is None
    persisted_action = db.query(ScoreSuggestionAction).filter_by(id=action.id).one()
    assert persisted_action.action == ScoreSuggestionActionType.DISMISSED
    assert persisted_action.score_suggestion_id is None
    assert persisted_action.model_run_id is None


def test_pk_suggestion_revision_has_distinct_provenance(db, make_user):
    """PK 建议修订使用 pk_suggestion，不复用旧 comparison 字段。"""
    user = make_user('pk-revision-user')
    content = _content(db, user.id, 'PK 修订番剧')
    rating = upsert_rating(db, user_id=user.id, content_id=content.id, score=80)
    run = PreferenceModelRun(user_id=user.id, algorithm_version='v1')
    db.add(run)
    db.flush()
    suggestion = ScoreSuggestion(
        user_id=user.id,
        content_id=content.id,
        model_run_id=run.id,
        suggestion_key='v1:pk-revision',
        current_score=80,
        suggested_score_low=80,
        suggested_score_high=90,
        recommended_score=85,
    )
    db.add(suggestion)
    db.flush()
    action = ScoreSuggestionAction(
        user_id=user.id,
        content_id=content.id,
        score_suggestion_id=suggestion.id,
        model_run_id=run.id,
        suggestion_key=suggestion.suggestion_key,
        action=ScoreSuggestionActionType.ACCEPTED,
        current_score=80,
        recommended_score=85,
    )
    db.add(action)
    db.flush()
    rating.score = 85
    db.add(
        RatingRevision(
            rating_id=rating.id,
            content_id=content.id,
            user_id=user.id,
            previous_score=80,
            new_score=85,
            changed_at=datetime.now(UTC),
            source=RatingRevisionSource.PK_SUGGESTION.value,
            score_suggestion_id=suggestion.id,
            score_suggestion_action_id=action.id,
        ),
    )
    db.commit()

    revision = db.query(RatingRevision).filter_by(score_suggestion_id=suggestion.id).one()
    assert revision.source == 'pk_suggestion'
    assert revision.comparison_id is None
    assert revision.score_suggestion_action_id == action.id


def test_order_uncertainty_migration_adds_independent_flag_and_is_idempotent(tmp_path, monkeypatch):
    database_engine = create_engine(f'sqlite:///{tmp_path / "order-uncertainty.db"}')
    with database_engine.begin() as connection:
        connection.exec_driver_sql(
            'CREATE TABLE preference_results (id INTEGER PRIMARY KEY, stability VARCHAR(32) NOT NULL)'
        )
        connection.exec_driver_sql("INSERT INTO preference_results (id, stability) VALUES (1, 'STABLE')")

    monkeypatch.setattr(main_module, 'engine', database_engine)
    main_module._migrate_red_blue_order_uncertainty()
    columns = {column['name'] for column in inspect(database_engine).get_columns('preference_results')}
    assert 'order_uncertain' in columns
    with database_engine.connect() as connection:
        assert connection.execute(text('SELECT order_uncertain FROM preference_results WHERE id = 1')).scalar_one() == 0
    with database_engine.begin() as connection:
        connection.execute(text('UPDATE preference_results SET order_uncertain = 1 WHERE id = 1'))
    main_module._migrate_red_blue_order_uncertainty()
    with database_engine.connect() as connection:
        assert connection.execute(text('SELECT order_uncertain FROM preference_results WHERE id = 1')).scalar_one() == 1


def test_red_blue_foundation_migration_backfills_existing_scores_and_is_idempotent(tmp_path, monkeypatch):
    """旧数据库只把当前 Rating.score 作为一次性 anchor 基线，不改写旧历史。"""
    database_engine = create_engine(f'sqlite:///{tmp_path / "legacy.db"}')
    with database_engine.begin() as connection:
        connection.exec_driver_sql('CREATE TABLE users (id INTEGER PRIMARY KEY)')
        connection.exec_driver_sql('CREATE TABLE content_items (id INTEGER PRIMARY KEY)')
        connection.exec_driver_sql(
            'CREATE TABLE preference_model_runs ('
            'id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, algorithm_version VARCHAR(64) NOT NULL, '
            'status VARCHAR(20) NOT NULL, input_comparison_max_id INTEGER, started_at DATETIME, '
            'completed_at DATETIME, error_message TEXT)'
        )
        connection.exec_driver_sql(
            'CREATE TABLE ratings ('
            'id INTEGER PRIMARY KEY, content_id INTEGER NOT NULL, user_id INTEGER NOT NULL, '
            'score INTEGER NOT NULL, recommend INTEGER NOT NULL DEFAULT 0, review TEXT, '
            'created_at DATETIME, updated_at DATETIME)'
        )
        connection.exec_driver_sql(
            'CREATE TABLE rating_revisions ('
            'id INTEGER PRIMARY KEY, rating_id INTEGER, content_id INTEGER NOT NULL, '
            'user_id INTEGER NOT NULL, previous_score INTEGER NOT NULL, new_score INTEGER NOT NULL, '
            'changed_at DATETIME NOT NULL, source VARCHAR(30) NOT NULL, comparison_id VARCHAR(64))'
        )
        connection.execute(text('INSERT INTO users (id) VALUES (1)'))
        connection.execute(text('INSERT INTO content_items (id) VALUES (10), (11)'))
        connection.execute(
            text('INSERT INTO ratings (id, content_id, user_id, score) VALUES (1, 10, 1, 80), (2, 11, 1, 0)'),
        )
        connection.execute(
            text(
                'INSERT INTO rating_revisions '
                '(id, rating_id, content_id, user_id, previous_score, new_score, changed_at, source, comparison_id) '
                "VALUES (1, 1, 10, 1, 80, 90, CURRENT_TIMESTAMP, 'comparison', 'legacy-batch')",
            ),
        )

    monkeypatch.setattr(main_module, 'engine', database_engine)
    main_module._migrate_red_blue_preference_foundation()
    main_module._migrate_preference_model_run_input_metadata()

    columns = {column['name'] for column in inspect(database_engine).get_columns('ratings')}
    revision_columns = {column['name'] for column in inspect(database_engine).get_columns('rating_revisions')}
    model_run_columns = {column['name'] for column in inspect(database_engine).get_columns('preference_model_runs')}
    assert 'score_anchor' in columns
    assert {'score_suggestion_id', 'score_suggestion_action_id'} <= revision_columns
    assert {'input_rating_revision_max_id', 'algorithm_config_json'} <= model_run_columns
    assert database_engine.connect().execute(text('SELECT score_anchor FROM ratings WHERE id = 1')).scalar_one() == 80
    assert database_engine.connect().execute(text('SELECT score_anchor FROM ratings WHERE id = 2')).scalar_one() == 0
    assert database_engine.connect().execute(text('SELECT source FROM rating_revisions')).scalar_one() == 'comparison'
    with database_engine.begin() as connection:
        connection.execute(
            text(
                'INSERT INTO preference_model_runs '
                '(id, user_id, algorithm_version, status, input_comparison_max_id) '
                "VALUES (1, 1, 'v1', 'COMPLETED', 10)",
            ),
        )
    assert (
        database_engine.connect()
        .execute(text('SELECT algorithm_config_json FROM preference_model_runs WHERE id = 1'))
        .scalar_one()
        == '{}'
    )

    # 后续重复迁移不会覆盖已经修改过的 anchor。
    with database_engine.begin() as connection:
        connection.execute(text('UPDATE ratings SET score_anchor = 77 WHERE id = 1'))
    main_module._migrate_red_blue_preference_foundation()
    main_module._migrate_preference_model_run_input_metadata()
    assert database_engine.connect().execute(text('SELECT score_anchor FROM ratings WHERE id = 1')).scalar_one() == 77

    table_names = set(inspect(database_engine).get_table_names())
    assert {
        'red_blue_comparisons',
        'preference_model_runs',
        'preference_results',
        'score_suggestions',
        'score_suggestion_actions',
    } <= table_names


def test_score_suggestion_uniqueness_migration_recovers_interrupted_legacy_table(tmp_path, monkeypatch):
    """0012 在新表已建成、旧表尚未删除时应恢复并保留建议行。"""
    from database import Base

    database_engine = create_engine(f'sqlite:///{tmp_path / "suggestion-migration-recovery.db"}')
    Base.metadata.create_all(database_engine)
    monkeypatch.setattr(main_module, 'engine', database_engine)
    with database_engine.begin() as connection:
        connection.execute(
            text(
                'INSERT INTO users (id, username, nickname, password_hash, role) '
                "VALUES (1, 'migration-user', 'Migration User', 'unused', 'user')",
            ),
        )
        connection.execute(
            text(
                'INSERT INTO content_items (id, title, content_type, created_by) '
                "VALUES (1, 'Interrupted suggestion', 'anime', 1)",
            ),
        )
        connection.execute(
            text(
                'INSERT INTO preference_model_runs '
                '(id, user_id, algorithm_version, status, algorithm_config_json) '
                "VALUES (1, 1, 'ranker-v2', 'COMPLETED', '{}')",
            ),
        )
        connection.execute(text('CREATE TABLE score_suggestions_legacy AS SELECT * FROM score_suggestions WHERE 0'))
        connection.execute(
            text(
                'INSERT INTO score_suggestions_legacy '
                '(id, user_id, content_id, model_run_id, suggestion_key, current_score, '
                'suggested_score_low, suggested_score_high, recommended_score, direction, '
                'confidence, severity, reason_code, status, created_at) '
                "VALUES (5, 1, 1, 1, 'recovery-key', 70, 80, 85, 85, 'UP', "
                "0.9, 0.8, 'OUTLIER', 'PENDING', CURRENT_TIMESTAMP)",
            ),
        )

    main_module._migrate_red_blue_score_suggestion_key_uniqueness()
    main_module._migrate_red_blue_score_suggestion_key_uniqueness()

    with database_engine.connect() as connection:
        restored = connection.execute(
            text('SELECT suggestion_key, recommended_score, status FROM score_suggestions WHERE id = 5'),
        ).one()
        legacy_table_count = connection.execute(
            text("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'score_suggestions_legacy'"),
        ).scalar_one()
        indexes = {row[1] for row in connection.execute(text('PRAGMA index_list(score_suggestions)'))}

    assert tuple(restored) == ('recovery-key', 85, 'PENDING')
    assert legacy_table_count == 0
    assert 'ix_score_suggestions_user_content_key' in indexes
    database_engine.dispose()
