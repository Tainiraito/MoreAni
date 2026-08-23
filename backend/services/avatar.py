"""Avatar validation and response helpers."""

import json
import math
from typing import Any

from pydantic import ValidationError

from schemas import AvatarCrop


def avatar_crop_from_db(value: str | dict[str, Any] | None) -> dict[str, Any] | None:
    """Parse a stored crop value and discard malformed legacy data."""
    if not value:
        return None
    try:
        data = json.loads(value) if isinstance(value, str) else value
        crop = AvatarCrop.model_validate(data)
        if not all(math.isfinite(number) for number in (crop.x, crop.y, crop.size)):
            return None
        return crop.model_dump(mode='json')
    except (TypeError, ValueError, ValidationError, json.JSONDecodeError):
        return None


def parse_avatar_crop(
    raw: str | None,
    *,
    image_width: int | None = None,
    image_height: int | None = None,
) -> dict[str, Any] | None:
    """Validate a client-provided source-image crop."""
    if raw is None or not raw.strip():
        return None
    try:
        data = json.loads(raw)
        crop = AvatarCrop.model_validate(data)
    except (json.JSONDecodeError, TypeError, ValueError, ValidationError) as exc:
        raise ValueError('头像裁剪参数无效') from exc

    if not all(math.isfinite(number) for number in (crop.x, crop.y, crop.size)):
        raise ValueError('头像裁剪参数无效')
    if (
        image_width is not None
        and image_height is not None
        and (crop.x + crop.size > image_width or crop.y + crop.size > image_height)
    ):
        raise ValueError('头像裁剪区域超出图片范围')
    return crop.model_dump(mode='json')


def dump_avatar_crop(crop: dict[str, Any] | None) -> str | None:
    """Serialize a validated crop for the users table."""
    if crop is None:
        return None
    return json.dumps(crop, separators=(',', ':'), ensure_ascii=False)


def avatar_fields(user: Any, *, anonymous: bool = False) -> dict[str, Any]:
    """Return the avatar fields shared by user and rating responses."""
    if anonymous:
        return {'avatar_id': 0, 'avatar_url': None, 'avatar_crop': None}
    return {
        'avatar_id': user.avatar_id,
        'avatar_url': user.avatar_url,
        'avatar_crop': avatar_crop_from_db(user.avatar_crop),
    }
