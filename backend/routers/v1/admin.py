"""Admin user management (super_admin only).

Provides user CRUD: list/search/create/update/delete.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_password_hash
from deps import get_current_user, get_db, require_role
from models import Rating, ShareLink, User, UserContentStatus

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
