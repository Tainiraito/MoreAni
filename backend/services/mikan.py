"""Mikan Project HTML/RSS resource adapter."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any
from urllib.parse import quote, urljoin, urlparse
from xml.etree import ElementTree

import httpx
from bs4 import BeautifulSoup, Tag

from services.resource_common import normalize_fansub_name, resource_party

logger = logging.getLogger('uvicorn')

MIKAN_BASE_URL = os.getenv('MIKAN_BASE_URL', 'https://mikanani.me').rstrip('/')
MIKAN_FALLBACK_BASE_URL = os.getenv('MIKAN_FALLBACK_BASE_URL', 'https://mikanani.kas.pub').rstrip('/')
MIKAN_TIMEOUT = float(os.getenv('MIKAN_TIMEOUT_SECONDS', '10'))
MIKAN_CACHE_SECONDS = max(30, int(os.getenv('MIKAN_CACHE_SECONDS', '300')))
MIKAN_STALE_CACHE_SECONDS = max(60, int(os.getenv('MIKAN_STALE_CACHE_SECONDS', '600')))
MIKAN_ENABLED = os.getenv('MIKAN_ENABLED', 'true').lower() in {'1', 'true', 'yes', 'on'}
MAX_CANDIDATES = 5
BASE_FAILURE_COOLDOWN_SECONDS = 60.0
_base_failures: dict[str, float] = {}


class MikanError(RuntimeError):
    """Raised when Mikan cannot provide a valid response."""


def _proxy() -> str | None:
    """Return an explicit HTTP(S) proxy without implicitly enabling SOCKS."""
    value = (
        os.getenv('MIKAN_PROXY')
        or os.getenv('HTTPS_PROXY')
        or os.getenv('https_proxy')
        or os.getenv('HTTP_PROXY')
        or os.getenv('http_proxy')
    )
    if value and value.lower().startswith(('http://', 'https://')):
        return value
    return None


def _client() -> httpx.AsyncClient:
    """Create an HTTP client with explicit proxy handling."""
    return httpx.AsyncClient(
        timeout=MIKAN_TIMEOUT,
        proxy=_proxy(),
        trust_env=False,
        follow_redirects=True,
        headers={'User-Agent': 'MoreAni/2.0 resource lookup'},
    )


def _absolute_url(href: str, base_url: str = MIKAN_BASE_URL) -> str:
    """Resolve a relative Mikan URL."""
    return urljoin(f'{base_url}/', href.strip())


def _subject_id_from_url(href: str) -> int | None:
    """Extract a Bangumi subject ID from common Bangumi links."""
    match = re.search(r'(?:subject|subject_id)[=/](\d+)', href, re.IGNORECASE)
    return int(match.group(1)) if match else None


def _mikan_id_from_url(href: str) -> int | None:
    """Extract a Mikan番组 ID from a detail URL."""
    match = re.search(r'/Home/Bangumi/(\d+)', href, re.IGNORECASE)
    return int(match.group(1)) if match else None


def _clean_text(value: str) -> str:
    """Collapse HTML whitespace and entities."""
    return re.sub(r'\s+', ' ', unescape(value or '')).strip()


def _search_candidates(html: str, base_url: str) -> list[dict[str, Any]]:
    """Parse unique Mikan detail links from a search page."""
    soup = BeautifulSoup(html, 'html.parser')
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for anchor in soup.find_all('a', href=True):
        href = _absolute_url(str(anchor.get('href', '')), base_url)
        mikan_id = _mikan_id_from_url(href)
        if mikan_id is None or href in seen:
            continue
        seen.add(href)
        title = _clean_text(anchor.get_text(' ', strip=True))
        if not title:
            parent = anchor.find_parent(['li', 'div', 'article'])
            title = _clean_text(parent.get_text(' ', strip=True)) if parent else ''
        candidates.append({'url': href, 'mikan_id': mikan_id, 'title': title})
        if len(candidates) >= MAX_CANDIDATES:
            break
    return candidates


def _season_candidates(html: str, base_url: str, titles: tuple[str, ...]) -> list[dict[str, Any]]:
    """Parse exact-title Mikan番组 candidates from a seasonal lineup."""
    soup = BeautifulSoup(html, 'html.parser')
    normalized_titles = [_clean_text(title).casefold() for title in titles if _clean_text(title)]
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for anchor in soup.find_all('a', href=True):
        href = _absolute_url(str(anchor.get('href', '')), base_url)
        mikan_id = _mikan_id_from_url(href)
        if mikan_id is None or href in seen:
            continue
        title = _clean_text(anchor.get_text(' ', strip=True))
        normalized = title.casefold()
        if not title or not any(
            normalized == query or normalized in query or query in normalized for query in normalized_titles
        ):
            continue
        seen.add(href)
        candidates.append({'url': href, 'mikan_id': mikan_id, 'title': title})
        if len(candidates) >= MAX_CANDIDATES:
            break
    return candidates


def _parse_date(value: str | None) -> datetime:
    """Parse RSS/HTML dates with a safe UTC fallback."""
    clean = _clean_text(value or '')
    if clean:
        try:
            result = parsedate_to_datetime(clean)
            if result.tzinfo is None:
                return result.replace(tzinfo=UTC)
            return result.astimezone(UTC)
        except (TypeError, ValueError, OverflowError):
            pass
        try:
            result = datetime.fromisoformat(clean.replace('Z', '+00:00'))
            return result.replace(tzinfo=UTC) if result.tzinfo is None else result.astimezone(UTC)
        except ValueError:
            pass
        match = re.search(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})', clean)
        if match:
            return datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)), tzinfo=UTC)
    return datetime.now(UTC)


def _parse_size(value: str | None) -> int:
    """Parse a human-readable size into bytes."""
    match = re.search(r'(?<![\w.])(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)\b', value or '', re.IGNORECASE)
    if not match:
        return 0
    units = {'B': 1, 'KB': 1024, 'MB': 1024**2, 'GB': 1024**3, 'TB': 1024**4}
    return int(float(match.group(1)) * units[match.group(2).upper()])


def _stable_id(*values: str) -> str:
    """Create a deterministic resource identifier when Mikan has no GUID."""
    return hashlib.sha256('|'.join(values).encode('utf-8')).hexdigest()[:32]


def _container_for(anchor: Tag) -> Tag:
    """Find a compact resource row around a download link."""
    current: Tag = anchor
    for _ in range(5):
        parent = current.parent
        if not isinstance(parent, Tag):
            break
        classes = ' '.join(parent.get('class', [])) if isinstance(parent.get('class'), list) else ''
        if any(token in classes.lower() for token in ('episode', 'resource', 'torrent', 'an-res', 'row', 'card')):
            return parent
        current = parent
    return anchor.parent if isinstance(anchor.parent, Tag) else anchor


def _publish_group_id(group_link: Tag | None) -> str | None:
    """Extract the stable Mikan PublishGroup ID from a group link."""
    if group_link is None:
        return None
    match = re.search(r'/Home/PublishGroup/(\d+)', str(group_link.get('href', '')), re.IGNORECASE)
    return match.group(1) if match else None


def _group_for(anchor: Tag) -> tuple[str | None, str | None]:
    """Find the nearest Mikan subtitle-group link for a resource row."""
    current: Tag | None = anchor
    for _ in range(7):
        if current is None:
            break
        subgroup = current.find_parent(class_=re.compile(r'\bsubgroup-text\b'))
        if subgroup:
            group_link = subgroup.find('a', href=re.compile(r'/Home/PublishGroup/\d+', re.IGNORECASE))
            name = _clean_text(group_link.get_text(' ', strip=True)) if group_link else ''
            publish_group_id = _publish_group_id(group_link)
            if publish_group_id:
                return publish_group_id, name or None
            subgroup_id = str(subgroup.get('id') or '').strip()
            if subgroup_id:
                return subgroup_id, name or None
        previous_subgroup = current.find_previous(class_=re.compile(r'\bsubgroup-text\b'))
        if previous_subgroup:
            group_link = previous_subgroup.find('a', href=re.compile(r'/Home/PublishGroup/\d+', re.IGNORECASE))
            name = _clean_text(group_link.get_text(' ', strip=True)) if group_link else ''
            publish_group_id = _publish_group_id(group_link)
            if publish_group_id:
                return publish_group_id, name or None
            subgroup_id = str(previous_subgroup.get('id') or '').strip()
            if subgroup_id:
                return subgroup_id, name or None
        group_link = current.find('a', href=re.compile(r'/Home/PublishGroup/\d+', re.IGNORECASE))
        if group_link:
            return _publish_group_id(group_link), _clean_text(group_link.get_text(' ', strip=True))
        parent = current.parent
        current = parent if isinstance(parent, Tag) else None
    return None, None


def _fallback_group(title: str) -> tuple[str | None, str | None]:
    """Extract a bracketed fansub name when the page omits a group link."""
    match = re.search(r'^\[([^\]]+)\]', title)
    return (None, _clean_text(match.group(1))) if match else (None, None)


def _canonicalize_fansub_groups(
    resources: list[dict[str, Any]], groups: dict[str, dict[str, Any]]
) -> None:
    """Attach title-only resources to a unique stable group ID when possible.

    Mikan occasionally omits the PublishGroup link for an individual resource,
    even though another resource from the same group exposes it.  Only a single
    stable ID is adopted; ambiguous same-name groups remain separate.
    """
    ids_by_name: dict[str, set[str]] = {}
    for group_id, group in groups.items():
        normalized_name = normalize_fansub_name(str(group.get('name') or ''))
        if normalized_name:
            ids_by_name.setdefault(normalized_name, set()).add(str(group_id))

    for resource in resources:
        party = resource.get('fansub')
        if not isinstance(party, dict) or party.get('id') is not None:
            continue
        normalized_name = normalize_fansub_name(str(party.get('name') or ''))
        stable_ids = ids_by_name.get(normalized_name, set())
        if len(stable_ids) == 1:
            party['id'] = next(iter(stable_ids))


def _provider_id_from_magnet(magnet: str) -> str:
    """Extract a stable BTIH identity from a magnet URI."""
    match = re.search(r'xt=urn:btih:([^&]+)', magnet, re.IGNORECASE)
    return match.group(1).lower() if match else _stable_id(magnet)


def _deduplicate_resources(resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove duplicate Mikan rows and generic unknown-size placeholders."""
    unique: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for resource in resources:
        title = _clean_text(str(resource.get('title') or ''))
        compact_title = re.sub(r'\s+', '', title).casefold()
        size = int(resource.get('size') or 0)
        if compact_title == 'mikan资源' and size <= 0:
            continue

        magnet = str(resource.get('magnet') or '').strip()
        provider_id = str(resource.get('provider_id') or '').strip()
        if magnet.lower().startswith('magnet:'):
            identity = f'magnet:{_provider_id_from_magnet(magnet)}'
        elif provider_id:
            identity = f'id:{provider_id}'
        else:
            identity = f'link:{resource.get("href") or ""}|{compact_title}'

        existing = unique.get(identity)
        if existing is None:
            unique[identity] = resource
            order.append(identity)
        elif not int(existing.get('size') or 0) and size:
            unique[identity] = resource
    return [unique[identity] for identity in order]


