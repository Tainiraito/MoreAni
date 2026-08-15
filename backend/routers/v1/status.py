"""Status router — set, clear, list watch status."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from deps import get_current_user, get_db
from models import ContentItem, User, UserContentStatus
from schemas import StatusResponse, StatusSetRequest
from services import content as content_svc

router = APIRouter(prefix='/status', tags=['status'])

# Software/website types only support 'want' status
WANT_ONLY_TYPES = {'software', 'website'}


@router.post('', response_model=StatusResponse)
def set_status(
    body: StatusSetRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StatusResponse:
    """Set watch status for a content item.

    For software/website types, only 'want' is allowed.
    """
    content = content_svc.get_content_by_id(db, body.content_id)
    if not content:
        raise HTTPException(status_code=404, detail='Content not found')

    # Validate: software/website only support 'want'
    if content.content_type in WANT_ONLY_TYPES and body.status != 'want':
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail='软件/网站类型仅支持收藏',
        )

    # Upsert status
    existing = (
        db.query(UserContentStatus)
        .filter(
            UserContentStatus.user_id == user.id,
            UserContentStatus.content_id == body.content_id,
        )
        .first()
    )
    if existing:
        existing.status = body.status
    else:
        existing = UserContentStatus(
            user_id=user.id,
            content_id=body.content_id,
            status=body.status,
        )
        db.add(existing)

    db.commit()
    db.refresh(existing)

    return StatusResponse(
        id=existing.id,
        content_id=existing.content_id,
        status=existing.status,
        updated_at=existing.updated_at,
        content_title=content.title,
        content_cover=content.cover_url,
        content_type=content.content_type,
    )


@router.delete('/{content_id}', status_code=204)
def clear_status(
    content_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Clear watch status for a content item."""
    status_record = (
        db.query(UserContentStatus)
        .filter(
            UserContentStatus.user_id == user.id,
            UserContentStatus.content_id == content_id,
        )
        .first()
    )
    if status_record:
        db.delete(status_record)
        db.commit()


@router.get('')
def list_my_status(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Get current user's all watch statuses."""
    records = (
        db.query(UserContentStatus, ContentItem)
        .join(ContentItem, UserContentStatus.content_id == ContentItem.id)
        .filter(UserContentStatus.user_id == user.id)
        .order_by(UserContentStatus.updated_at.desc())
        .all()
    )

    items = [
        StatusResponse(
            id=s.id,
            content_id=s.content_id,
            status=s.status,
            updated_at=s.updated_at,
            content_title=c.title,
            content_cover=c.cover_url,
            content_type=c.content_type,
        )
        for s, c in records
    ]
    return {'items': items}
