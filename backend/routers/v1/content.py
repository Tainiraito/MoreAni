"""Content router — CRUD, list, search, random, share."""

import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from deps import get_current_user, get_current_user_optional, get_db
from models import ContentItem, ShareLink, User
from schemas import (
    ContentItemCreate,
    ContentItemResponse,
    ContentItemUpdate,
    ContentListResponse,
    ShareLinkCreate,
    ShareLinkResponse,
    TagResponse,
)
from services import content as content_svc
from services import rating as rating_svc

router = APIRouter(prefix='/content', tags=['content'])


def _to_response(
    item: ContentItem, db: Session, user_id: int | None = None
) -> ContentItemResponse:
    """Convert a ContentItem ORM to response schema with computed fields."""
    resp = ContentItemResponse.model_validate(item)
    stats = rating_svc.get_rating_stats(db, item.id)
    resp.avg_score = stats['avg_score']
    resp.avg_recommend = stats['avg_recommend']
    resp.rating_count = stats['rating_count']
    resp.tags = [TagResponse.model_validate(t) for t in item.tags]
    # User-specific fields
    if user_id:
        from models import Rating

        my_rating = (
            db.query(Rating)
            .filter(
                Rating.content_id == item.id,
                Rating.user_id == user_id,
            )
            .first()
        )
        if my_rating and my_rating.score > 0:
            resp.my_score = my_rating.score / 10.0
            resp.my_has_review = bool(my_rating.review and my_rating.review.strip())
    return resp


@router.get('', response_model=ContentListResponse)
def list_content(
    db: Session = Depends(get_db),
    type: str | None = Query(None, description='Content type filter'),
    status: str | None = Query(None, alias='status', description='Watch status filter'),
    tag: str | None = Query(None, description='Tag filter'),
    q: str | None = Query(None, description='Search keyword'),
    sort: str = Query(
        'updated_desc',
        description=(
            'Sort: updated_desc/newest/oldest/rating/title/air_date_desc/air_date_asc'
        ),
    ),
    rated: str | None = Query(None, description='rated/unrated filter'),
    user: User | None = Depends(get_current_user_optional),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> ContentListResponse:
    """List content items with filters, search, and pagination."""
    items, total = content_svc.list_content(
        db,
        content_type=type,
        status=status,
        tag=tag,
        q=q,
        sort=sort,
        rated=rated,
        user_id=user.id if user else None,
        page=page,
        size=size,
    )
    return ContentListResponse(
        items=[_to_response(i, db, user.id if user else None) for i in items],
        total=total,
        page=page,
        size=size,
    )


@router.get('/random', response_model=ContentItemResponse)
def random_content(db: Session = Depends(get_db)) -> ContentItemResponse:
    """Get a random public content item."""
    item = content_svc.get_random_content(db)
    if not item:
        raise HTTPException(status_code=404, detail='No content available')
    return _to_response(item, db)


@router.get('/{content_id}', response_model=ContentItemResponse)
def get_content(
    content_id: int,
    db: Session = Depends(get_db),
) -> ContentItemResponse:
    """Get content detail by ID."""
    item = content_svc.get_content_by_id(db, content_id)
    if not item:
        raise HTTPException(status_code=404, detail='Content not found')
    return _to_response(item, db)


@router.post('', response_model=ContentItemResponse, status_code=201)
def create_content(
    body: ContentItemCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentItemResponse:
    """Create a new content item."""
    try:
        item = content_svc.create_content(
            db,
            title=body.title,
            title_alt=body.title_alt,
            cover_url=body.cover_url,
            description=body.description,
            content_type=body.content_type,
            episodes=body.episodes,
            status=body.status,
            release_date=body.release_date,
            platform=body.platform,
            source_type=body.source_type,
            source_id=body.source_id,
            source_url=body.source_url,
            content_metadata=body.metadata,
            is_public=body.is_public,
            created_by=user.id,
            tag_names=body.tags,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return _to_response(item, db)


@router.put('/{content_id}', response_model=ContentItemResponse)
def update_content(
    content_id: int,
    body: ContentItemUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentItemResponse:
    """Update an existing content item.

    Only the creator or admin can update.
    """
    item = content_svc.get_content_by_id(db, content_id)
    if not item:
        raise HTTPException(status_code=404, detail='Content not found')
    if item.created_by != user.id and user.role != 'admin':
        raise HTTPException(
            status_code=403, detail='No permission to edit this content'
        )

    update_data = body.model_dump(exclude_unset=True)
    updated = content_svc.update_content(db, item, **update_data)
    return _to_response(updated, db)


@router.delete('/{content_id}', status_code=204)
def delete_content(
    content_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete a content item.

    Only the creator or admin can delete. Cascades to ratings, statuses, tags.
    """
    item = content_svc.get_content_by_id(db, content_id)
    if not item:
        raise HTTPException(status_code=404, detail='Content not found')
    if item.created_by != user.id and user.role != 'admin':
        raise HTTPException(
            status_code=403, detail='No permission to delete this content'
        )

    content_svc.delete_content(db, item)


@router.post('/{content_id}/share', response_model=ShareLinkResponse)
def create_share_link(
    content_id: int,
    body: ShareLinkCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ShareLinkResponse:
    """Create a share link for a content item.

    Returns a token-based URL for guest access.
    """
    item = content_svc.get_content_by_id(db, content_id)
    if not item:
        raise HTTPException(status_code=404, detail='Content not found')

    token = secrets.token_urlsafe(24)[:32]
    link = ShareLink(
        token=token,
        created_by=user.id,
        expires_at=body.expires_at,
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    return ShareLinkResponse(
        id=link.id,
        token=link.token,
        url=f'/guest/{link.token}',
        expires_at=link.expires_at,
        view_count=link.view_count,
        created_at=link.created_at,
    )
