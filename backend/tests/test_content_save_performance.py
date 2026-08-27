from fastapi import BackgroundTasks

from models import ContentItem
from routers.v1.content import create_content
from schemas import ContentItemCreate
from services import covers


def test_create_content_queues_cover_localization_after_response(db, session_factory, make_user, monkeypatch):
    """内容保存不应执行封面下载，后台任务必须使用独立会话。"""
    admin = make_user('save-performance-admin', role='admin')
    calls: list[tuple[int, str]] = []

    def fake_localize(item: ContentItem, cover_url: str, task_db) -> str:
        calls.append((item.id, cover_url))
        assert task_db is not db
        return cover_url

    monkeypatch.setattr(covers, 'localize_cover', fake_localize)
    monkeypatch.setattr('database.SessionLocal', session_factory)
    background_tasks = BackgroundTasks()
    body = ContentItemCreate(
        title='后台封面保存测试',
        cover_url='https://lain.bgm.tv/pic/save-performance.jpg',
        content_type='anime',
        source_type='bangumi',
        source_id='92001',
    )

    response = create_content(body, background_tasks, admin, db)

    assert response.id > 0
    assert calls == []
    assert len(background_tasks.tasks) == 1

    task = background_tasks.tasks[0]
    task.func(*task.args, **task.kwargs)

    assert calls == [(response.id, body.cover_url)]


def test_cover_localization_task_skips_stale_cover(db, session_factory, make_user, monkeypatch):
    """用户再次编辑封面后，旧的后台任务不能覆盖新 URL。"""
    admin = make_user('stale-cover-admin', role='admin')
    item = ContentItem(
        title='旧封面任务测试',
        cover_url='https://lain.bgm.tv/pic/old.jpg',
        content_type='anime',
        source_type='bangumi',
        source_id='92002',
        created_by=admin.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    calls: list[str] = []

    def fake_localize(_item: ContentItem, cover_url: str, _task_db) -> str:
        calls.append(cover_url)
        return cover_url

    monkeypatch.setattr(covers, 'localize_cover', fake_localize)
    monkeypatch.setattr('database.SessionLocal', session_factory)
    item.cover_url = 'https://lain.bgm.tv/pic/new.jpg'
    db.commit()

    covers.localize_cover_in_background(
        item.id,
        'https://lain.bgm.tv/pic/old.jpg',
        'bangumi',
        '92002',
    )

    assert calls == []
