"""Tag service — CRUD, search for MoreAni v2."""

from sqlalchemy.orm import Session

from models import Tag


def get_tag_by_name(db: Session, name: str) -> Tag | None:
    """Get a tag by exact name."""
    return db.query(Tag).filter(Tag.name == name).first()


def create_tag(
    db: Session,
    *,
    name: str,
    tag_type: str = 'custom',
) -> Tag:
    """Create a new tag.

    If a tag with the same name exists, return the existing one.
    """
    existing = get_tag_by_name(db, name)
    if existing:
        return existing

    tag = Tag(name=name, tag_type=tag_type)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


def search_tags(db: Session, q: str = '', limit: int = 20) -> list[Tag]:
    """Search tags by name (fuzzy match)."""
    query = db.query(Tag)
    if q:
        query = query.filter(Tag.name.ilike(f'%{q}%'))
    return query.order_by(Tag.name).limit(limit).all()


def delete_tag(db: Session, tag: Tag) -> None:
    """Delete a tag.

    Note: content_tags associations are cascade-deleted by the DB.
    """
    db.delete(tag)
    db.commit()
