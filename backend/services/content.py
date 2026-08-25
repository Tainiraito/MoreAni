"""Content service — CRUD, listing, search, random for MoreAni v2."""

import json
from datetime import UTC
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from models import ContentItem, ContentTag, Rating, Tag, UserContentStatus


def get_content_by_id(db: Session, content_id: int) -> ContentItem | None:
    """Get a single content item by ID (excludes soft-deleted)."""
    return (
        db.query(ContentItem)
        .options(selectinload(ContentItem.tags))
        .filter(ContentItem.id == content_id, ContentItem.deleted_at.is_(None))
        .first()
    )


def list_content(
    db: Session,
    *,
    content_type: str | None = None,
    status: str | None = None,
    tag: str | None = None,
    q: str | None = None,
    sort: Literal[
        'newest',
        'oldest',
        'rating',
        'title',
        'updated_desc',
        'air_date_desc',
        'air_date_asc',
    ] = 'updated_desc',
    rated: str | None = None,
    reviewed: str | None = None,
    favorited: str | None = None,
    season: str | None = None,
    rated_by: int | None = None,
    user_id: int | None = None,
    page: int = 1,
    size: int = 20,
) -> tuple[list[ContentItem], int]:
    """List content items with filters, search, and pagination.

    Returns:
        (items, total_count)
    """
    query = db.query(ContentItem).filter(
        ContentItem.is_public == True,  # noqa: E712
        ContentItem.deleted_at.is_(None),
    )

    if content_type:
        query = query.filter(ContentItem.content_type == content_type)

    if tag:
        query = query.join(ContentTag).join(Tag).filter(Tag.name == tag)

    if q:
        like_pattern = f'%{q}%'
        # Search across title, title_alt, description, AND tags
        tag_sub = (
            db.query(ContentTag.content_id)
            .join(Tag, ContentTag.tag_id == Tag.id)
            .filter(Tag.name.ilike(like_pattern))
            .subquery()
        )
        query = query.filter(
            (ContentItem.title.ilike(like_pattern))
            | (ContentItem.title_alt.ilike(like_pattern))
            | (ContentItem.description.ilike(like_pattern))
            | (ContentItem.id.in_(db.query(tag_sub.c.content_id)))
        )

    # Rated/unrated filter
    if rated and user_id is not None:
        rated_sub = db.query(Rating.content_id).filter(Rating.user_id == user_id, Rating.score > 0).subquery()
        if rated == 'rated':
            query = query.filter(ContentItem.id.in_(db.query(rated_sub.c.content_id)))
        elif rated == 'unrated':
            query = query.filter(~ContentItem.id.in_(db.query(rated_sub.c.content_id)))

    # Reviewed/unreviewed filter (non-empty review text)
    if reviewed and user_id is not None:
        reviewed_sub = (
            db.query(Rating.content_id)
            .filter(
                Rating.user_id == user_id,
                Rating.review.isnot(None),
                Rating.review != '',
            )
            .subquery()
        )
        if reviewed == 'reviewed':
            query = query.filter(ContentItem.id.in_(db.query(reviewed_sub.c.content_id)))
        elif reviewed == 'unreviewed':
            query = query.filter(~ContentItem.id.in_(db.query(reviewed_sub.c.content_id)))

    # Favorited/unfavorited filter (watch status = want)
    if favorited and user_id is not None:
        fav_sub = (
            db.query(UserContentStatus.content_id)
            .filter(
                UserContentStatus.user_id == user_id,
                UserContentStatus.status == 'want',
            )
            .subquery()
        )
        if favorited == 'favorited':
            query = query.filter(ContentItem.id.in_(db.query(fav_sub.c.content_id)))
        elif favorited == 'unfavorited':
            query = query.filter(~ContentItem.id.in_(db.query(fav_sub.c.content_id)))

    # 放送季度筛选：2026-01=1月番(01~03月) 2026-04=4月番(04~06月) 2026-07=7月番(07~09月) 2026-10=10月番(10~12月)
    # release_date 是 'YYYY-MM' 或 'YYYY-MM-DD' 字符串，季度范围用字符串区间 [start, end) 天然正确
    if season:
        try:
            season_year = int(season[:4])
            season_month = int(season[5:7])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail='放送季度格式不正确（如 2026-01）') from None
        if season_month not in (1, 4, 7, 10):
            raise HTTPException(status_code=422, detail='放送季度只支持 1/4/7/10 月番')
        if season_month == 1:
            season_start, season_end = f'{season_year}-01', f'{season_year}-04'
        elif season_month == 4:
            season_start, season_end = f'{season_year}-04', f'{season_year}-07'
        elif season_month == 7:
            season_start, season_end = f'{season_year}-07', f'{season_year}-10'
        else:  # 10
            season_start, season_end = f'{season_year}-10', f'{season_year + 1}-01'
        query = query.filter(
            ContentItem.release_date >= season_start,
            ContentItem.release_date < season_end,
        )

    # 用户筛选：该用户评分(score>0)或评论(review 非空)过的内容
    if rated_by is not None:
        user_rated_sub = (
            db.query(Rating.content_id)
            .filter(
                Rating.user_id == rated_by,
                (Rating.score > 0) | (Rating.review.isnot(None) & (Rating.review != '')),
            )
            .subquery()
        )
        query = query.filter(ContentItem.id.in_(db.query(user_rated_sub.c.content_id)))

    # Count before pagination
    total = query.count()

    # Sorting — 每个排序都必须带 id tie-breaker，否则相同排序值的条目翻页会重叠重复
    if sort == 'oldest':
        query = query.order_by(ContentItem.created_at.asc(), ContentItem.id.asc())
    elif sort == 'title':
        query = query.order_by(ContentItem.title.asc(), ContentItem.id.asc())
    elif sort == 'rating':
        # Subquery for average score (score > 0 only)
        avg_sub = (
            db.query(
                Rating.content_id,
                func.avg(Rating.score).label('avg_score'),
            )
            .filter(Rating.score > 0)
            .group_by(Rating.content_id)
            .subquery()
        )
        query = query.outerjoin(avg_sub, ContentItem.id == avg_sub.c.content_id)
        query = query.order_by(func.coalesce(avg_sub.c.avg_score, 0).desc(), ContentItem.id.desc())
    elif sort == 'air_date_desc':
        query = query.order_by(ContentItem.release_date.desc(), ContentItem.id.desc())
    elif sort == 'air_date_asc':
        query = query.order_by(ContentItem.release_date.asc(), ContentItem.id.asc())
    else:
        # updated_desc (default) — most recently updated first
        query = query.order_by(ContentItem.updated_at.desc(), ContentItem.id.desc())

    items = query.options(selectinload(ContentItem.tags)).offset((page - 1) * size).limit(size).all()
    return items, total


