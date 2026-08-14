"""Tag service — business logic for tags."""

from sqlalchemy.orm import Session

from models import Tag, ContentTag


def get_or_create_tag(db: Session, name: str, tag_type: str = "custom") -> Tag:
    """Get existing tag or create new one."""
    tag = db.query(Tag).filter(Tag.name == name).first()
    if not tag:
        tag = Tag(name=name, tag_type=tag_type)
        db.add(tag)
        db.commit()
        db.refresh(tag)
    return tag


def get_tags_for_content(db: Session, content_id: int) -> list[Tag]:
    """Get all tags for a content item."""
    return (
        db.query(Tag)
        .join(ContentTag, ContentTag.tag_id == Tag.id)
        .filter(ContentTag.content_id == content_id)
        .all()
    )


def search_tags(db: Session, q: str | None = None, limit: int = 20) -> list[Tag]:
    """Search tags by name."""
    query = db.query(Tag)
    if q:
        query = query.filter(Tag.name.ilike(f"%{q}%"))
    return query.limit(limit).all()
