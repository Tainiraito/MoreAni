"""阶段 4B 红蓝合战领域 Service、缓存生命周期和重算协调测试。"""

import threading
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import inspect, text

import main as main_module
from models import (
    ContentItem,
    PreferenceModelRun,
    PreferenceModelRunStatus,
    Rating,
    RedBlueOutcome,
    RedBlueUserState,
)
from services.rating import upsert_rating
from services.red_blue import (
    FullRecalibrationReason,
    ModelFreshness,
    RedBlueFastStateCache,
    RedBlueService,
    RedBlueServiceConfig,
)
from services.red_blue_fast_ranker import FastUpdateConfig
from services.red_blue_pair_selector import SelectorConfig
from services.red_blue_ranker import RankerConfig


def _content(db, owner_id: int, title: str, *, content_type: str = 'anime', public: bool = True):
    content = ContentItem(
        title=title,
        content_type=content_type,
        is_public=public,
        created_by=owner_id,
    )
    db.add(content)
    db.commit()
    db.refresh(content)
    return content


def _rated_set(db, user_id: int, count: int = 4) -> list[ContentItem]:
    contents = [_content(db, user_id, f'红蓝作品 {index}') for index in range(1, count + 1)]
    for index, content in enumerate(contents):
        upsert_rating(db, user_id=user_id, content_id=content.id, score=60 + index * 5)
    return contents


def _service(session_factory, *, max_fast_updates: int = 10, focus_probability: float = 0.80) -> RedBlueService:
    return RedBlueService(
        session_factory=session_factory,
        config=RedBlueServiceConfig(
            ranker_config=RankerConfig(posterior_sample_count=32, random_seed=0),
            selector_config=SelectorConfig(
                random_seed=0,
                pair_cooldown_count=0,
                skip_cooldown_count=0,
                focus_probability=focus_probability,
            ),
            fast_update_config=FastUpdateConfig(local_rank_neighbor_window=4, local_graph_neighbor_count=8),
            cache_ttl_seconds=60,
            cache_max_users=8,
            max_fast_updates_before_full=max_fast_updates,
            max_fast_state_age_seconds=600,
            stale_running_seconds=60,
        ),
    )


def test_bootstrap_is_immediate_and_requires_full(db, session_factory, make_user):
    user = make_user('red-blue-bootstrap')
    contents = _rated_set(db, user.id)
    service = _service(session_factory)
    try:
        state = service.get_battle_state(db, user_id=user.id)
        assert len(state.items) == len(contents)
        assert state.next_pair is not None
        assert state.freshness is ModelFreshness.BOOTSTRAP
        assert state.full_recalibration_required is True
        full = service.wait_for_recalibration(user.id, timeout=30)
        assert full is not None
        assert full.status is PreferenceModelRunStatus.COMPLETED
        refreshed = service.get_battle_state(db, user_id=user.id)
        assert refreshed.freshness is ModelFreshness.FULL
        assert refreshed.full_recalibration_required is False
    finally:
        service.close()


def test_record_comparison_commits_fact_before_fast_update_and_is_idempotent(
    db,
    session_factory,
    make_user,
):
    user = make_user('red-blue-record')
    _rated_set(db, user.id)
    service = _service(session_factory)
    try:
        full = service.run_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        assert full.status is PreferenceModelRunStatus.COMPLETED
        before = service.get_battle_state(db, user_id=user.id)
        assert before.freshness is ModelFreshness.FULL
        assert before.next_pair is not None
        pair = before.next_pair

        result = service.record_comparison(
            db,
            user_id=user.id,
            left_content_id=pair.left_content_id,
            right_content_id=pair.right_content_id,
            outcome=RedBlueOutcome.LEFT_WIN,
            client_event_id='record-event-1',
        )
        assert result.comparison_id is not None
        assert result.idempotent_replay is False
        assert result.freshness is ModelFreshness.FAST
        assert {delta.content_id for delta in result.ranking_delta} >= {
            pair.left_content_id,
            pair.right_content_id,
        }
        user_state = db.query(RedBlueUserState).filter_by(user_id=user.id).one()
        assert user_state.comparison_state_version == 1
        assert user_state.revoke_version == 0

        repeated = service.record_comparison(
            db,
            user_id=user.id,
            left_content_id=pair.left_content_id,
            right_content_id=pair.right_content_id,
            outcome=RedBlueOutcome.LEFT_WIN,
            client_event_id='record-event-1',
        )
        assert repeated.idempotent_replay is True
        assert repeated.comparison_id == result.comparison_id
        assert repeated.ranking_delta == ()
        db.refresh(user_state)
        assert user_state.comparison_state_version == 1
    finally:
        service.close()