def get_recommendations(
    db: Session,
    *,
    content_type: str,
    size: int,
    exclude_ids: list[int],
    user_id: int | None,
) -> list[ContentItem]:
    """生成单次无重复的公开推荐池，排除不足时允许从上一轮回填。"""
    base_filters = (
        ContentItem.content_type == content_type,
        ContentItem.is_public == True,  # noqa: E712
        ContentItem.deleted_at.is_(None),
        ContentItem.cover_url.isnot(None),
        ContentItem.cover_url != '',
    )
    excluded = set(exclude_ids)
    chosen: list[ContentItem] = []
    chosen_ids: set[int] = set()
    interacted_subquery = None

    if user_id is not None:
        mine_limit = size // 2
        interacted_subquery = db.query(Rating.content_id).filter(
            Rating.user_id == user_id,
            (Rating.score > 0) | (Rating.review.isnot(None) & (Rating.review != '')),
        )
        mine = (
            db.query(ContentItem)
            .join(Rating, Rating.content_id == ContentItem.id)
            .options(selectinload(ContentItem.tags))
            .filter(
                *base_filters,
                Rating.user_id == user_id,
                (Rating.score > 0) | (Rating.review.isnot(None) & (Rating.review != '')),
                ~ContentItem.id.in_(excluded or {-1}),
            )
            .distinct()
            .order_by(func.random())
            .limit(mine_limit)
            .all()
        )
        chosen.extend(mine)
        chosen_ids.update(item.id for item in mine)

    remaining = size - len(chosen)
    if remaining:
        random_query = (
            db.query(ContentItem)
            .options(selectinload(ContentItem.tags))
            .filter(
                *base_filters,
                ~ContentItem.id.in_((excluded | chosen_ids) or {-1}),
            )
        )
        if interacted_subquery is not None:
            random_query = random_query.filter(~ContentItem.id.in_(interacted_subquery))
        random_items = random_query.order_by(func.random()).limit(remaining).all()
        chosen.extend(random_items)
        chosen_ids.update(item.id for item in random_items)

    # 排除上一轮后不够时，从上一轮回填；响应内部仍按 chosen_ids 去重。
    remaining = size - len(chosen)
    if remaining and excluded:
        backfill_query = (
            db.query(ContentItem)
            .options(selectinload(ContentItem.tags))
            .filter(
                *base_filters,
                ContentItem.id.in_(excluded),
                ~ContentItem.id.in_(chosen_ids or {-1}),
            )
        )
        if interacted_subquery is not None:
            backfill_query = backfill_query.filter(~ContentItem.id.in_(interacted_subquery))
        backfill = backfill_query.order_by(func.random()).limit(remaining).all()
        chosen.extend(backfill)

    return chosen


