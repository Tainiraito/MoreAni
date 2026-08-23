"""Avatar validation and response helpers."""

import json
import math
from typing import Any

from pydantic import ValidationError

from schemas import AvatarCrop

_GIF_LOOP_EXTENSION = b'\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00'
_GIF_LOOP_APPLICATION_IDS = (b'NETSCAPE2.0', b'ANIMEXTS1.0')


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


def normalize_gif_loop(data: bytes) -> bytes:
    """Make a GIF loop forever without re-encoding its frames.

    GIF loop count is stored in a Netscape application extension. Some files
    omit that extension (play once), while others store a finite count. This
    only changes/inserts that metadata block and leaves all image data intact.
    Malformed data is returned unchanged; the existing magic-number validator
    remains responsible for the upload-level format check.
    """
    if len(data) < 13 or data[:6] not in (b'GIF87a', b'GIF89a'):
        return data

    normalized = bytearray(data)
    changed = False
    for application_id in _GIF_LOOP_APPLICATION_IDS:
        start = 0
        while True:
            index = normalized.find(application_id, start)
            if index < 0:
                break
            # Verify this is an application extension, not the same text in a
            # comment or image payload. The standard block size is 11 bytes.
            if index >= 3 and normalized[index - 3 : index] == b'\x21\xff\x0b':
                count_start = index + len(application_id)
                if normalized[count_start : count_start + 2] == b'\x03\x01':
                    count_start += 2
                    if count_start + 2 <= len(normalized):
                        normalized[count_start : count_start + 2] = b'\x00\x00'
                        changed = True
            start = index + len(application_id)

    if changed:
        return bytes(normalized)

    # Insert the standard extension immediately after the logical screen
    # descriptor and global color table, before the first image/extension.
    packed = normalized[10]
    insert_at = 13
    if packed & 0x80:
        table_size = 3 * (2 ** ((packed & 0x07) + 1))
        insert_at += table_size
    if insert_at > len(normalized):
        return data
    return bytes(normalized[:insert_at] + _GIF_LOOP_EXTENSION + normalized[insert_at:])


def avatar_fields(user: Any, *, anonymous: bool = False) -> dict[str, Any]:
    """Return the avatar fields shared by user and rating responses."""
    if anonymous:
        return {'avatar_id': 0, 'avatar_url': None, 'avatar_crop': None}
    return {
        'avatar_id': user.avatar_id,
        'avatar_url': user.avatar_url,
        'avatar_crop': avatar_crop_from_db(user.avatar_crop),
    }
