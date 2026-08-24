"""Admin user management (super_admin only).

Provides user CRUD: list/search/create/update/delete.
Also invite-code CRUD: list/create/update/delete.
"""

import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from auth import get_password_hash
from deps import get_db, require_role
from models import (
    InviteCode,
    Notification,
    NotificationRead,
    Rating,
    ResourceSubscription,
    ShareLink,
    User,
    UserContentStatus,
)
from schemas import AnnouncementCreate, AnnouncementResponse, AnnouncementUpdate
from services import notifications as notification_svc
from services.avatar import avatar_fields

router = APIRouter(prefix='/admin', tags=['admin'])


def _to_admin_user(u: User) -> dict:
    return {
        'id': u.id,
        'username': u.username,
        'nickname': u.nickname,
        'role': u.role,
        **avatar_fields(u),
        'created_at': u.created_at.isoformat() if u.created_at else None,
    }


def _ensure_super_admin_kept(db: Session, user: User, new_role: str | None = None) -> None:
    """防止把最后一个超级管理员降级/删除。"""
    if user.role != 'super_admin':
        return
    if new_role and new_role == 'super_admin':
        return
    count = db.query(func.count(User.id)).filter(User.role == 'super_admin').scalar()
    if count <= 1:
        raise HTTPException(
            status_code=400,
            detail='不能降级或删除最后一个超级管理员',
        )


@router.get('/users')
def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role('super_admin')),
    q: str | None = Query(None, description='Search by username/nickname'),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    """List users with optional search and pagination."""
    query = db.query(User)
    if q:
        like = f'%{q}%'
        query = query.filter((User.username.ilike(like)) | (User.nickname.ilike(like)))
    total = query.count()
    users = query.order_by(User.id).offset((page - 1) * size).limit(size).all()
    return {
        'items': [_to_admin_user(u) for u in users],
        'total': total,
        'page': page,
        'size': size,
    }


@router.post('/users', status_code=201)
def create_user_admin(
    body: dict,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role('super_admin')),
) -> dict:
    """Create a user (no invite code required)."""
    username = (body.get('username') or '').strip()
    nickname = (body.get('nickname') or '').strip() or username
    password = body.get('password') or ''
    role = body.get('role') or 'user'
    if not username or not password:
        raise HTTPException(status_code=422, detail='账号和密码必填')
    if len(password) < 6:
        raise HTTPException(status_code=422, detail='密码至少 6 位')
    if role not in ('user', 'admin', 'super_admin'):
        raise HTTPException(status_code=422, detail='角色不合法')
    # 唯一性
    identifiers = [username, nickname]
    exists = db.query(User).filter(or_(User.username.in_(identifiers), User.nickname.in_(identifiers))).first()
    if exists:
        raise HTTPException(status_code=409, detail='账号或昵称已被使用')
    user = User(
        username=username,
        nickname=nickname,
        password_hash=get_password_hash(password),
        avatar_id=0,
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_admin_user(user)


@router.put('/users/{user_id}')
def update_user_admin(
    user_id: int,
    body: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(require_role('super_admin')),
) -> dict:
    """Update a user (nickname / username / password / role)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail='用户不存在')

    username = (body.get('username') or '').strip() if 'username' in body else None
    nickname = (body.get('nickname') or '').strip() if 'nickname' in body else None
    password = body.get('password') if 'password' in body else None
    role = body.get('role') if 'role' in body else None

    candidate_username = username or user.username
    candidate_nickname = nickname or user.nickname
    identifiers = [candidate_username, candidate_nickname]
    clash = (
        db.query(User)
        .filter(
            User.id != user.id,
            or_(User.username.in_(identifiers), User.nickname.in_(identifiers)),
        )
        .first()
    )
    if clash:
        raise HTTPException(status_code=409, detail='账号或昵称已被使用')
    if username:
        user.username = username
    if nickname:
        user.nickname = nickname
    if password:
        if len(password) < 6:
            raise HTTPException(status_code=422, detail='密码至少 6 位')
        user.password_hash = get_password_hash(password)
    if role is not None:
        if role not in ('user', 'admin', 'super_admin'):
            raise HTTPException(status_code=422, detail='角色不合法')
        _ensure_super_admin_kept(db, user, role)
        user.role = role

    db.commit()
    db.refresh(user)
    return _to_admin_user(user)


@router.delete('/users/{user_id}', status_code=204)
def delete_user_admin(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_role('super_admin')),
) -> None:
    """Delete a user and their ratings / statuses / shares."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail='用户不存在')
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail='不能删除自己')
    _ensure_super_admin_kept(db, user)

    try:
        # 使用原生 SQL，避免触发 ContentItem.updated_at 的 onupdate；内容历史只改变归属。
        db.execute(
            text('UPDATE content_items SET created_by = :admin_id WHERE created_by = :user_id'),
            {'admin_id': admin.id, 'user_id': user_id},
        )
        db.query(Rating).filter(Rating.user_id == user_id).delete(synchronize_session=False)
        db.query(UserContentStatus).filter(UserContentStatus.user_id == user_id).delete(synchronize_session=False)
        db.query(ResourceSubscription).filter(ResourceSubscription.user_id == user_id).delete(synchronize_session=False)
        db.query(NotificationRead).filter(NotificationRead.user_id == user_id).delete(synchronize_session=False)
        db.query(Notification).filter(Notification.recipient_user_id == user_id).delete(synchronize_session=False)
        db.query(ShareLink).filter(ShareLink.created_by == user_id).delete(synchronize_session=False)
        db.query(InviteCode).filter(InviteCode.used_by == user_id).update(
            {InviteCode.used_by: None},
            synchronize_session=False,
        )
        db.delete(user)
        db.commit()
    except Exception:
        db.rollback()
        raise


