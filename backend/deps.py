"""FastAPI dependencies for MoreAni v2.

Provides get_db, get_current_user, get_current_user_optional, and require_role.
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import verify_token
from database import get_db as _get_db
from models import User

# get_db 直接复用 database.get_db（别名）：
# 与 get_current_user 内部的 Depends(_get_db) 是同一函数 → FastAPI 同请求内
# 依赖缓存共享同一 session。之前这里是 `def get_db(): yield from _get_db()`
# 包装——FastAPI 视作不同依赖，导致 get_current_user 返回的 user 与接口的 db
# 分属两个 session：`user.xxx = ...; db.commit()` 写操作不生效（头像/角色修改丢数据）。
get_db = _get_db


def get_current_user(
    access_token: Annotated[str | None, Cookie()] = None,
    db: Session = Depends(_get_db),
) -> User:
    """Require a valid JWT and return the authenticated user.

    Reads the token from the httpOnly cookie named 'access_token'.
    """
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Not authenticated',
        )
    payload = verify_token(access_token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid or expired token',
        )
    user_id_str = payload.get('sub')
    if user_id_str is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid token payload',
        )
    user = db.query(User).filter(User.id == int(user_id_str)).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='User not found',
        )
    return user


def get_current_user_optional(
    access_token: Annotated[str | None, Cookie()] = None,
    db: Session = Depends(_get_db),
) -> User | None:
    """Return the current user if authenticated, otherwise None."""
    if not access_token:
        return None
    payload = verify_token(access_token)
    if payload is None:
        return None
    user_id_str = payload.get('sub')
    if user_id_str is None:
        return None
    user = db.query(User).filter(User.id == int(user_id_str)).first()
    return user


def require_role(*roles: str) -> Callable:
    """Dependency factory that checks user has one of the given roles.

    'super_admin' 隐式拥有 'admin' 权限（require_role('admin') 也会放行 super_admin）。
    普通用户只拥有 'user' 权限，不拥有任何管理权限。
    Usage:
        @router.get("/admin-only", dependencies=[Depends(require_role("admin"))])
    """

    def _check(user: User = Depends(get_current_user)) -> User:
        effective = {user.role}
        if user.role == 'super_admin':
            effective.add('admin')
        if not effective.intersection(roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail='Insufficient permissions',
            )
        return user

    return _check