def create_content(
    db: Session,
    *,
    title: str,
    title_alt: str = '',
    cover_url: str = '',
    description: str = '',
    content_type: str,
    episodes: int = 0,
    status: str = '',
    release_date: str = '',
    platform: str = '',
    source_type: str = 'manual',
    source_id: str = '',
    source_url: str = '',
    content_metadata: dict | None = None,
    is_public: bool = True,
    created_by: int | None = None,
    tag_names: list[str] | None = None,
) -> ContentItem:
    """Create a new content item with optional tags."""
    # Duplicate check: same source_id (from Bangumi) or same title (manual)
    if source_id:
        existing = (
            db.query(ContentItem)
            .filter(
                ContentItem.source_id == source_id,
                ContentItem.source_type == source_type,
                ContentItem.deleted_at.is_(None),
            )
            .first()
        )
        if existing:
            raise ValueError(f'该内容已存在：{existing.title}')
    else:
        existing = (
            db.query(ContentItem)
            .filter(
                ContentItem.title == title.strip(),
                ContentItem.content_type == content_type,
                ContentItem.deleted_at.is_(None),
            )
            .first()
        )
        if existing:
            raise ValueError(f'同名内容已存在：{existing.title}')

    content = ContentItem(
        title=title,
        title_alt=title_alt,
        cover_url=cover_url,
        description=description,
        content_type=content_type,
        episodes=episodes,
        status=status,
        release_date=release_date,
        platform=platform,
        source_type=source_type,
        source_id=source_id,
        source_url=source_url,
        content_metadata=json.dumps(content_metadata) if content_metadata else '{}',
        is_public=is_public,
        created_by=created_by,
    )
    db.add(content)
    db.flush()  # Get the ID

    # Attach tags
    if tag_names:
        _attach_tags(db, content, tag_names)

    db.commit()
    db.refresh(content)
    return content


def update_content(
    db: Session,
    content: ContentItem,
    **fields,
) -> ContentItem:
    """Update content item fields.

    Accepts any combination of updatable fields.
    """
    for key, value in fields.items():
        if key == 'content_metadata' and isinstance(value, dict):
            value = json.dumps(value)
        if key == 'tags':
            _attach_tags(db, content, value)
            continue
        if value is not None and key != 'id':
            setattr(content, key, value)
    db.commit()
    db.refresh(content)
    return content


def delete_content(db: Session, content: ContentItem) -> None:
    """Soft-delete a content item (sets deleted_at, keeps DB rows)."""
    from datetime import datetime

    content.deleted_at = datetime.now(UTC)
    db.commit()


def get_random_content(
    db: Session,
    *,
    content_type: str | None = None,
    exclude_ids: list[int] | None = None,
    user_id: int | None = None,
) -> ContentItem | None:
    """Return one random public item, preferring content the user has not handled."""
    excluded = set(exclude_ids or [])

    def build_query():
        query = (
            db.query(ContentItem)
            .options(selectinload(ContentItem.tags))
            .filter(
                ContentItem.is_public == True,  # noqa: E712
                ContentItem.deleted_at.is_(None),
                ContentItem.cover_url.isnot(None),
                ContentItem.cover_url != '',
            )
        )
        if content_type:
            query = query.filter(ContentItem.content_type == content_type)
        if excluded:
            query = query.filter(~ContentItem.id.in_(excluded))
        return query

    if user_id is not None:
        interacted_subquery = db.query(Rating.content_id).filter(
            Rating.user_id == user_id,
            (Rating.score > 0) | (Rating.review.isnot(None) & (func.trim(Rating.review) != '')),
        )
        fresh_item = build_query().filter(~ContentItem.id.in_(interacted_subquery)).order_by(func.random()).first()
        if fresh_item is not None:
            return fresh_item

    # 未处理番剧不足时允许回退，避免「换一个」在内容池耗尽后失效。
    return build_query().order_by(func.random()).first()


def check_source_duplicate(db: Session, source_type: str, source_id: str) -> ContentItem | None:
    """Check if content with this source already exists."""
    return (
        db.query(ContentItem)
        .filter(
            ContentItem.source_type == source_type,
            ContentItem.source_id == source_id,
        )
        .first()
    )


def _attach_tags(db: Session, content: ContentItem, tag_names: list[str]) -> None:
    """Attach tag names to a content item (create tags if needed)."""
    # Remove existing tag associations
    db.query(ContentTag).filter(ContentTag.content_id == content.id).delete()
    db.flush()

    seen: set[str] = set()
    for name in tag_names:
        name = name.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        tag = db.query(Tag).filter(Tag.name == name).first()
        if not tag:
            tag = Tag(name=name, tag_type='custom')
            db.add(tag)
            db.flush()
        db.add(ContentTag(content_id=content.id, tag_id=tag.id))
