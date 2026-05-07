from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models import User, InviteCode
from schemas import LoginRequest, RegisterRequest, AuthResponse, UserSchema, ChangeUsernameRequest, ChangePasswordRequest, CheckUsernameRequest
from auth import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix='/auth', tags=['auth'])


@router.post('/register', response_model=AuthResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if len(req.username) < 2 or len(req.username) > 50:
        raise HTTPException(status_code=400, detail='用户名长度需在2~50个字符之间')
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail='密码长度至少6位')

    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(status_code=400, detail='用户名已被注册')

    invite = db.query(InviteCode).filter(InviteCode.code == req.invite_code).first()
    if not invite:
        raise HTTPException(status_code=400, detail='邀请码无效')

    user = User(
        username=req.username,
        password_hash=hash_password(req.password)
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({'sub': user.id})
    return AuthResponse(
        access_token=token,
        token_type='bearer',
        user=UserSchema.model_validate(user)
    )


@router.post('/login', response_model=AuthResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail='用户名或密码错误')

    token = create_access_token({'sub': user.id})
    return AuthResponse(
        access_token=token,
        token_type='bearer',
        user=UserSchema.model_validate(user)
    )


@router.get('/me', response_model=UserSchema)
def me(current_user: User = Depends(get_current_user)):
    return UserSchema.model_validate(current_user)


@router.post('/check-username', response_model=dict)
def check_username(
    req: CheckUsernameRequest,
    db: Session = Depends(get_db)
):
    existing = db.query(User).filter(User.username == req.username).first()
    return {'available': existing is None}


@router.put('/me/username', response_model=UserSchema)
def change_username(
    req: ChangeUsernameRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    existing = db.query(User).filter(User.username == req.new_username).first()
    if existing:
        raise HTTPException(status_code=400, detail='用户名已被使用')
    current_user.username = req.new_username
    db.commit()
    db.refresh(current_user)
    return UserSchema.model_validate(current_user)


@router.put('/me/password', status_code=204)
def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not verify_password(req.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail='原密码错误')
    current_user.password_hash = hash_password(req.new_password)
    db.commit()
