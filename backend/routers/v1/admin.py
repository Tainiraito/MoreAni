"""Admin user management (super_admin only).

Provides user CRUD: list/search/create/update/delete.
Also invite-code CRUD: list/create/update/delete.
"""
import secrets
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_password_hash
from deps import get_current_user, get_db, require_role
from models import InviteCode, Rating, ShareLink, User, UserContentStatus

router = APIRouter(prefix='/admin', tags=['admin'])


def _to_admin_user(u: User) -> dict:
    return {
        'id': u.id,
        'username': u.username,
        'nickname': u.nickname,
        'role': u.role,
        'avatar_id': u.avatar_id,
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
    exists = db.query(User).filter(
        (User.username == username) | (User.nickname == nickname)
    ).first()
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

    if username is not None and username and username != user.username:
        clash = db.query(User).filter(User.username == username, User.id != user.id).first()
        if clash:
            raise HTTPException(status_code=409, detail='账号已被使用')
        user.username = username
    if nickname is not None and nickname and nickname != user.nickname:
        clash = db.query(User).filter(User.nickname == nickname, User.id != user.id).first()
        if clash:
            raise HTTPException(status_code=409, detail='昵称已被使用')
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

    db.query(Rating).filter(Rating.user_id == user_id).delete()
    db.query(UserContentStatus).filter(UserContentStatus.user_id == user_id).delete()
    db.query(ShareLink).filter(ShareLink.created_by == user_id).delete()
    db.delete(user)
    db.commit()


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
            raise HTTPException(status_code=422, detail='有效时间格式不合法（YYYY-MM-DD）')  # noqa: B904

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
