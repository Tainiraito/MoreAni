"""Content service — CRUD, listing, search, random for MoreAni v2."""

import json
from typing import Literal

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import ContentItem, ContentTag, Rating, Tag


def get_content_by_id(db: Session, content_id: int) -> ContentItem | None:
    """Get a single content item by ID."""
    return db.query(ContentItem).filter(ContentItem.id == content_id).first()


def list_content(
    db: Session,
    *,
    content_type: str | None = None,
    status: str | None = None,
    tag: str | None = None,
    q: str | None = None,
    sort: Literal["newest", "oldest", "rating", "title"] = "newest",
    page: int = 1,
    size: int = 20,
) -> tuple[list[ContentItem], int]:
    """List content items with filters, search, and pagination.

    Returns:
        (items, total_count)
    """
    query = db.query(ContentItem).filter(ContentItem.is_public == True)  # noqa: E712

    if content_type:
        query = query.filter(ContentItem.content_type == content_type)

    if tag:
        query = query.join(ContentTag).join(Tag).filter(Tag.name == tag)

    if q:
        like_pattern = f"%{q}%"
        query = query.filter(
            (ContentItem.title.ilike(like_pattern))
            | (ContentItem.title_alt.ilike(like_pattern))
            | (ContentItem.description.ilike(like_pattern))
        )

    # Count before pagination
    total = query.count()

    # Sorting
    if sort == "oldest":
        query = query.order_by(ContentItem.created_at.asc())
    elif sort == "title":
        query = query.order_by(ContentItem.title.asc())
    elif sort == "rating":
        # Subquery for average score (score > 0 only)
        avg_sub = (
            db.query(
                Rating.content_id,
                func.avg(Rating.score).label("avg_score"),
            )
            .filter(Rating.score > 0)
            .group_by(Rating.content_id)
            .subquery()
        )
        query = query.outerjoin(avg_sub, ContentItem.id == avg_sub.c.content_id)
        query = query.order_by(func.coalesce(avg_sub.c.avg_score, 0).desc())
    else:
        # newest (default)
        query = query.order_by(ContentItem.created_at.desc())

    items = query.offset((page - 1) * size).limit(size).all()
    return items, total


def create_content(
    db: Session,
    *,
    title: str,
    title_alt: str = "",
    cover_url: str = "",
    description: str = "",
    content_type: str,
    episodes: int = 0,
    status: str = "",
    release_date: str = "",
    platform: str = "",
    source_type: str = "manual",
    source_id: str = "",
    source_url: str = "",
    content_metadata: dict | None = None,
    is_public: bool = True,
    created_by: int | None = None,
    tag_names: list[str] | None = None,
) -> ContentItem:
    """Create a new content item with optional tags."""
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
        content_metadata=json.dumps(content_metadata) if content_metadata else "{}",
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
        if key == "content_metadata" and isinstance(value, dict):
            value = json.dumps(value)
        if key == "tags":
            _attach_tags(db, content, value)
            continue
        if value is not None and key != "id":
            setattr(content, key, value)
    db.commit()
    db.refresh(content)
    return content


def delete_content(db: Session, content: ContentItem) -> None:
    """Delete a content item (cascades via ORM relationships)."""
    db.delete(content)
    db.commit()


def get_random_content(db: Session) -> ContentItem | None:
    """Return one random public content item."""
    return (
        db.query(ContentItem)
        .filter(ContentItem.is_public == True)  # noqa: E712
        .order_by(func.random())
        .first()
    )


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

    for name in tag_names:
        name = name.strip()
        if not name:
            continue
        tag = db.query(Tag).filter(Tag.name == name).first()
        if not tag:
            tag = Tag(name=name, tag_type="custom")
            db.add(tag)
            db.flush()
        db.add(ContentTag(content_id=content.id, tag_id=tag.id))
