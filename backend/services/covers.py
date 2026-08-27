"""封面资产缓存、压缩和外链降级服务。

Bangumi 封面使用 subject_id 作为唯一缓存键，后台同步时预热为 WebP；
旧的 ``/api/covers/{content_id}.jpg`` 文件仍然保留兼容，不会被本服务主动删除。
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import tempfile
from collections import defaultdict
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

import httpx
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from models import AiringCalendarItem, ContentItem, CoverAsset

logger = logging.getLogger('uvicorn')

DEFAULT_MAX_BYTES = 8 * 1024 * 1024
MAX_WIDTH = 480
MAX_HEIGHT = 720
WEBP_QUALITY = 82
ALLOWED_IMAGE_FORMATS = {'JPEG', 'PNG', 'WEBP', 'GIF'}
ALLOWED_IMAGE_DOMAINS = ('lain.bgm.tv', 'bgm.tv', 'bangumi.tv')
HEADERS = {'User-Agent': 'MoreAni/2.0 (https://moreani.lovelysia.top)'}


def _configured_proxy() -> str | None:
    """Return the explicit cover proxy without consulting ALL_PROXY."""
    for name in (
        'MOREANI_COVER_PROXY',
        'MOREANI_HTTPS_PROXY',
        'MOREANI_HTTP_PROXY',
        'HTTPS_PROXY',
        'https_proxy',
        'HTTP_PROXY',
        'http_proxy',
    ):
        value = os.environ.get(name, '').strip()
        if value.lower().startswith(('http://', 'https://')):
            return value
    return None


PROXY = _configured_proxy()
REQUEST_ORDER = os.environ.get('MOREANI_COVER_REQUEST_ORDER', 'proxy_first').strip().lower()
if REQUEST_ORDER not in {'proxy_first', 'direct_first'}:
    REQUEST_ORDER = 'proxy_first'
SUBJECT_LOCKS: defaultdict[int, asyncio.Lock] = defaultdict(asyncio.Lock)


class CoverDownloadError(RuntimeError):
    """Raised when an external cover cannot be downloaded or decoded."""


@dataclass(frozen=True)
class EncodedCover:
    """Validated and compressed WebP bytes."""

    data: bytes
    content_hash: str
    mime_type: str


def _utcnow_naive() -> datetime:
    """Return a naive UTC timestamp for SQLite DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


