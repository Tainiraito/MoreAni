from datetime import UTC, datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(128), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))

    ratings = relationship('Rating', back_populates='user')


class InviteCode(Base):
    __tablename__ = 'invite_codes'

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))


class Anime(Base):
    __tablename__ = 'animes'

    id = Column(Integer, primary_key=True, index=True)
    title_cn = Column(String(200), nullable=False)
    title_jp = Column(String(200), default='')
    cover_url = Column(String(500), default='')
    description = Column(Text, default='')
    episodes = Column(Integer, default=0)
    status = Column(String(20), default='')
    tags = Column(Text, default='[]')
    season = Column(String(20), default='')
    air_date = Column(String(20), default='')
    platform = Column(String(20), default='')
    bgm_id = Column(Integer, unique=True, nullable=True)
    created_by = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    ratings = relationship('Rating', back_populates='anime')


class Rating(Base):
    __tablename__ = 'ratings'

    id = Column(Integer, primary_key=True, index=True)
    anime_id = Column(Integer, ForeignKey('animes.id'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    anime_score = Column(Integer, nullable=False)
    recommend = Column(Integer, nullable=False)
    review = Column(Text, default='')
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    anime = relationship('Anime', back_populates='ratings')
    user = relationship('User', back_populates='ratings')

    __table_args__ = (UniqueConstraint('anime_id', 'user_id', name='uq_anime_user'),)