def test_focus_content_only_guides_next_pair_and_is_not_saved_as_state(db, session_factory, make_user):
    user = make_user('red-blue-focus')
    contents = _rated_set(db, user.id, count=5)
    service = _service(session_factory, focus_probability=1.0)
    try:
        service.run_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        state = service.get_battle_state(db, user_id=user.id)
        assert state.next_pair is not None
        result = service.record_comparison(
            db,
            user_id=user.id,
            left_content_id=state.next_pair.left_content_id,
            right_content_id=state.next_pair.right_content_id,
            outcome=RedBlueOutcome.LEFT_WIN,
            client_event_id='focus-event-1',
            focus_content_id=contents[-1].id,
        )
        assert result.next_pair is not None
        assert contents[-1].id in {result.next_pair.left_content_id, result.next_pair.right_content_id}
        assert not hasattr(result, 'focus_content_id')
        assert db.query(RedBlueUserState).filter_by(user_id=user.id).one().comparison_state_version == 1
    finally:
        service.close()


def test_skip_is_saved_and_changes_selector_history_but_not_rank_count(db, session_factory, make_user):
    user = make_user('red-blue-skip')
    contents = _rated_set(db, user.id, count=3)
    service = _service(session_factory)
    try:
        service.run_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        state = service.get_battle_state(db, user_id=user.id)
        assert state.next_pair is not None
        result = service.record_comparison(
            db,
            user_id=user.id,
            left_content_id=state.next_pair.left_content_id,
            right_content_id=state.next_pair.right_content_id,
            outcome=RedBlueOutcome.SKIP,
            client_event_id='skip-event-1',
        )
        assert result.ranking_delta == ()
        assert result.freshness is ModelFreshness.FAST
        comparison = db.query(RedBlueUserState).filter_by(user_id=user.id).one()
        assert comparison.comparison_state_version == 1
        assert db.query(Rating).filter_by(user_id=user.id).count() == len(contents)
        assert service.cache.get(user.id) is not None
        assert service.cache.get(user.id).fast_updates_since_full == 0
    finally:
        service.close()


def test_revoke_is_idempotent_and_invalidates_fast_state(db, session_factory, make_user):
    user = make_user('red-blue-revoke')
    _rated_set(db, user.id, count=3)
    service = _service(session_factory)
    try:
        service.run_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        state = service.get_battle_state(db, user_id=user.id)
        assert state.next_pair is not None
        result = service.record_comparison(
            db,
            user_id=user.id,
            left_content_id=state.next_pair.left_content_id,
            right_content_id=state.next_pair.right_content_id,
            outcome=RedBlueOutcome.TIE,
            client_event_id='revoke-event-1',
        )
        comparison_id = result.comparison_id
        assert comparison_id is not None
        revoked = service.revoke_comparison(db, user_id=user.id, comparison_id=comparison_id)
        assert revoked.idempotent_replay is False
        assert revoked.full_recalibration_required is True
        user_state = db.query(RedBlueUserState).filter_by(user_id=user.id).one()
        assert user_state.comparison_state_version == 2
        assert user_state.revoke_version == 1
        again = service.revoke_comparison(db, user_id=user.id, comparison_id=comparison_id)
        assert again.idempotent_replay is True
        db.refresh(user_state)
        assert user_state.comparison_state_version == 2
        assert user_state.revoke_version == 1
    finally:
        service.close()


