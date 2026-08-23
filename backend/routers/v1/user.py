"""User router — public profile and rating history."""

import os
import secrets
import time
from contextlib import suppress
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from deps import get_current_user, get_db
from models import User
from schemas import UserPublicProfile
from services import rating as rating_svc
from services import user as user_svc
from services.avatar import avatar_crop_from_db, avatar_fields, dump_avatar_crop, parse_avatar_crop

router = APIRouter(prefix='/user', tags=['user'])

AVATARS_DIR = os.getenv('AVATARS_DIR', 'avatars')
ALLOWED_AVATAR_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}
MAX_AVATAR_BYTES = 2 * 1024 * 1024  # 2MB


@router.get('/list')
def list_users(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """List registered users (excludes super_admin 爱莉希雅).

    供前端「按用户筛选」使用：选择用户后查看其评分/评论过的番。
    """
    users = db.query(User).filter(User.role != 'super_admin').order_by(User.id).all()
    return {
        'items': [
            {
                'id': u.id,
                'username': u.username,
                'nickname': u.nickname,
                **avatar_fields(u),
            }
            for u in users
        ]
    }


@router.post('/avatar')
def upload_avatar(
    file: UploadFile = File(...),
    crop: str | None = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """上传/更换自己的头像（图片 ≤2MB，jpg/png/webp/gif）。"""
    ext = os.path.splitext(file.filename or '')[1].lower()
    if ext not in ALLOWED_AVATAR_EXTS:
        raise HTTPException(status_code=400, detail='仅支持 jpg/png/webp/gif 格式')
    if ext == '.jpeg':
        ext = '.jpg'
    content_type = (file.content_type or '').lower()
    if not content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail='文件不是图片')

    data = file.file.read()
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail='图片不能超过 2MB')

    # 魔数校验：文件头必须匹配扩展名声称的图片格式（防伪装/防 HTML 等非图片内容）
    if not _is_valid_image_magic(data, ext):
        raise HTTPException(status_code=400, detail='文件内容不是有效的图片')

    crop_data = None
    if ext == '.gif':
        width, height = _gif_dimensions(data)
        if crop and (width is None or height is None):
            raise HTTPException(status_code=400, detail='文件内容不是有效的 GIF 图片')
        try:
            crop_data = parse_avatar_crop(crop, image_width=width, image_height=height)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # 使用唯一文件名 + 临时文件，避免更换扩展名时残留旧文件或读到半写入文件。
    avatar_dir = Path(AVATARS_DIR)
    avatar_dir.mkdir(parents=True, exist_ok=True)
    filename = f'{user.id}-{secrets.token_hex(8)}{ext}'
    final_path = avatar_dir / filename
    temp_path = avatar_dir / f'.{filename}.tmp'
    old_path = _avatar_path(user.avatar_url)
    avatar_url = f'/api/avatars/{filename}?v={int(time.time())}'
    try:
        temp_path.write_bytes(data)
        os.replace(temp_path, final_path)
        user.avatar_url = avatar_url
        user.avatar_crop = dump_avatar_crop(crop_data)
        db.commit()
    except Exception:
        db.rollback()
        with suppress(OSError):
            temp_path.unlink()
        with suppress(OSError):
            final_path.unlink()
        raise

    if old_path and old_path != final_path:
        with suppress(OSError):
            old_path.unlink()
    return {'avatar_url': avatar_url, 'avatar_crop': crop_data}


@router.delete('/avatar')
def delete_avatar(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """删除自己的头像（清空 avatar_url + 删除文件）。"""
    if user.avatar_url or user.avatar_crop:
        path = _avatar_path(user.avatar_url)
        if path:
            with suppress(OSError):
                path.unlink()  # 文件删除失败不阻塞（URL 已清空）
        user.avatar_url = None
        user.avatar_crop = None
        db.commit()
    return {'avatar_url': None, 'avatar_crop': None}


def _is_valid_image_magic(data: bytes, ext: str) -> bool:
    """文件头魔数匹配扩展名：PNG/JPEG/GIF/WEBP。"""
    if ext == '.png':
        return data[:8] == b'\x89PNG\r\n\x1a\n'
    if ext == '.jpg':
        return data[:2] == b'\xff\xd8'
    if ext == '.gif':
        return data[:6] in (b'GIF87a', b'GIF89a')
    if ext == '.webp':
        return data[:4] == b'RIFF' and data[8:12] == b'WEBP'
    return False


def _gif_dimensions(data: bytes) -> tuple[int | None, int | None]:
    """Read the GIF logical screen dimensions without decoding its frames."""
    if len(data) < 10 or data[:6] not in (b'GIF87a', b'GIF89a'):
        return None, None
    width = int.from_bytes(data[6:8], 'little')
    height = int.from_bytes(data[8:10], 'little')
    return (width, height) if width > 0 and height > 0 else (None, None)


def _avatar_path(avatar_url: str | None) -> Path | None:
    """Resolve only the basename of a stored avatar URL inside AVATARS_DIR."""
    if not avatar_url:
        return None
    filename = os.path.basename(avatar_url.split('?', 1)[0])
    if not filename:
        return None
    return Path(AVATARS_DIR) / filename


@router.get('/{user_id}', response_model=UserPublicProfile)
def get_user_profile(
    user_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserPublicProfile:
    """Get a user's public profile."""
    target = user_svc.get_user_by_id(db, user_id)
    if not target:
        raise HTTPException(status_code=404, detail='User not found')

    stats = user_svc.get_user_stats(db, user_id)
    return UserPublicProfile(
        id=target.id,
        username=target.username,
        nickname=target.nickname,
        avatar_id=target.avatar_id,
        avatar_url=target.avatar_url,
        avatar_crop=avatar_crop_from_db(target.avatar_crop),
        role=target.role,
        created_at=target.created_at,
        rating_count=stats['rating_count'],
        review_count=stats['review_count'],
        favorite_count=stats['favorite_count'],
        avg_score=stats['avg_score'],
        content_count=stats['content_count'],
    )


@router.get('/{user_id}/activity')
def get_user_activity(
    user_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    """Get a user's activity feed (ratings/reviews/favorites, time desc)."""
    if not user_svc.get_user_by_id(db, user_id):
        raise HTTPException(status_code=404, detail='User not found')
    items, total = user_svc.get_user_activity(db, user_id, page=page, size=size)
    return {'items': items, 'total': total}


@router.get('/{user_id}/ratings')
def get_user_ratings(
    user_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    """Get a user's rating history."""
    target = user_svc.get_user_by_id(db, user_id)
    if not target:
        raise HTTPException(status_code=404, detail='User not found')

    items, total = rating_svc.get_user_ratings(db, user_id, page=page, size=size)
    return {'items': items, 'total': total}
