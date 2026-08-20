from datetime import UTC, datetime

import pytest
from conftest import auth_cookie

from auth import verify_password
from models import ContentItem, InviteCode, Rating, ShareLink, User, UserContentStatus
from routers.v1.admin import delete_user_admin
from routers.v1.rating import delete_rating
from scripts import manage_users


def test_bootstrap_admin_requires_env_and_hashes_password(monkeypatch, db, capsys):
    monkeypatch.setattr(manage_users, 'SessionLocal', lambda: db)
    monkeypatch.setattr(manage_users, 'migrate_nickname', lambda: None)
    monkeypatch.delenv(manage_users.ADMIN_PASSWORD_ENV, raising=False)

    with pytest.raises(SystemExit):
        manage_users.init_admin()
    assert db.query(User).count() == 0

    password = 'random-bootstrap-password'
    monkeypatch.setenv(manage_users.ADMIN_PASSWORD_ENV, password)
    manage_users.init_admin()
    admin = db.query(User).one()
    assert admin.password_hash != password
    assert verify_password(password, admin.password_hash)
    assert password not in capsys.readouterr().out

    manage_users.init_admin()
    assert db.query(User).count() == 1


def test_delete_user_transfers_content_and_preserves_other_user_data(db, make_user):
    operator = make_user('operator', 'super_admin')
    target = make_user('target')
    other = make_user('other')
    original_updated_at = datetime(2025, 1, 1, tzinfo=UTC)
    content = ContentItem(
        title='保留内容',
        content_type='anime',
        created_by=target.id,
        updated_at=original_updated_at,
    )
    db.add(content)
    db.flush()
    target_rating = Rating(content_id=content.id, user_id=target.id, score=60)
    other_rating = Rating(content_id=content.id, user_id=other.id, score=90)
    target_status = UserContentStatus(content_id=content.id, user_id=target.id, status='want')
    other_status = UserContentStatus(content_id=content.id, user_id=other.id, status='watched')
    invite = InviteCode(code='USED', max_uses=1, use_count=1, used_by=target.id)
    share = ShareLink(token='target-share', created_by=target.id)
    db.add_all([target_rating, other_rating, target_status, other_status, invite, share])
    db.commit()

    delete_user_admin(target.id, admin=operator, db=db)
    db.expire_all()

    preserved = db.query(ContentItem).filter_by(id=content.id).one()
    assert preserved.created_by == operator.id
    assert preserved.updated_at.replace(tzinfo=UTC) == original_updated_at
    assert db.query(Rating).filter_by(content_id=content.id, user_id=other.id).count() == 1
    assert db.query(UserContentStatus).filter_by(content_id=content.id, user_id=other.id).count() == 1
    assert db.query(Rating).filter_by(user_id=target.id).count() == 0
    assert db.query(UserContentStatus).filter_by(user_id=target.id).count() == 0
    assert db.query(InviteCode).filter_by(id=invite.id).one().used_by is None
    assert db.query(User).filter_by(id=target.id).first() is None


def test_private_detail_permissions_and_public_anonymous(client, db, make_user):
    creator = make_user('creator')
    ordinary = make_user('ordinary')
    admin = make_user('admin', 'admin')
    public = ContentItem(title='公开', content_type='anime', is_public=True, created_by=creator.id)
    private = ContentItem(title='私有', content_type='anime', is_public=False, created_by=creator.id)
    db.add_all([public, private])
    db.commit()

    assert client.get(f'/api/v1/content/{public.id}').status_code == 200
    assert client.get(f'/api/v1/content/{private.id}').status_code == 404
    assert client.get(f'/api/v1/content/{private.id}', cookies=auth_cookie(ordinary)).status_code == 404
    assert client.get(f'/api/v1/content/{private.id}', cookies=auth_cookie(creator)).status_code == 200
    assert client.get(f'/api/v1/content/{private.id}', cookies=auth_cookie(admin)).status_code == 200


def test_admin_roles_can_delete_other_ratings_but_user_cannot(db, make_user):
    owner = make_user('rating-owner')
    normal = make_user('normal')
    admin = make_user('rating-admin', 'admin')
    super_admin = make_user('rating-super', 'super_admin')
    content = ContentItem(title='评分内容', content_type='anime')
    db.add(content)
    db.flush()

    rating = Rating(content_id=content.id, user_id=owner.id, score=80)
    db.add(rating)
    db.commit()
    with pytest.raises(Exception) as exc_info:
        delete_rating(rating.id, user=normal, db=db)
    assert exc_info.value.status_code == 403

    delete_rating(rating.id, user=admin, db=db)
    for actor in (admin, super_admin):
        replacement = Rating(content_id=content.id, user_id=owner.id, score=80)
        db.add(replacement)
        db.commit()
        delete_rating(replacement.id, user=actor, db=db)


def test_profile_includes_uploaded_avatar_url(client, db, make_user):
    viewer = make_user('viewer')
    target = make_user('avatar-user', avatar_url='/api/avatars/2.png?v=1')
    response = client.get(f'/api/v1/user/{target.id}', cookies=auth_cookie(viewer))
    assert response.status_code == 200
    assert response.json()['avatar_url'] == target.avatar_url