def _env_int(name: str, default: int) -> int:
    """Read a positive integer configuration value."""
    try:
        return max(1, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def get_covers_dir() -> Path:
    """Return the configured cover directory as an absolute path."""
    return Path(os.getenv('COVERS_DIR', 'covers')).resolve()


def source_version(source_url: str) -> str:
    """Create a short stable version for a source URL."""
    return hashlib.sha256(source_url.encode('utf-8')).hexdigest()[:12]


def _subject_id(value: object) -> int | None:
    try:
        subject_id = int(value)
    except (TypeError, ValueError):
        return None
    return subject_id if subject_id > 0 else None


def _is_allowed_url(url: str) -> bool:
    """Validate scheme and hostname before every external request/redirect."""
    parsed = urlparse(url)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname:
        return False
    hostname = parsed.hostname.lower().rstrip('.')
    return any(hostname == domain or hostname.endswith(f'.{domain}') for domain in ALLOWED_IMAGE_DOMAINS)


def _safe_local_path(relative_path: str | None) -> Path | None:
    """Resolve an asset path while preventing traversal outside COVERS_DIR."""
    if not relative_path:
        return None
    base = get_covers_dir()
    try:
        candidate = (base / relative_path).resolve()
        candidate.relative_to(base)
    except (OSError, ValueError):
        return None
    return candidate


def _relative_path(path: Path) -> str:
    """Convert an absolute cover path to the database's POSIX relative path."""
    return path.resolve().relative_to(get_covers_dir()).as_posix()


def _local_url(relative_path: str, version: str = '') -> str:
    """Build a public local cover URL, adding a version for immutable caching."""
    from urllib.parse import quote

    url = f'/api/covers/{quote(relative_path, safe="/")}'
    return f'{url}?v={version}' if version else url


def _is_valid_image_file(path: Path) -> bool:
    """Verify the actual image container, not only the file extension."""
    try:
        with Image.open(path) as image:
            if image.format not in ALLOWED_IMAGE_FORMATS:
                return False
            image.verify()
        return True
    except (UnidentifiedImageError, OSError, ValueError):
        return False


def public_asset_url(asset: CoverAsset) -> str | None:
    """Return a cacheable URL only when the asset is ready and the file exists."""
    if asset.status != 'ready' or not asset.local_path or not asset.source_version:
        return None
    path = _safe_local_path(asset.local_path)
    if path is None or not path.is_file():
        return None
    try:
        if path.stat().st_size > _env_int('MOREANI_AIRING_COVER_MAX_BYTES', DEFAULT_MAX_BYTES):
            return None
    except OSError:
        return None
    if not _is_valid_image_file(path):
        return None
    return _local_url(asset.local_path, asset.source_version)


def _validate_content_type(content_type: str | None) -> None:
    """Reject clearly non-image responses before handing bytes to Pillow."""
    normalized = (content_type or '').split(';', 1)[0].strip().lower()
    if normalized and not normalized.startswith('image/') and normalized != 'application/octet-stream':
        raise CoverDownloadError('外链响应不是图片')


def _encode_image(data: bytes, content_type: str | None = None) -> EncodedCover:
    """Validate image bytes and compress them to a metadata-free WebP."""
    max_bytes = _env_int('MOREANI_AIRING_COVER_MAX_BYTES', DEFAULT_MAX_BYTES)
    if len(data) > max_bytes:
        raise CoverDownloadError('原图超过大小限制')
    _validate_content_type(content_type)
    try:
        with Image.open(BytesIO(data)) as image:
            if image.format not in ALLOWED_IMAGE_FORMATS:
                raise CoverDownloadError('图片格式不受支持')
            if image.width * image.height > 40_000_000:
                raise CoverDownloadError('图片尺寸过大')
            image.load()
            image.thumbnail((MAX_WIDTH, MAX_HEIGHT), Image.Resampling.LANCZOS)
            converted = image.convert('RGBA' if image.mode in {'RGBA', 'LA', 'P'} else 'RGB')
            output = BytesIO()
            converted.save(output, format='WEBP', quality=WEBP_QUALITY, method=6)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise CoverDownloadError('图片解码失败') from exc

    encoded = output.getvalue()
    return EncodedCover(
        data=encoded,
        content_hash=hashlib.sha256(encoded).hexdigest(),
        mime_type='image/webp',
    )


def _read_and_encode(path: Path) -> EncodedCover:
    """Read and validate an existing local image for legacy migration."""
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise CoverDownloadError('本地封面不存在') from exc
    if size > _env_int('MOREANI_AIRING_COVER_MAX_BYTES', DEFAULT_MAX_BYTES):
        raise CoverDownloadError('本地原图超过大小限制')
    return _encode_image(path.read_bytes(), None)


def _atomic_write(path: Path, data: bytes) -> None:
    """Write a file beside its destination and atomically replace it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.cover-', suffix='.tmp', delete=False) as temporary:
            temporary_path = temporary.name
            temporary.write(data)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path:
            with suppress(OSError):
                os.unlink(temporary_path)


def _asset_path(subject_id: int) -> Path:
    """Return the canonical Bangumi subject WebP path."""
    return get_covers_dir() / 'bangumi' / f'{subject_id}.webp'


def _request_proxies() -> list[str | None]:
    """Return cover download routes in the configured order."""
    if not PROXY:
        return [None]
    if REQUEST_ORDER == 'direct_first':
        return [None, PROXY]
    return [PROXY, None]


def _download_sync_bytes(url: str) -> tuple[bytes, str | None]:
    """Download one cover synchronously with proxy-first fallback."""
    if not _is_allowed_url(url):
        raise CoverDownloadError('封面域名不在允许列表')
    timeout = httpx.Timeout(15.0, connect=5.0, pool=5.0)
    last_error: Exception | None = None
    for proxy in _request_proxies():
        try:
            with httpx.Client(timeout=timeout, proxy=proxy, follow_redirects=False, trust_env=False) as client:
                fetch_url = url
                for _ in range(4):
                    if not _is_allowed_url(fetch_url):
                        raise CoverDownloadError('重定向后的封面域名不在允许列表')
                    with client.stream('GET', fetch_url, headers=HEADERS) as response:
                        if response.status_code in {301, 302, 303, 307, 308}:
                            location = response.headers.get('location')
                            if not location:
                                raise CoverDownloadError('封面重定向缺少目标')
                            fetch_url = urljoin(fetch_url, location)
                            continue
                        if response.status_code != 200:
                            raise CoverDownloadError(f'封面上游返回 HTTP {response.status_code}')
                        _validate_content_type(response.headers.get('content-type'))
                        try:
                            content_length = int(response.headers.get('content-length', '0') or 0)
                        except ValueError:
                            content_length = 0
                        max_bytes = _env_int('MOREANI_AIRING_COVER_MAX_BYTES', DEFAULT_MAX_BYTES)
                        if content_length > max_bytes:
                            raise CoverDownloadError('原图超过大小限制')
                        chunks: list[bytes] = []
                        total = 0
                        for chunk in response.iter_bytes():
                            total += len(chunk)
                            if total > max_bytes:
                                raise CoverDownloadError('原图超过大小限制')
                            chunks.append(chunk)
                        return b''.join(chunks), response.headers.get('content-type')
                raise CoverDownloadError('封面重定向次数过多')
        except (httpx.HTTPError, httpx.TimeoutException, CoverDownloadError) as exc:
            last_error = exc
            logger.debug('cover download failed via %s: %s', proxy or 'direct', exc)
    raise CoverDownloadError('封面下载失败') from last_error


async def _download_async_bytes(client: httpx.AsyncClient, url: str) -> tuple[bytes, str | None]:
    """Download one cover through a shared asynchronous client."""
    if not _is_allowed_url(url):
        raise CoverDownloadError('封面域名不在允许列表')
    fetch_url = url
    max_bytes = _env_int('MOREANI_AIRING_COVER_MAX_BYTES', DEFAULT_MAX_BYTES)
    for _ in range(4):
        if not _is_allowed_url(fetch_url):
            raise CoverDownloadError('重定向后的封面域名不在允许列表')
        async with client.stream('GET', fetch_url, headers=HEADERS) as response:
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get('location')
                if not location:
                    raise CoverDownloadError('封面重定向缺少目标')
                fetch_url = urljoin(fetch_url, location)
                continue
            if response.status_code != 200:
                raise CoverDownloadError(f'封面上游返回 HTTP {response.status_code}')
            _validate_content_type(response.headers.get('content-type'))
            try:
                content_length = int(response.headers.get('content-length', '0') or 0)
            except ValueError:
                content_length = 0
            if content_length > max_bytes:
                raise CoverDownloadError('原图超过大小限制')
            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise CoverDownloadError('原图超过大小限制')
                chunks.append(chunk)
            return b''.join(chunks), response.headers.get('content-type')
    raise CoverDownloadError('封面重定向次数过多')


def _asset_is_valid(asset: CoverAsset | None) -> bool:
    """Check the database record and actual local file together."""
    if asset is None or asset.status != 'ready' or not asset.local_path:
        return False
    path = _safe_local_path(asset.local_path)
    if path is None or not path.is_file():
        return False
    try:
        if path.stat().st_size > _env_int('MOREANI_AIRING_COVER_MAX_BYTES', DEFAULT_MAX_BYTES):
            return False
    except OSError:
        return False
    return _is_valid_image_file(path)


def _get_asset(db: Session, subject_id: int) -> CoverAsset | None:
    return (
        db.query(CoverAsset)
        .filter(CoverAsset.source_type == 'bangumi', CoverAsset.source_id == str(subject_id))
        .first()
    )


def _ensure_asset(db: Session, subject_id: int) -> CoverAsset:
    asset = _get_asset(db, subject_id)
    if asset is None:
        asset = CoverAsset(source_type='bangumi', source_id=str(subject_id), status='failed')
        db.add(asset)
        db.flush()
    return asset


def _mark_success(asset: CoverAsset, source_url: str, subject_id: int, encoded: EncodedCover, now: datetime) -> None:
    """Update an asset after an atomic file write succeeded."""
    path = _asset_path(subject_id)
    asset.source_url = source_url
    asset.local_path = _relative_path(path)
    asset.source_version = source_version(source_url) if source_url else ''
    asset.content_hash = encoded.content_hash
    asset.mime_type = encoded.mime_type
    asset.byte_size = len(encoded.data)
    asset.status = 'ready'
    asset.last_attempt_at = now
    asset.last_success_at = now
    asset.last_seen_at = now
    asset.updated_at = now


def _mark_failure(asset: CoverAsset, source_url: str, now: datetime) -> None:
    """Record a bounded failure while retaining the external fallback URL."""
    asset.source_url = source_url
    asset.source_version = source_version(source_url)
    asset.status = 'failed'
    asset.failure_count = (asset.failure_count or 0) + 1
    asset.last_attempt_at = now
    asset.updated_at = now


def _legacy_cover_path(cover_url: str | None) -> Path | None:
    """Resolve an old /api/covers URL to a safe local file."""
    if not cover_url or not cover_url.startswith('/api/covers/'):
        return None
    relative = unquote(urlparse(cover_url).path.removeprefix('/api/covers/'))
    return _safe_local_path(relative)


def is_local_cover_available(cover_url: str | None) -> bool:
    """Check whether a legacy or canonical local cover URL still has a file."""
    path = _legacy_cover_path(cover_url)
    return path is not None and path.is_file()


def _reuse_legacy_cover(db: Session, asset: CoverAsset, subject_id: int, cover_url: str | None, now: datetime) -> bool:
    """Convert an existing content-id cover to the canonical subject WebP."""
    old_path = _legacy_cover_path(cover_url)
    if old_path is None or not old_path.is_file():
        return False
    try:
        encoded = _read_and_encode(old_path)
        target = _asset_path(subject_id)
        _atomic_write(target, encoded.data)
    except (CoverDownloadError, OSError) as exc:
        logger.warning('legacy cover migration failed subject=%d: %s', subject_id, exc)
        return False
    _mark_success(asset, '', subject_id, encoded, now)
    db.add(asset)
    return True


def localize_cover(item: ContentItem, cover_url: str | None, db: Session | None = None) -> str | None:
    """保存内容封面；Bangumi 内容共用 subject 资产，其余内容保持旧路径兼容。"""
    if not cover_url or cover_url.startswith('/api/covers/'):
        return cover_url
    subject_id = _subject_id(item.source_id) if item.source_type == 'bangumi' else None
    if db is not None and subject_id is not None:
        asset = _ensure_asset(db, subject_id)
        now = _utcnow_naive()
        if asset.source_url == cover_url and _asset_is_valid(asset):
            asset.last_seen_at = now
            item.cover_url = public_asset_url(asset) or cover_url
            return item.cover_url
        if not asset.source_url and _asset_is_valid(asset):
            asset.source_url = cover_url
            asset.source_version = source_version(cover_url)
            asset.last_seen_at = now
            asset.updated_at = now
            item.cover_url = public_asset_url(asset) or cover_url
            return item.cover_url
        if _reuse_legacy_cover(db, asset, subject_id, item.cover_url, now):
            asset.source_url = cover_url
            asset.source_version = source_version(cover_url)
            item.cover_url = public_asset_url(asset) or cover_url
            return item.cover_url
        asset.last_attempt_at = now
        try:
            data, content_type = _download_sync_bytes(cover_url)
            encoded = _encode_image(data, content_type)
            _atomic_write(_asset_path(subject_id), encoded.data)
            _mark_success(asset, cover_url, subject_id, encoded, now)
            item.cover_url = public_asset_url(asset) or cover_url
            return item.cover_url
        except (CoverDownloadError, OSError) as exc:
            _mark_failure(asset, cover_url, now)
            logger.warning('Bangumi cover localization failed subject=%d: %s', subject_id, exc)
            return cover_url

    # 手动内容继续使用旧 content_id 文件名，避免破坏现有引用。
    try:
        if not _is_allowed_url(cover_url):
            return cover_url
        data, _content_type = _download_sync_bytes(cover_url)
        ext = '.jpg'
        match = re.search(r'\.(jpe?g|png|webp|gif)(?:\?|$)', cover_url.lower())
        if match:
            ext = '.jpg' if match.group(1) in {'jpg', 'jpeg'} else f'.{match.group(1)}'
        path = get_covers_dir() / f'{item.id}{ext}'
        _atomic_write(path, data)
        item.cover_url = f'/api/covers/{item.id}{ext}'
        return item.cover_url
    except (CoverDownloadError, OSError):
        return cover_url


def localize_cover_in_background(
    content_id: int,
    cover_url: str | None,
    expected_source_type: str,
    expected_source_id: str,
) -> None:
    """在独立数据库会话中本地化封面，避免阻塞内容保存请求。"""
    if not cover_url or cover_url.startswith('/api/covers/'):
        return

    from database import SessionLocal

    db = SessionLocal()
    try:
        item = db.query(ContentItem).filter(ContentItem.id == content_id, ContentItem.deleted_at.is_(None)).first()
        if item is None:
            return
        if (
            item.cover_url != cover_url
            or (item.source_type or '') != expected_source_type
            or (item.source_id or '') != expected_source_id
        ):
            logger.info('cover localization skipped stale content=%d', content_id)
            return

        localize_cover(item, cover_url, db)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning('cover localization task failed content=%d: %s', content_id, type(exc).__name__)
    finally:
        db.close()


def get_asset_url_map(db: Session, subject_ids: set[int]) -> dict[int, str]:
    """批量读取当前可用的 Bangumi 资产，避免周历卡片 N+1 查询。"""
    if not subject_ids:
        return {}
    assets = (
        db.query(CoverAsset)
        .filter(
            CoverAsset.source_type == 'bangumi',
            CoverAsset.source_id.in_([str(subject_id) for subject_id in subject_ids]),
            CoverAsset.status == 'ready',
        )
        .all()
    )
    result: dict[int, str] = {}
    for asset in assets:
        subject_id = _subject_id(asset.source_id)
        url = public_asset_url(asset)
        if subject_id is not None and url:
            result[subject_id] = url
    return result


def get_content_cover_url_map(db: Session, items: list[ContentItem]) -> dict[int, str]:
    """Resolve content response covers with one asset query and local fallback."""
    subject_ids = {
        subject_id
        for item in items
        if item.source_type == 'bangumi'
        for subject_id in [_subject_id(item.source_id)]
        if subject_id is not None
    }
    asset_urls = get_asset_url_map(db, subject_ids)
    result: dict[int, str] = {}
    for item in items:
        subject_id = _subject_id(item.source_id) if item.source_type == 'bangumi' else None
        if subject_id is not None and subject_id in asset_urls:
            result[item.id] = asset_urls[subject_id]
        elif item.cover_url:
            result[item.id] = item.cover_url
    return result


async def prefetch_airing_covers(db: Session, records: list[dict[str, object]]) -> dict[str, int]:
    """预热当前周去重后的 Bangumi 封面，并限制后台并发为配置值。"""
    unique: dict[int, str] = {}
    for record in records:
        subject_id = _subject_id(record.get('subject_id'))
        cover_url = str(record.get('cover_url') or '').strip()
        if subject_id is not None and cover_url and subject_id not in unique:
            unique[subject_id] = cover_url
    stats = {'total': len(unique), 'skipped': 0, 'downloaded': 0, 'failed': 0}
    if not unique:
        return stats

    content_rows = (
        db.query(ContentItem)
        .filter(
            ContentItem.source_type == 'bangumi',
            ContentItem.source_id.in_([str(subject_id) for subject_id in unique]),
            ContentItem.deleted_at.is_(None),
        )
        .all()
    )
    content_by_subject: dict[int, ContentItem] = {}
    for item in content_rows:
        subject_id = _subject_id(item.source_id)
        if subject_id is not None:
            content_by_subject.setdefault(subject_id, item)

    semaphore = asyncio.Semaphore(_env_int('MOREANI_AIRING_COVER_CONCURRENCY', 4))
    timeout = httpx.Timeout(15.0, connect=5.0, pool=5.0)
    clients = [
        httpx.AsyncClient(timeout=timeout, follow_redirects=False, proxy=proxy, trust_env=False)
        for proxy in _request_proxies()
    ]

    async def download(subject_id: int, source_url: str) -> tuple[int, str, EncodedCover | None, str | None]:
        async with semaphore, SUBJECT_LOCKS[subject_id]:
            asset = _ensure_asset(db, subject_id)
            now = _utcnow_naive()
            if asset.source_url == source_url and _asset_is_valid(asset):
                asset.last_seen_at = now
                return subject_id, 'skipped', None, None
            if not asset.source_url and _asset_is_valid(asset):
                asset.source_url = source_url
                asset.source_version = source_version(source_url)
                asset.last_seen_at = now
                asset.updated_at = now
                return subject_id, 'skipped', None, None

            content = content_by_subject.get(subject_id)
            if content and _reuse_legacy_cover(db, asset, subject_id, content.cover_url, now):
                asset.source_url = source_url
                asset.source_version = source_version(source_url)
                return subject_id, 'reused', None, None

            last_error: Exception | None = None
            for client in clients:
                try:
                    data, content_type = await _download_async_bytes(client, source_url)
                    return subject_id, 'downloaded', _encode_image(data, content_type), source_url
                except (httpx.HTTPError, httpx.TimeoutException, CoverDownloadError) as exc:
                    last_error = exc
            return subject_id, 'failed', None, str(last_error or '封面下载失败')

    try:
        results = await asyncio.gather(*(download(subject_id, url) for subject_id, url in unique.items()))
    finally:
        await asyncio.gather(*(client.aclose() for client in clients))

    for subject_id, outcome, encoded, error in results:
        asset = _ensure_asset(db, subject_id)
        source_url = unique[subject_id]
        now = _utcnow_naive()
        if outcome == 'skipped':
            stats['skipped'] += 1
            continue
        if outcome == 'reused':
            stats['downloaded'] += 1
            continue
        if outcome == 'failed' or encoded is None:
            _mark_failure(asset, source_url, now)
            stats['failed'] += 1
            logger.warning('airing cover prefetch failed subject=%d: %s', subject_id, error or 'unknown')
            continue
        try:
            _atomic_write(_asset_path(subject_id), encoded.data)
            _mark_success(asset, source_url, subject_id, encoded, now)
            stats['downloaded'] += 1
        except OSError as exc:
            _mark_failure(asset, source_url, now)
            stats['failed'] += 1
            logger.warning('airing cover write failed subject=%d: %s', subject_id, exc)
    db.commit()
    logger.info(
        'airing cover prefetch finished: total=%d skipped=%d downloaded=%d failed=%d',
        stats['total'],
        stats['skipped'],
        stats['downloaded'],
        stats['failed'],
    )
    return stats


def register_legacy_local_covers(db: Session) -> int:
    """登记已有 Bangumi 内容封面，转换到 subject 文件但不访问外部 CDN。"""
    items = (
        db.query(ContentItem)
        .filter(
            ContentItem.source_type == 'bangumi',
            ContentItem.source_id.isnot(None),
            ContentItem.source_id != '',
            ContentItem.cover_url.like('/api/covers/%'),
        )
        .all()
    )
    migrated = 0
    for item in items:
        subject_id = _subject_id(item.source_id)
        if subject_id is None:
            continue
        asset = _ensure_asset(db, subject_id)
        if _asset_is_valid(asset):
            if not asset.source_version:
                legacy_source = f'legacy://bangumi/{subject_id}'
                asset.source_url = legacy_source
                asset.source_version = source_version(legacy_source)
                asset.last_seen_at = _utcnow_naive()
                migrated += 1
            continue
        if _reuse_legacy_cover(db, asset, subject_id, item.cover_url, _utcnow_naive()):
            # 老字段只保存了本地路径，无法恢复历史原始图片 URL；使用稳定的
            # legacy 标记先让 API 复用本地文件，下一次周历预热会替换为真实 URL。
            legacy_source = f'legacy://bangumi/{subject_id}'
            asset.source_url = legacy_source
            asset.source_version = source_version(legacy_source)
            migrated += 1
    if migrated:
        db.commit()
    return migrated


def cleanup_orphan_cover_assets(
    db: Session,
    dry_run: bool = False,
    retention_days: int | None = None,
) -> dict[str, int]:
    """清理未被周历或内容引用且超过保留期的资产；支持 dry-run。"""
    retention = retention_days or _env_int('MOREANI_COVER_ORPHAN_RETENTION_DAYS', 365)
    cutoff = _utcnow_naive().timestamp() - retention * 86400
    active_subjects = {
        str(row.subject_id) for row in db.query(AiringCalendarItem).filter(AiringCalendarItem.active.is_(True)).all()
    }
    referenced_subjects = {
        str(row.source_id)
        for row in db.query(ContentItem)
        .filter(ContentItem.source_type == 'bangumi', ContentItem.source_id.isnot(None))
        .all()
    }
    candidates = db.query(CoverAsset).filter(CoverAsset.source_type == 'bangumi').all()
    removed = 0
    bytes_removed = 0
    for asset in candidates:
        if asset.source_id in active_subjects or asset.source_id in referenced_subjects:
            continue
        marker = asset.last_seen_at or asset.updated_at or asset.created_at
        if marker is None or marker.timestamp() > cutoff:
            continue
        if asset.status == 'failed' and asset.last_attempt_at and asset.last_attempt_at.timestamp() > cutoff:
            continue
        path = _safe_local_path(asset.local_path)
        size = path.stat().st_size if path and path.is_file() else 0
        removed += 1
        bytes_removed += size
        if dry_run:
            continue
        try:
            if path and path.is_file():
                path.unlink()
            db.delete(asset)
        except OSError as exc:
            logger.warning('cover cleanup failed subject=%s: %s', asset.source_id, exc)
    if not dry_run:
        db.commit()
    result = {'count': removed, 'bytes': bytes_removed}
    logger.info('cover cleanup dry_run=%s count=%d bytes=%d', dry_run, removed, bytes_removed)
    return result
