"""Unified resource-source dispatch for MoreAni."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from models import ContentItem, ResourceSubscription
from services import animegarden, mikan
from services.resource_common import subject_id_for_content

ResourceSource = Literal['mikan', 'animegarden']


class ResourceProviderError(RuntimeError):
    """Raised when a configured resource source cannot be queried."""


@dataclass
class ResourceResult:
    """Normalized result returned by one resource source."""

    resources: list[dict]
    page: int
    page_size: int
    complete: bool
    matched: bool = True
    match_method: str = 'bangumi'
    message: str | None = None


def _source_error(source: ResourceSource, exc: Exception) -> ResourceProviderError:
    """Wrap source-specific errors with a stable service-level exception."""
    if source == 'mikan':
        return ResourceProviderError('Mikan 资源服务暂时不可用')
    return ResourceProviderError('Anime Garden 资源服务暂时不可用')


async def fetch_for_content(
    content: ContentItem,
    *,
    source: ResourceSource,
    page: int,
    page_size: int,
) -> ResourceResult:
    """Fetch resources for a content item through the requested source."""
    subject_id = subject_id_for_content(content)
    if subject_id is None:
        return ResourceResult(
            resources=[],
            page=page,
            page_size=page_size,
            complete=True,
            matched=False,
            match_method='none',
            message='当前番剧未关联 Bangumi，无法精确寻找资源。',
        )

    try:
        if source == 'mikan':
            result = await mikan.fetch_resources(
                subject_id,
                title=content.title,
                title_alt=content.title_alt,
                release_date=content.release_date,
                page=page,
                page_size=page_size,
            )
        else:
            result = await animegarden.fetch_resources(subject_id, page=page, page_size=page_size)
    except (mikan.MikanError, animegarden.AnimeGardenError) as exc:
        raise _source_error(source, exc) from exc

    return ResourceResult(
        resources=result['resources'],
        page=result['page'],
        page_size=result['page_size'],
        complete=result['complete'],
        matched=result.get('matched', True),
        match_method=result.get('match_method', 'bangumi'),
        message=result.get('message'),
    )


async def fetch_for_subscription(
    subscription: ResourceSubscription,
    *,
    content: ContentItem | None = None,
) -> ResourceResult:
    """Fetch recent resources for one source-specific subscription."""
    if subscription.source == 'mikan':
        if content is None:
            raise mikan.MikanError('Mikan 订阅缺少番剧信息')
        result = await mikan.fetch_group_resources(
            subject_id=subscription.subject_id,
            fansub_id=subscription.fansub_id,
            fansub_name=subscription.fansub_name,
            title=content.title,
            title_alt=content.title_alt,
            release_date=content.release_date,
        )
    else:
        result = await animegarden.fetch_resources(
            subscription.subject_id,
            page=1,
            page_size=1000,
            fansub=subscription.fansub_name,
        )
    return ResourceResult(
        resources=result['resources'],
        page=result['page'],
        page_size=result['page_size'],
        complete=result['complete'],
        matched=result.get('matched', True),
        match_method=result.get('match_method', 'bangumi'),
        message=result.get('message'),
    )
