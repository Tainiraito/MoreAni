"""Auth router — login, register, me, avatar, password."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from auth import create_access_token, get_password_hash, verify_password
from deps import get_current_user, get_db
from models import InviteCode, User
from schemas import (
    AuthResponse,
    AvatarUpdateRequest,
    LoginRequest,
    NicknameUpdateRequest,
    PasswordChangeRequest,
    RegisterRequest,
    UserResponse,
)
from services.user import (
    create_user,
    get_user_by_login,
    update_avatar,
    update_nickname,
    update_password,
)

router = APIRouter(prefix='/auth', tags=['auth'])


@router.post('/login', response_model=AuthResponse)
def login(
    body: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthResponse:
    """Login with username and password.

    Sets httpOnly cookie 'access_token' on success.
    """
    user = get_user_by_login(db, body.username)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='账号/昵称或密码错误',
        )

    token = create_access_token({'sub': user.id})
    response.set_cookie(
        key='access_token',
        value=token,
        httponly=True,
        samesite='lax',
        secure=True,  # HTTPS（生产 Cloudflare Tunnel）/localhost 均支持
        max_age=7 * 24 * 3600,  # 7 days
        path='/',
    )
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post('/register', response_model=AuthResponse)
def register(
    body: RegisterRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthResponse:
    """Register with invite code.

    Sets httpOnly cookie 'access_token' on success.
    """
    # Validate invite code
    invite = db.query(InviteCode).filter(InviteCode.code == body.invite_code).first()
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='邀请码无效',
        )
    if invite.use_count >= invite.max_uses:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='邀请码已用完',
        )
    # SQLite DATETIME 存的是 naive UTC，用 naive now 比较
    if invite.expires_at and invite.expires_at < datetime.now(UTC).replace(tzinfo=None):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='邀请码已过期',
        )

    # Check username & nickname uniqueness — both must not collide with ANY
    # existing username/nickname, otherwise login lookup becomes ambiguous.
    if get_user_by_login(db, body.username):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='账号已被使用',
        )
    if get_user_by_login(db, body.nickname):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='昵称已被使用',
        )

    # Create user
    password_hash = get_password_hash(body.password)
    user = create_user(
        db,
        username=body.username,
        nickname=body.nickname,
        password_hash=password_hash,
    )

    # Increment invite code usage
    invite.use_count += 1
    if invite.use_count >= invite.max_uses:
        invite.used_by = user.id  # last use — mark with the user
    db.commit()

    # Auto-login
    token = create_access_token({'sub': user.id})
    response.set_cookie(
        key='access_token',
        value=token,
        httponly=True,
        samesite='lax',
        secure=True,  # HTTPS（生产 Cloudflare Tunnel）/localhost 均支持
        max_age=7 * 24 * 3600,
        path='/',
    )
    return AuthResponse(user=UserResponse.model_validate(user))


@router.get('/me', response_model=UserResponse)
def get_me(user: User = Depends(get_current_user)) -> UserResponse:
    """Get current authenticated user info."""
    return UserResponse.model_validate(user)


@router.put('/me/avatar', response_model=UserResponse)
def update_my_avatar(
    body: AvatarUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserResponse:
    """Update current user's avatar."""
    updated = update_avatar(db, user, body.avatar_id)
    return UserResponse.model_validate(updated)


@router.put('/me/password')
def change_password(
    body: PasswordChangeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Change current user's password."""
    if not verify_password(body.old_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='原密码错误',
        )
    new_hash = get_password_hash(body.new_password)
    update_password(db, user, new_hash)
    return {'detail': '密码修改成功'}


@router.put('/me/nickname', response_model=UserResponse)
def update_my_nickname(
    body: NicknameUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserResponse:
    """Update current user's nickname.

    Nickname must not collide with any existing username/nickname
    (otherwise login lookup becomes ambiguous).
    """
    if body.nickname == user.nickname:
        return UserResponse.model_validate(user)
    if get_user_by_login(db, body.nickname):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='昵称已被使用',
        )
    updated = update_nickname(db, user, body.nickname)
    return UserResponse.model_validate(updated)


@router.post('/logout')
def logout(response: Response) -> dict:
    """Clear access token cookie."""
    response.delete_cookie(key='access_token', path='/')
    return {'detail': '已退出登录'}
