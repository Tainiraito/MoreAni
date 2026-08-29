"""站内评分、标签画像与可解释推荐服务。"""

import os
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from math import log, sqrt
from threading import Lock
from time import monotonic
from typing import Literal
from weakref import WeakKeyDictionary

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, selectinload

from models import ContentItem, Rating, Tag, User
from schemas import (
    AnalyticsFavoriteItem,
    AnalyticsOverviewResponse,
    AnalyticsRecommendationItem,
    AnalyticsRecommendationsResponse,
    AnalyticsScopeResponse,
    AnalyticsScoreBucket,
    AnalyticsTagStat,
    AnalyticsUserSummary,
)
from services.avatar import avatar_crop_from_db

type AnalyticsScope = Literal['global', 'user']
type RecommendationBasis = Literal['global', 'global_fallback', 'blended', 'personal']
type Confidence = Literal['low', 'medium', 'high']

ANIME_CONTENT_TYPES = ('anime', 'anime_movie')
TAG_ALIASES = {
    '漫改': '漫画改',
    '轻改': '轻小说改',
}
LOW_INFORMATION_TAGS = {
    'TV',
    '动画',
    '日本',
    '日本动画',
}
MAX_TAGS = 50
NEUTRAL_SCORE = 6.0
BAYESIAN_PRIOR_STRENGTH = 3
UBIQUITOUS_TAG_RATIO = 0.8
MIN_RECOMMENDATION_TAG_DOCUMENTS = 2
ANALYTICS_CACHE_SECONDS = max(1.0, float(os.getenv('MOREANI_ANALYTICS_CACHE_SECONDS', '15')))


@dataclass
class _TagAggregate:
    """一个规范化标签在评分样本中的内部聚合。"""

    rating_count: int = 0
    score_total: int = 0
    content_ids: set[int] = field(default_factory=set)


@dataclass(frozen=True)
class _ContentQuality:
    """番剧的全站口碑统计。"""

    average_score: float | None
    rating_count: int
    bayesian_score: float


@dataclass(frozen=True)
class _ContentRecord:
    """脱离 ORM 会话的番剧分析快照。"""

    id: int
    title: str
    title_alt: str
    cover_url: str
    content_type: str
    tags: frozenset[str]


@dataclass(frozen=True)
class _RatingSample:
    """脱离 ORM 会话的有效评分样本。"""

    user_id: int
    content_id: int
    score: int


@dataclass(frozen=True)
class _AnalyticsDataset:
    """一次数据库读取后供概览与推荐共享的不可变分析数据。"""

    contents: tuple[_ContentRecord, ...]
    contents_by_id: dict[int, _ContentRecord]
    ratings: tuple[_RatingSample, ...]
    ratings_by_user: dict[int, tuple[_RatingSample, ...]]
    document_frequency: dict[str, int]
    blocked_tags: frozenset[str]
    eligible_tags: frozenset[str]
    global_quality: dict[int, _ContentQuality]
    global_mean: float
    global_positive: dict[str, float]
    global_negative: dict[str, float]


@dataclass(frozen=True)
class _DatasetCacheEntry:
    """按数据库引擎隔离的短时分析快照缓存。"""

    expires_at: float
    dataset: _AnalyticsDataset


_DATASET_CACHE: WeakKeyDictionary[Engine, _DatasetCacheEntry] = WeakKeyDictionary()
_DATASET_CACHE_LOCK = Lock()


def invalidate_analytics_cache(bind: Engine | None = None) -> None:
    """在番剧、标签或评分变更后立即丢弃相关分析快照。"""
    with _DATASET_CACHE_LOCK:
        if bind is None:
            _DATASET_CACHE.clear()
        else:
            _DATASET_CACHE.pop(bind, None)


@event.listens_for(Session, 'after_flush')
def _invalidate_cache_after_analytics_write(session: Session, _flush_context: object) -> None:
    """监听分析源数据写入，避免短时缓存返回旧画像。"""
    changed_objects = session.new | session.dirty | session.deleted
    if any(isinstance(item, (ContentItem, Rating, Tag)) for item in changed_objects):
        bind = session.get_bind()
        invalidate_analytics_cache(bind if isinstance(bind, Engine) else None)