def test_cache_ttl_lru_and_per_user_locks():
    cache = RedBlueFastStateCache(ttl_seconds=1, max_users=1)
    assert cache.size() == 0
    first = cache.user_lock(1)
    second = cache.user_lock(2)
    assert first is not second
    entered: list[int] = []
    barrier = threading.Barrier(2)

    def work(user_id: int) -> None:
        with cache.user_lock(user_id):
            barrier.wait(timeout=2)
            entered.append(user_id)
            time.sleep(0.02)

    threads = [threading.Thread(target=work, args=(user_id,)) for user_id in (1, 2)]
    started = time.perf_counter()
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=2)
    assert time.perf_counter() - started < 0.1
    assert sorted(entered) == [1, 2]


def test_full_run_deduplicates_same_user_and_uses_own_session(db, session_factory, make_user):
    user = make_user('red-blue-dedup')
    _rated_set(db, user.id, count=2)
    service = _service(session_factory)
    try:
        assert service.request_full_recalibration(user.id, FullRecalibrationReason.MANUAL) is True
        assert service.request_full_recalibration(user.id, FullRecalibrationReason.MANUAL) is False
        result = service.wait_for_recalibration(user.id, timeout=30)
        assert result is not None
        assert result.status is PreferenceModelRunStatus.COMPLETED
        assert db.query(PreferenceModelRun).filter_by(user_id=user.id).count() == 1
    finally:
        service.close()


def test_stale_running_recovery(db, session_factory, make_user):
    user = make_user('red-blue-recovery')
    run = PreferenceModelRun(
        user_id=user.id,
        algorithm_version='ranker-v1',
        status=PreferenceModelRunStatus.RUNNING,
        started_at=datetime.now(UTC) - timedelta(hours=2),
    )
    db.add(run)
    db.commit()
    service = _service(session_factory)
    try:
        assert service.recover_stale_runs(db) == 1
        db.refresh(run)
        assert run.status is PreferenceModelRunStatus.FAILED
        assert run.error_message == 'recovered_stale_running_after_process_restart'
    finally:
        service.close()


def test_comparison_committed_before_snapshot_is_included_once(
    db,
    session_factory,
    make_user,
    monkeypatch,
):
    import services.red_blue as red_blue_module

    user = make_user('red-blue-snapshot-before')
    _rated_set(db, user.id, count=3)
    service = _service(session_factory)
    try:
        assert service.run_full_recalibration(user.id, FullRecalibrationReason.MANUAL).applied_to_cache
        state = service.get_battle_state(db, user_id=user.id)
        assert state.next_pair is not None
        comparison = service.record_comparison(
            db,
            user_id=user.id,
            left_content_id=state.next_pair.left_content_id,
            right_content_id=state.next_pair.right_content_id,
            outcome=RedBlueOutcome.LEFT_WIN,
            client_event_id='snapshot-before-comparison',
        )
        assert comparison.comparison_id is not None

        captured: list[tuple[int, ...]] = []
        original_rank_preferences = red_blue_module.rank_preferences

        def observe_snapshot(candidates, anchors, comparisons, config):
            captured.append(tuple(item.id for item in comparisons))
            return original_rank_preferences(candidates, anchors, comparisons, config)

        monkeypatch.setattr(red_blue_module, 'rank_preferences', observe_snapshot)
        assert service.request_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        result = service.wait_for_recalibration(user.id, timeout=30)

        assert result is not None
        assert result.status is PreferenceModelRunStatus.COMPLETED
        assert result.applied_to_cache is True
        assert result.follow_up_required is False
        assert captured == [(comparison.comparison_id,)]
        run = db.query(PreferenceModelRun).filter_by(id=result.model_run_id).one()
        assert run.input_comparison_max_id == comparison.comparison_id
        assert run.input_comparison_state_version == 1
    finally:
        service.close()