# ── 公共通知管理 ───────────────────────────────────────────────────────


def _announcement_response(item: Notification) -> AnnouncementResponse:
    """Serialize an announcement for the admin panel."""
    return AnnouncementResponse(
        id=item.id,
        title=item.title,
        body=item.body,
        is_published=item.is_published,
        published_at=item.published_at,
        expires_at=item.expires_at,
        created_at=item.created_at,
    )


@router.get('/announcements')
def list_announcements_admin(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role('super_admin')),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    """List public announcements, including drafts and expired rows."""
    items, total = notification_svc.list_announcements(db, page=page, size=size)
    return {
        'items': [_announcement_response(item) for item in items],
        'total': total,
        'page': page,
        'size': size,
    }


@router.post('/announcements', response_model=AnnouncementResponse, status_code=201)
def create_announcement_admin(
    body: AnnouncementCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_role('super_admin')),
) -> AnnouncementResponse:
    """Create a public announcement."""
    item = notification_svc.create_announcement(db, admin_id=admin.id, data=body.model_dump())
    return _announcement_response(item)


@router.put('/announcements/{announcement_id}', response_model=AnnouncementResponse)
def update_announcement_admin(
    announcement_id: int,
    body: AnnouncementUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role('super_admin')),
) -> AnnouncementResponse:
    """Update a public announcement."""
    item = notification_svc.update_announcement(
        db,
        announcement_id=announcement_id,
        data=body.model_dump(exclude_unset=True),
    )
    if not item:
        raise HTTPException(status_code=404, detail='公告不存在')
    return _announcement_response(item)


@router.delete('/announcements/{announcement_id}', status_code=204)
def delete_announcement_admin(
    announcement_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role('super_admin')),
) -> None:
    """Delete a public announcement."""
    if not notification_svc.delete_announcement(db, announcement_id=announcement_id):
        raise HTTPException(status_code=404, detail='公告不存在')


# ── 邀请码管理 ──────────────────────────────────────────────────────────


def _to_invite(i: InviteCode) -> dict:
    # SQLite DATETIME 存的是 naive UTC，用 naive now 比较
    now = datetime.now(UTC).replace(tzinfo=None)
    used_up = i.use_count >= i.max_uses
    expired = bool(i.expires_at and i.expires_at < now)
    return {
        'id': i.id,
        'code': i.code,
        'max_uses': i.max_uses,
        'use_count': i.use_count,
        'expires_at': i.expires_at.isoformat() if i.expires_at else None,
        'created_at': i.created_at.isoformat() if i.created_at else None,
        'status': 'expired' if expired else ('used_up' if used_up else 'active'),
    }


@router.get('/invites')
def list_invites(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role('super_admin')),
    q: str | None = Query(None, description='Search by code'),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    """List invite codes."""
    query = db.query(InviteCode)
    if q:
        query = query.filter(InviteCode.code.ilike(f'%{q}%'))
    total = query.count()
    codes = query.order_by(InviteCode.id.desc()).offset((page - 1) * size).limit(size).all()
    return {
        'items': [_to_invite(i) for i in codes],
        'total': total,
        'page': page,
        'size': size,
    }


@router.post('/invites', status_code=201)
def create_invite(
    body: dict,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role('super_admin')),
) -> dict:
    """Create an invite code (code empty => auto generate)."""
    code = (body.get('code') or '').strip() or secrets.token_urlsafe(5)
    try:
        max_uses = int(body.get('max_uses') or 1)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail='可用次数不合法')  # noqa: B904
    if max_uses < 1:
        raise HTTPException(status_code=422, detail='可用次数至少 1 次')
    expires_raw = (body.get('expires_at') or '').strip()
    expires_at = None
    if expires_raw:
        try:
            expires_at = datetime.fromisoformat(expires_raw.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=422, detail='有效时间格式不合法（YYYY-MM-DD）') from None

    exists = db.query(InviteCode).filter(InviteCode.code == code).first()
    if exists:
        raise HTTPException(status_code=409, detail='邀请码已存在')
    invite = InviteCode(code=code, max_uses=max_uses, expires_at=expires_at)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return _to_invite(invite)


@router.put('/invites/{invite_id}')
def update_invite(
    invite_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role('super_admin')),
) -> dict:
    """Update an invite code (code / max_uses / expires_at)."""
    invite = db.query(InviteCode).filter(InviteCode.id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail='邀请码不存在')

    code = (body.get('code') or '').strip() if 'code' in body else None
    max_uses = body.get('max_uses') if 'max_uses' in body else None
    expires_raw = body.get('expires_at') if 'expires_at' in body else None

    if code:
        clash = db.query(InviteCode).filter(InviteCode.code == code, InviteCode.id != invite_id).first()
        if clash:
            raise HTTPException(status_code=409, detail='邀请码已存在')
        invite.code = code
    if max_uses is not None:
        try:
            m = int(max_uses)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail='可用次数不合法')  # noqa: B904
        if m < 1:
            raise HTTPException(status_code=422, detail='可用次数至少 1 次')
        invite.max_uses = m
    if expires_raw is not None:
        raw = (expires_raw or '').strip()
        if not raw:
            invite.expires_at = None
        else:
            try:
                invite.expires_at = datetime.fromisoformat(raw.replace('Z', '+00:00'))
            except ValueError:
                raise HTTPException(status_code=422, detail='有效时间格式不合法')  # noqa: B904

    db.commit()
    db.refresh(invite)
    return _to_invite(invite)


@router.delete('/invites/{invite_id}', status_code=204)
def delete_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role('super_admin')),
) -> None:
    """Delete an invite code."""
    invite = db.query(InviteCode).filter(InviteCode.id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail='邀请码不存在')
    db.delete(invite)
    db.commit()