def get_overview(
    db: Session,
    *,
    scope: AnalyticsScope,
    target_user: User | None,
    min_score: int,
    max_score: int,
    required_tags: list[str] | None = None,
) -> AnalyticsOverviewResponse:
    """返回完整评分分布、区间标签画像和代表番剧。"""
    dataset = _get_dataset(db)
    scope_ratings = (
        dataset.ratings if scope == 'global' else dataset.ratings_by_user.get(target_user.id if target_user else -1, ())
    )
    filtered_ratings = [rating for rating in scope_ratings if min_score <= rating.score <= max_score]
    normalized_required_tags = _normalize_tag_names(required_tags or [])
    favorite_ratings = [
        rating
        for rating in filtered_ratings
        if normalized_required_tags.issubset(dataset.contents_by_id[rating.content_id].tags)
    ]
    frequency_tags, weighted_tags = _build_tag_clouds(
        filtered_ratings,
        dataset.contents_by_id,
        dataset.blocked_tags,
    )

    return AnalyticsOverviewResponse(
        scope=_scope_response(scope, target_user),
        min_score=min_score / 10,
        max_score=max_score / 10,
        rating_count=len(filtered_ratings),
        title_count=len({rating.content_id for rating in filtered_ratings}),
        user_count=len({rating.user_id for rating in filtered_ratings}),
        average_score=(
            round(sum(rating.score for rating in filtered_ratings) / len(filtered_ratings) / 10, 2)
            if filtered_ratings
            else None
        ),
        score_distribution=_score_distribution(scope_ratings),
        frequency_tags=frequency_tags,
        weighted_tags=weighted_tags,
        favorites=_favorite_items(
            favorite_ratings,
            scope=scope,
            contents_by_id=dataset.contents_by_id,
            global_quality=dataset.global_quality,
            global_mean=dataset.global_mean,
        ),
    )


def get_recommendations(
    db: Session,
    *,
    scope: AnalyticsScope,
    target_user: User | None,
    current_user_id: int,
    limit: int,
    required_tags: list[str] | None = None,
) -> AnalyticsRecommendationsResponse:
    """按标签画像返回未评分站内番剧，并解释匹配度来源。"""
    dataset = _get_dataset(db)
    normalized_required_tags = _normalize_tag_names(required_tags or [])

    if scope == 'global':
        profile_ratings = dataset.ratings
        positive_profile = dataset.global_positive
        negative_profile = dataset.global_negative
        exclusion_user_id = current_user_id
        basis: RecommendationBasis = 'global'
    else:
        if target_user is None:
            raise ValueError('user scope requires target_user')
        profile_ratings = dataset.ratings_by_user.get(target_user.id, ())
        personal_positive, personal_negative = _build_preference_vectors(
            profile_ratings,
            contents_by_id=dataset.contents_by_id,
            eligible_tags=dataset.eligible_tags,
            document_frequency=dataset.document_frequency,
            document_count=len(dataset.contents),
        )
        personal_ratio = min(len(profile_ratings) / 20, 1.0)
        positive_profile = _blend_vectors(dataset.global_positive, personal_positive, personal_ratio)
        negative_profile = _blend_vectors(dataset.global_negative, personal_negative, personal_ratio)
        exclusion_user_id = target_user.id
        if not profile_ratings:
            basis = 'global_fallback'
        elif personal_ratio < 1:
            basis = 'blended'
        else:
            basis = 'personal'

    excluded_content_ids = {rating.content_id for rating in dataset.ratings_by_user.get(exclusion_user_id, ())}
    confidence = _confidence(len(profile_ratings))
    ranked_items: list[tuple[float, AnalyticsRecommendationItem]] = []

    for content in dataset.contents:
        if content.id in excluded_content_ids:
            continue
        if not normalized_required_tags.issubset(content.tags):
            continue
        candidate_vector = _candidate_vector(
            content,
            eligible_tags=dataset.eligible_tags,
            document_frequency=dataset.document_frequency,
            document_count=len(dataset.contents),
        )
        positive_similarity = _cosine_similarity(positive_profile, candidate_vector)
        negative_similarity = _cosine_similarity(negative_profile, candidate_vector)
        match_score = max(0.0, min(1.0, positive_similarity - 0.5 * negative_similarity))
        quality = dataset.global_quality.get(
            content.id,
            _ContentQuality(average_score=None, rating_count=0, bayesian_score=dataset.global_mean),
        )
        rank_score = 0.85 * match_score + 0.15 * (quality.bayesian_score / 10)
        matched_tags = sorted(
            (tag for tag in candidate_vector if positive_profile.get(tag, 0.0) > 0),
            key=lambda tag: (-(positive_profile.get(tag, 0.0) * candidate_vector[tag]), tag),
        )[:3]
        ranked_items.append(
            (
                rank_score,
                AnalyticsRecommendationItem(
                    id=content.id,
                    title=content.title,
                    title_alt=content.title_alt or '',
                    cover_url=content.cover_url or '',
                    content_type=content.content_type,
                    match_percent=round(match_score * 100),
                    confidence=confidence,
                    matched_tags=matched_tags,
                    basis=basis,
                    average_score=quality.average_score,
                    rating_count=quality.rating_count,
                ),
            )
        )

    ranked_items.sort(
        key=lambda ranked: (
            -ranked[0],
            -(ranked[1].average_score or 0),
            -ranked[1].rating_count,
            ranked[1].id,
        )
    )
    return AnalyticsRecommendationsResponse(
        scope=_scope_response(scope, target_user),
        profile_rating_count=len(profile_ratings),
        confidence=confidence,
        basis=basis,
        items=[item for _, item in ranked_items[:limit]],
    )


