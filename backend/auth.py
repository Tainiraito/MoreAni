import logging
import os
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import get_db
from models import User

logger = logging.getLogger('uvicorn')

_secret = os.getenv('SECRET_KEY')
if _secret:
    SECRET_KEY = _secret
else:
    SECRET_KEY = secrets.token_hex(32)
    logger.warning(
        '⚠️  未设置 SECRET_KEY 环境变量，已使用随机密钥。'
        '所有已签发的 token 将在服务重启后失效。'
        '生产环境请务必设置 SECRET_KEY 环境变量。'
    )
ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_DAYS = 30

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')
security = HTTPBearer()
security_optional = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(UTC) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({'exp': expire})
    if 'sub' in to_encode:
        to_encode['sub'] = str(to_encode['sub'])
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id_str = payload.get('sub')
        if user_id_str is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid token'
            )
        user_id = int(user_id_str)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid token'
        ) from e

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail='User not found'
        )
    return user


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_optional),
    db: Session = Depends(get_db),
) -> User | None:
    if credentials is None:
        return None
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id_str = payload.get('sub')
        if user_id_str is None:
            return None
        user_id = int(user_id_str)
    except JWTError:
        return None

    user = db.query(User).filter(User.id == user_id).first()
    return user
