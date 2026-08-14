"""Content service — business logic for content management."""

from sqlalchemy.orm import Session

from models import ContentItem


def get_content_by_id(db: Session, content_id: int) -> ContentItem | None:
    """Get a single content item by ID."""
    return db.query(ContentItem).filter(ContentItem.id == content_id).first()


def list_content(
    db: Session,
    content_type: str | None = None,
    q: str | None = None,
    page: int = 1,
    size: int = 20,
) -> tuple[list[ContentItem], int]:
    """List content items with filtering and pagination."""
    query = db.query(ContentItem)

    if content_type:
        query = query.filter(ContentItem.content_type == content_type)
    if q:
        query = query.filter(ContentItem.title.ilike(f"%{q}%"))

    total = query.count()
    items = query.order_by(ContentItem.created_at.desc()).offset((page - 1) * size).limit(size).all()

    return items, total


def create_content(db: Session, data: dict) -> ContentItem:
    """Create a new content item."""
    item = ContentItem(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item