def _get_dataset(db: Session) -> _AnalyticsDataset:
    """返回共享分析快照；缓存未命中时同一进程只允许一个线程重建。"""
    bind = db.get_bind()
    if not isinstance(bind, Engine):
        return _build_dataset(db)
    with _DATASET_CACHE_LOCK:
        now = monotonic()
        cached = _DATASET_CACHE.get(bind)
        if cached is not None and cached.expires_at > now:
            return cached.dataset
        dataset = _build_dataset(db)
        _DATASET_CACHE[bind] = _DatasetCacheEntry(
            expires_at=now + ANALYTICS_CACHE_SECONDS,
            dataset=dataset,
        )
        return dataset


def _build_dataset(db: Session) -> _AnalyticsDataset:
    """用三次查询构造概览和推荐共同使用的不可变数据集。"""
    content_rows = (
        db.query(ContentItem)
        .options(selectinload(ContentItem.tags))
        .filter(
            ContentItem.is_public == True,  # noqa: E712
            ContentItem.deleted_at.is_(None),
            ContentItem.content_type.in_(ANIME_CONTENT_TYPES),
        )
        .order_by(ContentItem.id.asc())
        .all()
    )
    contents = tuple(
        _ContentRecord(
            id=content.id,
            title=content.title,
            title_alt=content.title_alt or '',
            cover_url=content.cover_url or '',
            content_type=content.content_type,
            tags=frozenset(_normalize_raw_tags(tag.name for tag in content.tags)),
        )
        for content in content_rows
    )
    contents_by_id = {content.id: content for content in contents}
    rating_rows = (
        db.query(Rating.user_id, Rating.content_id, Rating.score)
        .join(ContentItem, Rating.content_id == ContentItem.id)
        .filter(
            Rating.score > 0,
            ContentItem.is_public == True,  # noqa: E712
            ContentItem.deleted_at.is_(None),
            ContentItem.content_type.in_(ANIME_CONTENT_TYPES),
        )
        .order_by(Rating.id.asc())
        .all()
    )
    ratings = tuple(
        _RatingSample(user_id=row.user_id, content_id=row.content_id, score=row.score)
        for row in rating_rows
        if row.content_id in contents_by_id
    )
    ratings_by_user_lists: dict[int, list[_RatingSample]] = defaultdict(list)
    for rating in ratings:
        ratings_by_user_lists[rating.user_id].append(rating)
    ratings_by_user = {user_id: tuple(user_ratings) for user_id, user_ratings in ratings_by_user_lists.items()}
    document_frequency, blocked_tags = _tag_document_context(contents)
    eligible_tags = frozenset(
        tag
        for tag, count in document_frequency.items()
        if count >= MIN_RECOMMENDATION_TAG_DOCUMENTS and tag not in blocked_tags
    )
    global_quality, global_mean = _build_global_quality(ratings)
    global_positive, global_negative = _build_preference_vectors(
        ratings,
        contents_by_id=contents_by_id,
        eligible_tags=eligible_tags,
        document_frequency=document_frequency,
        document_count=len(contents),
    )
    return _AnalyticsDataset(
        contents=contents,
        contents_by_id=contents_by_id,
        ratings=ratings,
        ratings_by_user=ratings_by_user,
        document_frequency=document_frequency,
        blocked_tags=frozenset(blocked_tags),
        eligible_tags=eligible_tags,
        global_quality=global_quality,
        global_mean=global_mean,
        global_positive=global_positive,
        global_negative=global_negative,
    )


