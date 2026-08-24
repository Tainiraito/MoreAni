"""Notification and resource subscription APIs."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from deps import get_current_user, get_current_user_optional, get_db
from models import ContentItem, User
from schemas import (
    NotificationListResponse,
    NotificationUnreadCountResponse,
    ResourceSubscriptionCreate,
    ResourceSubscriptionResponse,
)
from services import notifications as notification_svc

router = APIRouter(prefix='/notifications', tags=['notifications'])
subscription_router = APIRouter(prefix='/resource-subscriptions', tags=['resource-subscriptions'])


@router.get('', response_model=NotificationListResponse)
def list_notifications(
    scope: str = Query('all', pattern='^(all|public|private)$'),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> NotificationListResponse:
    """List public notifications and, when authenticated, private notifications."""
    if scope == 'private' and user is None:
        raise HTTPException(status_code=401, detail='Not authenticated')
    items, total, unread_count = notification_svc.list_notifications(
        db,
        user_id=user.id if user else None,
        scope=scope,
        page=page,
        size=size,
    )
    return NotificationListResponse(items=items, total=total, unread_count=unread_count, page=page, size=size)


@router.get('/unread-count', response_model=NotificationUnreadCountResponse)
def get_unread_count(
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> NotificationUnreadCountResponse:
    """Return public and private unread counters."""
    return NotificationUnreadCountResponse(**notification_svc.unread_counts(db, user_id=user.id if user else None))


@router.post('/refresh')
async def refresh_notifications(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Refresh the current user's resource subscriptions before opening the panel."""
    created = await notification_svc.refresh_subscriptions_with_cooldown(db)
    return {'created': created}


@router.post('/{notification_id}/read')
def mark_notification_read(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Mark one notification as read."""
    if not notification_svc.mark_read(db, user_id=user.id, notification_id=notification_id):
        raise HTTPException(status_code=404, detail='Notification not found')
    return {'ok': True}


@router.post('/read-all')
def mark_all_notifications_read(
    scope: str = Query('all', pattern='^(all|public|private)$'),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Mark all visible notifications in a scope as read."""
    marked = notification_svc.mark_all_read(db, user_id=user.id, scope=scope)
    return {'marked': marked}


@subscription_router.get('', response_model=list[ResourceSubscriptionResponse])
def list_resource_subscriptions(
    content_id: int | None = Query(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ResourceSubscriptionResponse]:
    """List active resource subscriptions for the current user."""
    return [
        ResourceSubscriptionResponse.model_validate(item, from_attributes=True)
        for item in notification_svc.list_subscriptions(db, user_id=user.id, content_id=content_id)
    ]


@subscription_router.post('', response_model=ResourceSubscriptionResponse)
async def create_resource_subscription(
    body: ResourceSubscriptionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResourceSubscriptionResponse:
    """Follow one Bangumi title and fansub team."""
    content = db.query(ContentItem).filter(ContentItem.id == body.content_id).first()
    if not content or (
        not content.is_public and content.created_by != user.id and user.role not in ('admin', 'super_admin')
    ):
        raise HTTPException(status_code=404, detail='番剧不存在')
    try:
        item = await notification_svc.create_subscription(
            db,
            user_id=user.id,
            content_id=body.content_id,
            source=body.source,
            fansub_name=body.fansub_name,
            fansub_id=body.fansub_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ResourceSubscriptionResponse.model_validate(item, from_attributes=True)


@subscription_router.delete('/{subscription_id}', status_code=204)
def delete_resource_subscription(
    subscription_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Stop following one resource group."""
    if not notification_svc.cancel_subscription(db, user_id=user.id, subscription_id=subscription_id):
        raise HTTPException(status_code=404, detail='Subscription not found')