def test_full_run_replays_comparisons_added_while_cpu_is_running(
    db,
    session_factory,
    make_user,
    monkeypatch,
):
    import services.red_blue as red_blue_module

    user = make_user('red-blue-race-comparison')
    _rated_set(db, user.id, count=3)
    service = _service(session_factory)
    started = threading.Event()
    release = threading.Event()
    captured_comparison_ids: list[tuple[int, ...]] = []
    original_rank_preferences = red_blue_module.rank_preferences

    def blocked_rank_preferences(*args, **kwargs):
        comparisons = args[2]
        captured_comparison_ids.append(tuple(item.id for item in comparisons))
        if len(captured_comparison_ids) == 1:
            started.set()
            assert release.wait(timeout=5)
        return original_rank_preferences(*args, **kwargs)

    monkeypatch.setattr(red_blue_module, 'rank_preferences', blocked_rank_preferences)
    try:
        initial = service.get_battle_state(db, user_id=user.id)
        assert initial.next_pair is not None
        assert started.wait(timeout=5)

        comparison_ids: list[int] = []
        for index in range(3):
            inserted = service.record_comparison(
                db,
                user_id=user.id,
                left_content_id=initial.next_pair.left_content_id,
                right_content_id=initial.next_pair.right_content_id,
                outcome=RedBlueOutcome.LEFT_WIN,
                client_event_id=f'race-comparison-{index + 1}',
            )
            assert inserted.comparison_id is not None
            comparison_ids.append(inserted.comparison_id)
            service.request_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        # Repeated state requests during A must coalesce with the one newer input set.
        for _ in range(10):
            service.request_full_recalibration(user.id, FullRecalibrationReason.MANUAL)

        release.set()
        full = service.wait_for_recalibration(user.id, timeout=30)
        assert full is not None
        assert full.status is PreferenceModelRunStatus.COMPLETED
        assert full.applied_to_cache is True
        assert full.follow_up_required is False
        assert captured_comparison_ids == [(), tuple(comparison_ids)]
        assert db.query(PreferenceModelRun).filter_by(user_id=user.id).count() == 2

        cached = service.cache.get(user.id)
        assert cached is not None
        assert cached.last_applied_comparison_id == comparison_ids[-1]
        assert cached.fast_updates_since_full == 0
        assert cached.freshness is ModelFreshness.FULL
        user_state = db.query(RedBlueUserState).filter_by(user_id=user.id).one()
        assert cached.comparison_state_version == user_state.comparison_state_version == 3

        fresh = original_rank_preferences(
            cached.algorithm_state.candidates,
            cached.algorithm_state.score_anchors,
            service._read_comparisons(db, user.id, max_id=comparison_ids[-1]),
            service.config.ranker_config,
        )
        assert {item.content_id: item for item in cached.algorithm_state.authoritative_results} == {
            item.content_id: item for item in fresh.results
        }
    finally:
        release.set()
        service.close()