def _scope_response(scope: AnalyticsScope, target_user: User | None) -> AnalyticsScopeResponse:
    """构造前端使用的范围摘要。"""
    if scope == 'global':
        return AnalyticsScopeResponse(type='global')
    if target_user is None:
        raise ValueError('user scope requires target_user')
    return AnalyticsScopeResponse(
        type='user',
        user=AnalyticsUserSummary(
            id=target_user.id,
            username=target_user.username,
            nickname=target_user.nickname,
            avatar_url=target_user.avatar_url,
            avatar_crop=avatar_crop_from_db(target_user.avatar_crop),
        ),
    )


def _normalize_raw_tags(names: Iterable[str | None]) -> set[str]:
    """合并明确同义词，并保证单个番剧内标签不重复。"""
    normalized: set[str] = set()
    for raw_name in names:
        name = (raw_name or '').strip()
        if not name:
            continue
        normalized.add(TAG_ALIASES.get(name, name))
    return normalized


def _normalize_tag_names(names: list[str]) -> set[str]:
    """规范化 API 传入的标签名称，并忽略空值。"""
    normalized: set[str] = set()
    for raw_name in names:
        name = raw_name.strip()
        if name:
            normalized.add(TAG_ALIASES.get(name, name))
    return normalized


def _tag_document_context(
    contents: tuple[_ContentRecord, ...],
) -> tuple[dict[str, int], set[str]]:
    """计算标签文档频率以及分析层需要屏蔽的低信息标签。"""
    document_frequency: dict[str, int] = defaultdict(int)
    for content in contents:
        for tag in content.tags:
            document_frequency[tag] += 1
    blocked_tags = set(LOW_INFORMATION_TAGS)
    if contents:
        blocked_tags.update(
            tag for tag, count in document_frequency.items() if count / len(contents) > UBIQUITOUS_TAG_RATIO
        )
    return dict(document_frequency), blocked_tags