def _parse_detail(
    html: str, detail_url: str, subject_id: int
) -> tuple[bool, list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Parse a verified detail page into resources and subtitle groups."""
    soup = BeautifulSoup(html, 'html.parser')
    matched = any(
        _subject_id_from_url(str(anchor.get('href', ''))) == subject_id for anchor in soup.find_all('a', href=True)
    )
    if not matched:
        return False, [], {}
    groups: dict[str, dict[str, Any]] = {}
    resources: list[dict[str, Any]] = []
    seen: set[str] = set()

    for magnet_node in soup.select('[data-magnet]'):
        magnet = str(magnet_node.get('data-magnet') or '').strip()
        if not magnet.startswith('magnet:'):
            continue
        row = magnet_node.find_parent('tr') or _container_for(magnet_node)
        title_anchor = row.select_one('a.magnet-link-wrap') if isinstance(row, Tag) else None
        title = _clean_text(title_anchor.get_text(' ', strip=True) if title_anchor else row.get_text(' ', strip=True))
        episode_href = (
            _absolute_url(
                str(title_anchor.get('href', '')), urlparse(detail_url).scheme + '://' + urlparse(detail_url).netloc
            )
            if title_anchor
            else detail_url
        )
        group_id, group_name = _group_for(row)
        if not group_name:
            group_id, group_name = _fallback_group(title)
        if group_id and group_id not in groups:
            groups[group_id] = {'id': group_id, 'name': group_name or f'字幕组 {group_id}'}
        provider_id = _provider_id_from_magnet(magnet)
        if provider_id in seen:
            continue
        seen.add(provider_id)
        cells = row.find_all('td') if isinstance(row, Tag) else []
        row_text = row.get_text(' ', strip=True) if isinstance(row, Tag) else ''
        date_value = cells[3].get_text(' ', strip=True) if len(cells) > 3 else row_text
        resources.append(
            {
                'id': 0,
                'source': 'mikan',
                'provider': 'mikan',
                'provider_id': provider_id,
                'title': title or 'Mikan 资源',
                'href': episode_href,
                'type': '动画',
                'magnet': magnet,
                'size': _parse_size(cells[2].get_text(' ', strip=True) if len(cells) > 2 else row_text),
                'fansub': resource_party(group_name or '', group_id),
                'publisher': None,
                'subject_id': subject_id,
                'created_at': _parse_date(date_value),
                'fetched_at': datetime.now(UTC),
            }
        )

    for anchor in soup.find_all('a', href=True):
        raw_href = str(anchor.get('href', '')).strip()
        if not raw_href.lower().startswith(('magnet:', 'http://', 'https://', '/')):
            continue
        text = _clean_text(anchor.get_text(' ', strip=True))
        if raw_href.lower().startswith('magnet:'):
            download_href = raw_href
        elif any(token in raw_href.lower() for token in ('.torrent', '/download', 'torrent')):
            download_href = _absolute_url(raw_href)
        else:
            continue
        container = _container_for(anchor)
        if container.select_one('[data-magnet]'):
            continue
        title = _clean_text(anchor.get('title') or text or container.get_text(' ', strip=True))
        if not title:
            title = _clean_text(container.get_text(' ', strip=True)) or 'Mikan 资源'
        group_id, group_name = _group_for(container)
        if not group_name:
            group_id, group_name = _fallback_group(title)
        if group_id and group_id not in groups:
            groups[group_id] = {'id': group_id, 'name': group_name or f'字幕组 {group_id}'}
        resource_key = (
            _provider_id_from_magnet(download_href)
            if download_href.lower().startswith('magnet:')
            else _stable_id(detail_url, download_href, title)
        )
        if resource_key in seen:
            continue
        seen.add(resource_key)
        source_href = detail_url
        for sibling in container.find_all('a', href=True):
            sibling_href = str(sibling.get('href', '')).strip()
            if (
                sibling is not anchor
                and sibling_href.startswith(('http://', 'https://'))
                and 'PublishGroup' not in sibling_href
            ):
                source_href = sibling_href
                break
        resources.append(
            {
                'id': 0,
                'source': 'mikan',
                'provider': 'mikan',
                'provider_id': resource_key,
                'title': title,
                'href': source_href,
                'type': '动画',
                'magnet': download_href if download_href.lower().startswith('magnet:') else '',
                'size': _parse_size(container.get_text(' ', strip=True)),
                'fansub': resource_party(group_name or '', group_id),
                'publisher': None,
                'subject_id': subject_id,
                'created_at': _parse_date(container.find('time').get('datetime') if container.find('time') else None),
                'fetched_at': datetime.now(UTC),
            }
        )
    resources = _deduplicate_resources(resources)
    _canonicalize_fansub_groups(resources, groups)
    return matched, resources, groups


def _xml_value(item: ElementTree.Element, name: str) -> str:
    """Read an RSS child value regardless of XML namespace."""
    for child in list(item):
        if child.tag.rsplit('}', 1)[-1].lower() == name.lower():
            return _clean_text(child.text or '')
    return ''


def _parse_rss(xml: str, subject_id: int, fansub_id: str | None, fansub_name: str) -> list[dict[str, Any]]:
    """Parse one Mikan group RSS feed."""
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as exc:
        raise MikanError('Mikan RSS 返回了无效 XML') from exc
    resources: list[dict[str, Any]] = []
    for item in root.iter():
        if item.tag.rsplit('}', 1)[-1].lower() != 'item':
            continue
        title = _xml_value(item, 'title') or 'Mikan 资源'
        href = _xml_value(item, 'link')
        guid = _xml_value(item, 'guid')
        pub_date = _xml_value(item, 'pubDate') or _xml_value(item, 'published')
        magnet = ''
        size = 0
        for child in item.iter():
            tag_name = child.tag.rsplit('}', 1)[-1].lower()
            value = _clean_text(child.text or '')
            if tag_name in {'magneturi', 'magnet', 'magneturl'} and value.startswith('magnet:'):
                magnet = value
            if tag_name in {'contentlength', 'length', 'size'}:
                size = size or _parse_size(value) or (int(value) if value.isdigit() else 0)
            if tag_name == 'enclosure':
                magnet = (
                    magnet or str(child.get('url') or '')
                    if str(child.get('url') or '').startswith('magnet:')
                    else magnet
                )
                size = size or int(child.get('length') or 0)
        provider_id = guid or magnet or href or _stable_id(str(subject_id), fansub_id or '', title, pub_date)
        provider_id = _stable_id(provider_id) if provider_id.startswith('http') else provider_id
        resources.append(
            {
                'id': 0,
                'source': 'mikan',
                'provider': 'mikan',
                'provider_id': provider_id,
                'title': title,
                'href': href,
                'type': '动画',
                'magnet': magnet,
                'size': size,
                'fansub': resource_party(fansub_name, fansub_id),
                'publisher': None,
                'subject_id': subject_id,
                'created_at': _parse_date(pub_date),
                'fetched_at': datetime.now(UTC),
            }
        )
    return _deduplicate_resources(resources)


@dataclass
class _CacheEntry:
    """Store fresh and stale deadlines for one resolved Mikan subject."""

    fresh_until: float
    stale_until: float
    result: dict[str, Any]


_cache: dict[int, _CacheEntry] = {}
_locks: dict[int, asyncio.Lock] = {}
_refresh_tasks: dict[int, asyncio.Task[None]] = {}


async def _get(url: str, client: httpx.AsyncClient | None = None) -> str:
    """Fetch a Mikan page or RSS feed as text."""
    try:
        if client is not None:
            response = await client.get(url)
            response.raise_for_status()
            return response.text
        async with _client() as owned_client:
            response = await owned_client.get(url)
            response.raise_for_status()
            return response.text
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        raise MikanError('Mikan 暂时无法访问') from exc


async def _get_path(path: str, client: httpx.AsyncClient | None = None) -> tuple[str, str]:
    """Fetch a relative path from the primary Mikan host and its mirror."""
    bases = [MIKAN_BASE_URL]
    if MIKAN_FALLBACK_BASE_URL and MIKAN_FALLBACK_BASE_URL not in bases:
        bases.append(MIKAN_FALLBACK_BASE_URL)
    now = asyncio.get_running_loop().time()
    if len(bases) > 1 and _base_failures.get(bases[0], 0) > now:
        bases.reverse()
    last_error: MikanError | None = None
    for base_url in bases:
        try:
            result = await _get(f'{base_url}{path}', client)
            _base_failures.pop(base_url, None)
            return result, base_url
        except MikanError as exc:
            _base_failures[base_url] = asyncio.get_running_loop().time() + BASE_FAILURE_COOLDOWN_SECONDS
            last_error = exc
            logger.warning('Mikan request failed via %s', base_url)
    raise last_error or MikanError('Mikan 暂时无法访问')


def _season_month(release_date: str) -> tuple[str, str] | None:
    """Convert a release date into Mikan's quarterly season parameters."""
    match = re.match(r'^(\d{4})-(\d{1,2})', release_date or '')
    if not match:
        return None
    month = int(match.group(2))
    quarter_month = ((month - 1) // 3) * 3 + 1
    return match.group(1), f'{quarter_month:02d}'


async def _validate_candidates(
    subject_id: int,
    candidates: list[dict[str, Any]],
    client: httpx.AsyncClient,
) -> dict[str, Any] | None:
    """Validate candidate detail pages with at most three active requests."""
    semaphore = asyncio.Semaphore(3)
    first_error: MikanError | None = None

    async def validate(candidate: dict[str, Any]) -> dict[str, Any] | None:
        async with semaphore:
            parsed_url = urlparse(candidate['url'])
            detail_path = parsed_url.path + (f'?{parsed_url.query}' if parsed_url.query else '')
            detail_html, detail_base = await _get_path(detail_path, client)
            detail_url = f'{detail_base}{detail_path}'
            matched, resources, groups = _parse_detail(detail_html, detail_url, subject_id)
            if not matched:
                return None
            return {
                'resources': resources,
                'groups': groups,
                'matched': True,
                'match_method': 'bangumi',
                'mikan_bangumi_id': candidate['mikan_id'],
            }

    tasks = [asyncio.create_task(validate(candidate)) for candidate in candidates[:MAX_CANDIDATES]]
    try:
        for task in asyncio.as_completed(tasks):
            try:
                result = await task
            except MikanError as exc:
                first_error = first_error or exc
                continue
            if result is not None:
                return result
        if first_error and all(task.done() and task.exception() is not None for task in tasks):
            raise first_error
        return None
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def _resolve_and_fetch(subject_id: int, title: str, title_alt: str, release_date: str) -> dict[str, Any]:
    """Resolve a Bangumi subject through fast title discovery and exact validation."""
    started_at = time.perf_counter()
    candidates: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    discovery_error: MikanError | None = None
    queries = tuple(dict.fromkeys(query for query in (title_alt, title) if _clean_text(query)))

    async with _client() as client:
        for query in queries:
            try:
                html, base_url = await _get_path(
                    f'/Home/Search?searchstr={quote(_clean_text(query))}',
                    client,
                )
            except MikanError as exc:
                discovery_error = exc
                logger.warning('Mikan title discovery failed for %s via %s', subject_id, query)
                continue
            new_candidates: list[dict[str, Any]] = []
            for candidate in _search_candidates(html, base_url):
                if candidate['url'] not in seen_urls and len(candidates) < MAX_CANDIDATES:
                    candidates.append(candidate)
                    seen_urls.add(candidate['url'])
                    new_candidates.append(candidate)
            if new_candidates:
                matched = await _validate_candidates(subject_id, new_candidates, client)
                if matched:
                    logger.info('Mikan lookup subject=%s method=title elapsed=%.3fs', subject_id, time.perf_counter() - started_at)
                    return matched

        # 搜索页面通常已经足够，只有两个标题都没有候选时才回退季番接口。
        if not candidates:
            season = _season_month(release_date)
            if season:
                year, month = season
                try:
                    html, base_url = await _get_path(
                        f'/Home/BangumiCoverFlowByDayOfWeek?year={year}&seasonStr={month}',
                        client,
                    )
                    new_candidates = []
                    for candidate in _season_candidates(html, base_url, (title, title_alt)):
                        if candidate['url'] not in seen_urls and len(candidates) < MAX_CANDIDATES:
                            candidates.append(candidate)
                            seen_urls.add(candidate['url'])
                            new_candidates.append(candidate)
                    if new_candidates:
                        matched = await _validate_candidates(subject_id, new_candidates, client)
                        if matched:
                            logger.info('Mikan lookup subject=%s method=season elapsed=%.3fs', subject_id, time.perf_counter() - started_at)
                            return matched
                except MikanError as exc:
                    discovery_error = exc
                    logger.warning('Mikan seasonal discovery failed for %s', subject_id)

    if discovery_error and not candidates:
        raise discovery_error
    logger.info('Mikan lookup subject=%s method=none elapsed=%.3fs', subject_id, time.perf_counter() - started_at)
    return {'resources': [], 'groups': {}, 'matched': False, 'match_method': 'none'}


async def _fetch_fresh(
    subject_id: int,
    *,
    title: str,
    title_alt: str,
    release_date: str,
) -> dict[str, Any]:
    """Refresh one subject while merging concurrent requests through its lock."""
    lock = _locks.setdefault(subject_id, asyncio.Lock())
    async with lock:
        now = asyncio.get_running_loop().time()
        cached = _cache.get(subject_id)
        if cached and cached.fresh_until > now:
            return cached.result
        result = await _resolve_and_fetch(subject_id, title, title_alt, release_date)
        refreshed_at = asyncio.get_running_loop().time()
        _cache[subject_id] = _CacheEntry(
            fresh_until=refreshed_at + MIKAN_CACHE_SECONDS,
            stale_until=refreshed_at + MIKAN_CACHE_SECONDS + MIKAN_STALE_CACHE_SECONDS,
            result=result,
        )
        return result


async def _refresh_in_background(
    subject_id: int,
    *,
    title: str,
    title_alt: str,
    release_date: str,
) -> None:
    """Refresh stale data without allowing upstream failure to affect callers."""
    try:
        await _fetch_fresh(subject_id, title=title, title_alt=title_alt, release_date=release_date)
    except Exception as exc:  # noqa: BLE001
        logger.warning('Mikan stale cache refresh failed for %s: %s', subject_id, type(exc).__name__)
    finally:
        _refresh_tasks.pop(subject_id, None)


async def fetch_resources(
    subject_id: int,
    *,
    title: str,
    title_alt: str = '',
    release_date: str = '',
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    """Find Mikan resources for a Bangumi subject with fresh and stale TTLs."""
    if not MIKAN_ENABLED:
        return {
            'resources': [],
            'page': page,
            'page_size': page_size,
            'complete': True,
            'matched': False,
            'match_method': 'none',
            'message': 'Mikan 资源源已停用',
        }
    page = max(1, page)
    page_size = min(max(1, page_size), 1000)
    now = asyncio.get_running_loop().time()
    cached = _cache.get(subject_id)
    if cached and cached.fresh_until > now:
        logger.debug('Mikan cache hit subject=%s state=fresh', subject_id)
        result = cached.result
    elif cached and cached.stale_until > now:
        logger.debug('Mikan cache hit subject=%s state=stale', subject_id)
        if subject_id not in _refresh_tasks:
            _refresh_tasks[subject_id] = asyncio.create_task(
                _refresh_in_background(
                    subject_id,
                    title=title,
                    title_alt=title_alt,
                    release_date=release_date,
                )
            )
        result = cached.result
    else:
        result = await _fetch_fresh(
            subject_id,
            title=title,
            title_alt=title_alt,
            release_date=release_date,
        )
    resources = result['resources']
    start = (page - 1) * page_size
    end = start + page_size
    return {
        'resources': resources[start:end],
        'page': page,
        'page_size': page_size,
        'complete': end >= len(resources),
        'matched': result['matched'],
        'match_method': result.get('match_method', 'none'),
        'mikan_bangumi_id': result.get('mikan_bangumi_id'),
        'message': None if result['matched'] else 'Mikan 未找到与当前 Bangumi 条目精确关联的番组。',
    }


async def fetch_group_resources(
    *,
    subject_id: int,
    fansub_id: str | None,
    fansub_name: str,
    title: str,
    title_alt: str = '',
    release_date: str = '',
) -> dict[str, Any]:
    """Fetch recent resources from a Mikan subtitle-group RSS feed."""
    if not fansub_id:
        raise MikanError('Mikan 字幕组缺少稳定 ID，无法订阅')
    resolved = await fetch_resources(
        subject_id,
        title=title,
        title_alt=title_alt,
        release_date=release_date,
        page=1,
        page_size=1000,
    )
    mikan_bangumi_id = resolved.get('mikan_bangumi_id')
    if not mikan_bangumi_id:
        raise MikanError('Mikan 未找到可校验的番组详情')
    try:
        xml, _base_url = await _get_path(
            f'/RSS/Bangumi?bangumiId={mikan_bangumi_id}&subgroupid={quote(str(fansub_id))}'
        )
        resources = _parse_rss(xml, subject_id, str(fansub_id), fansub_name)
    except MikanError:
        resources = []
    if not resources:
        resources = [
            resource
            for resource in resolved['resources']
            if str((resource.get('fansub') or {}).get('id') or '') == str(fansub_id)
        ]
    return {'resources': resources, 'page': 1, 'page_size': 1000, 'complete': True, 'matched': True}