def test_full_state_polling_with_unchanged_inputs_does_not_queue_another_run(
    db,
    session_factory,
    make_user,
    monkeypatch,
):
    import services.red_blue as red_blue_module

    user = make_user('red-blue-poll-no-change')
    _rated_set(db, user.id, count=3)
    service = _service(session_factory)
    started = threading.Event()
    release = threading.Event()
    calls = 0
    original_rank_preferences = red_blue_module.rank_preferences

    def blocked_rank_preferences(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            started.set()
            assert release.wait(timeout=5)
        return original_rank_preferences(*args, **kwargs)

    monkeypatch.setattr(red_blue_module, 'rank_preferences', blocked_rank_preferences)
    try:
        assert service.request_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        assert started.wait(timeout=5)
        for _ in range(10):
            service.get_battle_state(db, user_id=user.id)
        release.set()
        result = service.wait_for_recalibration(user.id, timeout=30)
        assert result is not None
        assert result.status is PreferenceModelRunStatus.COMPLETED
        assert calls == 1
        assert db.query(PreferenceModelRun).filter_by(user_id=user.id).count() == 1
    finally:
        release.set()
        service.close()


def test_comparison_committed_between_snapshot_watermark_and_input_read_is_only_applied_once(
    db,
    db_engine,
    session_factory,
    make_user,
    monkeypatch,
):
    import services.red_blue as red_blue_module

    with db_engine.connect() as connection:
        connection.exec_driver_sql('PRAGMA journal_mode=WAL')

    user = make_user('red-blue-snapshot-interleaving')
    _rated_set(db, user.id, count=3)
    service = _service(session_factory)
    context_read = threading.Event()
    continue_snapshot = threading.Event()
    original_read_context = service._read_context_for_user
    original_rank_preferences = red_blue_module.rank_preferences

    def pause_after_context(db_session, user_id):
        context = original_read_context(db_session, user_id)
        if (
            threading.current_thread().name.startswith('moreani-red-blue-full')
            and not context_read.is_set()
        ):
            context_read.set()
            assert continue_snapshot.wait(timeout=5)
        return context

    monkeypatch.setattr(service, '_read_context_for_user', pause_after_context)
    # The ranker observer records the immutable inputs passed for A and B.
    ranked_ids: list[tuple[int, ...]] = []

    def record_ranker_inputs(candidates, anchors, comparisons, config):
        ranked_ids.append(tuple(item.id for item in comparisons))
        return original_rank_preferences(candidates, anchors, comparisons, config)

    monkeypatch.setattr(red_blue_module, 'rank_preferences', record_ranker_inputs)
    try:
        assert service.request_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        assert context_read.wait(timeout=5)
        # Submit a real comparison from another session while the read transaction holds its snapshot.
        state = service.get_battle_state(db, user_id=user.id)
        assert state.next_pair is not None
        inserted = service.record_comparison(
            db,
            user_id=user.id,
            left_content_id=state.next_pair.left_content_id,
            right_content_id=state.next_pair.right_content_id,
            outcome=RedBlueOutcome.LEFT_WIN,
            client_event_id='snapshot-concurrent-comparison',
        )
        assert inserted.comparison_id is not None
        continue_snapshot.set()

        result = service.wait_for_recalibration(user.id, timeout=30)
        assert result is not None
        assert result.status is PreferenceModelRunStatus.COMPLETED
        assert result.applied_to_cache is True
        assert ranked_ids == [(), (inserted.comparison_id,)]
        assert db.query(PreferenceModelRun).filter_by(user_id=user.id).count() == 2
        cached = service.cache.get(user.id)
        assert cached is not None
        assert cached.comparison_state_version == 1
        assert cached.last_applied_comparison_id == inserted.comparison_id
    finally:
        continue_snapshot.set()
        service.close()


def test_revoke_during_full_run_rejects_old_snapshot_and_recalibrates_once(
    db,
    session_factory,
    make_user,
    monkeypatch,
):
    import services.red_blue as red_blue_module

    user = make_user('red-blue-revoke-during-full')
    _rated_set(db, user.id, count=3)
    service = _service(session_factory)
    initial = service.run_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
    assert initial.applied_to_cache is True
    state = service.get_battle_state(db, user_id=user.id)
    assert state.next_pair is not None
    comparison = service.record_comparison(
        db,
        user_id=user.id,
        left_content_id=state.next_pair.left_content_id,
        right_content_id=state.next_pair.right_content_id,
        outcome=RedBlueOutcome.LEFT_WIN,
        client_event_id='revoke-during-full-comparison',
    )
    assert comparison.comparison_id is not None

    started = threading.Event()
    release = threading.Event()
    captured_revoked: list[bool] = []
    original_rank_preferences = red_blue_module.rank_preferences

    def blocked_rank_preferences(candidates, anchors, comparisons, config):
        captured_revoked.append(comparisons[0].revoked)
        if len(captured_revoked) == 1:
            started.set()
            assert release.wait(timeout=5)
        return original_rank_preferences(candidates, anchors, comparisons, config)

    monkeypatch.setattr(red_blue_module, 'rank_preferences', blocked_rank_preferences)
    try:
        service.request_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        assert started.wait(timeout=5)
        service.revoke_comparison(db, user_id=user.id, comparison_id=comparison.comparison_id)
        release.set()

        result = service.wait_for_recalibration(user.id, timeout=30)
        assert result is not None
        assert result.status is PreferenceModelRunStatus.COMPLETED
        assert result.applied_to_cache is True
        assert result.follow_up_required is False
        assert captured_revoked == [False, True]
        assert db.query(PreferenceModelRun).filter_by(user_id=user.id).count() == 3
        latest_run = db.query(PreferenceModelRun).filter_by(id=result.model_run_id).one()
        assert latest_run.input_revoke_version == 1
        cached = service.cache.get(user.id)
        assert cached is not None
        assert cached.revoke_version == 1
        assert cached.freshness is ModelFreshness.FULL
        assert all(item.comparison_count == 0 for item in cached.algorithm_state.authoritative_results)
    finally:
        release.set()
        service.close()


def test_anchor_change_during_full_run_applies_only_newer_snapshot(
    db,
    session_factory,
    make_user,
    monkeypatch,
):
    import services.red_blue as red_blue_module

    user = make_user('red-blue-race-anchor')
    contents = _rated_set(db, user.id, count=2)
    service = _service(session_factory)
    started = threading.Event()
    release = threading.Event()
    captured_anchors: list[tuple[tuple[int, int], ...]] = []
    original_rank_preferences = red_blue_module.rank_preferences

    def blocked_rank_preferences(candidates, anchors, comparisons, config):
        captured_anchors.append(tuple((anchor.content_id, anchor.score) for anchor in anchors))
        if len(captured_anchors) == 1:
            started.set()
            assert release.wait(timeout=5)
        return original_rank_preferences(candidates, anchors, comparisons, config)

    monkeypatch.setattr(red_blue_module, 'rank_preferences', blocked_rank_preferences)
    try:
        service.request_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        assert started.wait(timeout=5)
        first_run = (
            db.query(PreferenceModelRun)
            .filter_by(user_id=user.id, status=PreferenceModelRunStatus.RUNNING)
            .one()
        )
        upsert_rating(db, user_id=user.id, content_id=contents[0].id, score=99)
        release.set()
        full = service.wait_for_recalibration(user.id, timeout=30)
        assert full is not None
        assert full.status is PreferenceModelRunStatus.COMPLETED
        assert full.applied_to_cache is True
        assert full.follow_up_required is False
        assert len(captured_anchors) == 2
        assert captured_anchors[0] != captured_anchors[1]
        assert full.model_run_id != first_run.id
        assert db.query(PreferenceModelRun).filter_by(user_id=user.id).count() == 2
        cached = service.cache.get(user.id)
        assert cached is not None
        assert cached.base_model_run_id == full.model_run_id
        assert (contents[0].id, 99) in {
            (anchor.content_id, anchor.score) for anchor in cached.algorithm_state.score_anchors
        }
    finally:
        release.set()
        service.close()


def test_realtime_migration_is_idempotent_and_adds_watermarks(tmp_path, monkeypatch):
    from sqlalchemy import create_engine

    database_engine = create_engine(f'sqlite:///{tmp_path / "realtime.db"}')
    with database_engine.begin() as connection:
        connection.exec_driver_sql('CREATE TABLE users (id INTEGER PRIMARY KEY)')
        connection.exec_driver_sql(
            'CREATE TABLE preference_model_runs ('
            'id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, algorithm_version VARCHAR(64) NOT NULL, '
            'status VARCHAR(20) NOT NULL, input_comparison_max_id INTEGER, '
            'input_rating_revision_max_id INTEGER, algorithm_config_json TEXT NOT NULL DEFAULT \'{}\')',
        )
        connection.exec_driver_sql(
            'CREATE TABLE red_blue_comparisons ('
            'id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, left_content_id INTEGER NOT NULL, '
            'right_content_id INTEGER NOT NULL, outcome VARCHAR(20) NOT NULL, client_event_id VARCHAR(64) NOT NULL, '
            'selector_version VARCHAR(32) NOT NULL, created_at DATETIME, revoked_at DATETIME)'
        )
        connection.execute(text('INSERT INTO users (id) VALUES (1)'))
        connection.execute(
            text(
                "INSERT INTO red_blue_comparisons "
                "(id, user_id, left_content_id, right_content_id, outcome, client_event_id, selector_version) "
                "VALUES (1, 1, 10, 11, 'LEFT_WIN', 'migrate-1', 'v1')",
            )
        )
    monkeypatch.setattr(main_module, 'engine', database_engine)
    main_module._migrate_red_blue_realtime_state()
    main_module._migrate_red_blue_realtime_state()
    columns = {column['name'] for column in inspect(database_engine).get_columns('preference_model_runs')}
    assert {'input_comparison_state_version', 'input_revoke_version'} <= columns
    row = (
        database_engine.connect()
        .execute(text('SELECT * FROM red_blue_user_states WHERE user_id = 1'))
        .mappings()
        .one()
    )
    assert (row['comparison_state_version'], row['revoke_version']) == (1, 0)