def _score_distribution(ratings: Sequence[_RatingSample]) -> list[AnalyticsScoreBucket]:
    """把完整评分样本归入 0.5 分档。"""
    bucket_counts = dict.fromkeys(range(1, 21), 0)
    for rating in ratings:
        bucket_index = max(1, min(20, (rating.score + 2) // 5))
        bucket_counts[bucket_index] += 1
    return [AnalyticsScoreBucket(score=index / 2, count=bucket_counts[index]) for index in range(1, 21)]


def _build_tag_clouds(
    ratings: Sequence[_RatingSample],
    contents_by_id: dict[int, _ContentRecord],
    blocked_tags: frozenset[str],
) -> tuple[list[AnalyticsTagStat], list[AnalyticsTagStat]]:
    """生成频次与评分权重两套词云数据。"""
    aggregates: dict[str, _TagAggregate] = defaultdict(_TagAggregate)
    for rating in ratings:
        for tag in contents_by_id[rating.content_id].tags - blocked_tags:
            aggregate = aggregates[tag]
            aggregate.rating_count += 1
            aggregate.score_total += rating.score
            aggregate.content_ids.add(rating.content_id)

    frequency_tags = [
        _tag_stat(name, aggregate, weight=float(aggregate.rating_count)) for name, aggregate in aggregates.items()
    ]
    weighted_tags = [
        _tag_stat(name, aggregate, weight=aggregate.score_total / 100) for name, aggregate in aggregates.items()
    ]
    frequency_tags.sort(key=lambda item: (-item.weight, item.name))
    weighted_tags.sort(key=lambda item: (-item.weight, item.name))
    return frequency_tags[:MAX_TAGS], weighted_tags[:MAX_TAGS]


def _tag_stat(name: str, aggregate: _TagAggregate, *, weight: float) -> AnalyticsTagStat:
    """把内部标签聚合转换为稳定的 API 数据。"""
    return AnalyticsTagStat(
        name=name,
        weight=round(weight, 3),
        rating_count=aggregate.rating_count,
        title_count=len(aggregate.content_ids),
        average_score=round(aggregate.score_total / aggregate.rating_count / 10, 2),
    )


def _build_global_quality(
    ratings: Sequence[_RatingSample],
) -> tuple[dict[int, _ContentQuality], float]:
    """用强度为 3 的全站均分先验抑制单样本极端分。"""
    global_mean = sum(rating.score for rating in ratings) / len(ratings) / 10 if ratings else NEUTRAL_SCORE
    scores_by_content: dict[int, list[int]] = defaultdict(list)
    for rating in ratings:
        scores_by_content[rating.content_id].append(rating.score)

    quality: dict[int, _ContentQuality] = {}
    for content_id, scores in scores_by_content.items():
        average = sum(scores) / len(scores) / 10
        count = len(scores)
        bayesian = (count / (count + BAYESIAN_PRIOR_STRENGTH)) * average + (
            BAYESIAN_PRIOR_STRENGTH / (count + BAYESIAN_PRIOR_STRENGTH)
        ) * global_mean
        quality[content_id] = _ContentQuality(
            average_score=round(average, 2),
            rating_count=count,
            bayesian_score=bayesian,
        )
    return quality, global_mean


def _favorite_items(
    ratings: Sequence[_RatingSample],
    *,
    scope: AnalyticsScope,
    contents_by_id: dict[int, _ContentRecord],
    global_quality: dict[int, _ContentQuality],
    global_mean: float,
) -> list[AnalyticsFavoriteItem]:
    """返回当前评分区间内最具代表性的三部已评分番剧。"""
    if scope == 'global':
        scores_by_content: dict[int, list[_RatingSample]] = defaultdict(list)
        for rating in ratings:
            scores_by_content[rating.content_id].append(rating)
        ranked_items: list[tuple[float, AnalyticsFavoriteItem]] = []
        for content_ratings in scores_by_content.values():
            content = contents_by_id[content_ratings[0].content_id]
            average = sum(rating.score for rating in content_ratings) / len(content_ratings) / 10
            count = len(content_ratings)
            bayesian = (count / (count + BAYESIAN_PRIOR_STRENGTH)) * average + (
                BAYESIAN_PRIOR_STRENGTH / (count + BAYESIAN_PRIOR_STRENGTH)
            ) * global_mean
            ranked_items.append(
                (
                    bayesian,
                    AnalyticsFavoriteItem(
                        id=content.id,
                        title=content.title,
                        title_alt=content.title_alt or '',
                        cover_url=content.cover_url or '',
                        content_type=content.content_type,
                        score=round(average, 2),
                        average_score=round(average, 2),
                        rating_count=count,
                    ),
                )
            )
        ranked_items.sort(key=lambda ranked: (-ranked[0], -ranked[1].rating_count, ranked[1].id))
        return [item for _, item in ranked_items[:3]]

    personal_items: list[AnalyticsFavoriteItem] = []
    for rating in ratings:
        content = contents_by_id[rating.content_id]
        quality = global_quality.get(
            content.id,
            _ContentQuality(average_score=None, rating_count=0, bayesian_score=global_mean),
        )
        personal_items.append(
            AnalyticsFavoriteItem(
                id=content.id,
                title=content.title,
                title_alt=content.title_alt or '',
                cover_url=content.cover_url or '',
                content_type=content.content_type,
                score=round(rating.score / 10, 2),
                average_score=quality.average_score,
                rating_count=quality.rating_count,
            )
        )
    personal_items.sort(
        key=lambda item: (
            -item.score,
            -global_quality.get(
                item.id,
                _ContentQuality(average_score=None, rating_count=0, bayesian_score=global_mean),
            ).bayesian_score,
            item.id,
        )
    )
    return personal_items[:3]


def _build_preference_vectors(
    ratings: Sequence[_RatingSample],
    *,
    contents_by_id: dict[int, _ContentRecord],
    eligible_tags: frozenset[str],
    document_frequency: dict[str, int],
    document_count: int,
) -> tuple[dict[str, float], dict[str, float]]:
    """把高低评分分别累积成正向与负向标签向量。"""
    positive: dict[str, float] = defaultdict(float)
    negative: dict[str, float] = defaultdict(float)
    for rating in ratings:
        score = rating.score / 10
        signal = max(-1.0, min(1.0, (score - NEUTRAL_SCORE) / 4))
        if signal == 0:
            continue
        for tag in contents_by_id[rating.content_id].tags & eligible_tags:
            contribution = abs(signal) * _inverse_document_frequency(
                document_frequency[tag],
                document_count,
            )
            if signal > 0:
                positive[tag] += contribution
            else:
                negative[tag] += contribution
    return _unit_vector(dict(positive)), _unit_vector(dict(negative))


def _candidate_vector(
    content: _ContentRecord,
    *,
    eligible_tags: frozenset[str],
    document_frequency: dict[str, int],
    document_count: int,
) -> dict[str, float]:
    """为候选番剧构造 IDF 标签向量。"""
    return {
        tag: _inverse_document_frequency(document_frequency[tag], document_count)
        for tag in content.tags & eligible_tags
    }


def _inverse_document_frequency(document_frequency: int, document_count: int) -> float:
    """平滑后的逆文档频率。"""
    return log((document_count + 1) / (document_frequency + 1)) + 1


def _unit_vector(vector: dict[str, float]) -> dict[str, float]:
    """把稀疏标签向量归一化为单位长度。"""
    magnitude = sqrt(sum(value * value for value in vector.values()))
    if magnitude == 0:
        return {}
    return {key: value / magnitude for key, value in vector.items()}


def _blend_vectors(
    global_vector: dict[str, float],
    personal_vector: dict[str, float],
    personal_ratio: float,
) -> dict[str, float]:
    """按评分数量平滑融合全站与个人画像。"""
    blended = {
        tag: (1 - personal_ratio) * global_vector.get(tag, 0.0) + personal_ratio * personal_vector.get(tag, 0.0)
        for tag in global_vector.keys() | personal_vector.keys()
    }
    return _unit_vector(blended)


def _cosine_similarity(profile: dict[str, float], candidate: dict[str, float]) -> float:
    """计算两个稀疏标签向量的余弦相似度。"""
    if not profile or not candidate:
        return 0.0
    candidate_magnitude = sqrt(sum(value * value for value in candidate.values()))
    if candidate_magnitude == 0:
        return 0.0
    dot_product = sum(profile.get(tag, 0.0) * value for tag, value in candidate.items())
    return dot_product / candidate_magnitude


def _confidence(rating_count: int) -> Confidence:
    """按有效评分数返回简单、可解释的置信度等级。"""
    if rating_count < 5:
        return 'low'
    if rating_count < 20:
        return 'medium'
    return 'high'
