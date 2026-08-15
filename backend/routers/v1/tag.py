"""Tag router — create and search tags."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from deps import get_current_user, get_db
from models import User
from schemas import TagCreate, TagResponse
from services import tag as tag_svc

router = APIRouter(prefix="/tag", tags=["tag"])


@router.post("", response_model=TagResponse, status_code=201)
def create_tag(
    body: TagCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TagResponse:
    """Create a custom tag.

    If a tag with the same name exists, returns the existing one.
    """
    tag = tag_svc.create_tag(db, name=body.name, tag_type="custom")
    return TagResponse.model_validate(tag)


@router.get("")
def search_tags(
    q: str = Query("", description="Search keyword"),
    db: Session = Depends(get_db),
) -> list[TagResponse]:
    """Search tags by name.

    Returns matching tags for autocomplete/suggestion.
    """
    tags = tag_svc.search_tags(db, q=q)
    return [TagResponse.model_validate(t) for t in tags]
