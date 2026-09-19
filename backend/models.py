"""SQLAlchemy ORM models for MoreAni v2."""

from datetime import UTC, datetime
from enum import Enum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import Enum as SqlEnum
from sqlalchemy.orm import relationship

from database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class RatingRevisionSource(str, Enum):
    """来源于哪一种用户评分表达。"""

    INITIAL = 'initial'
    MANUAL = 'manual'
    IMPORT = 'import'
    PK_SUGGESTION = 'pk_suggestion'
    # 兼容 MoreAni 现有的评分校准功能；不是红蓝合战 PK 事实。
    COMPARISON = 'comparison'
    DELETE = 'delete'
    MIGRATION_SNAPSHOT = 'migration_snapshot'


# 只有这些来源会改变模型看到的 score_anchor 输入。pk_suggestion 虽然会
# 改变 Rating.score，但不能推进 anchor watermark；migration_snapshot 只是
# 历史基线，不代表迁移之后发生了新的独立评分表达。delete 会移除一个
# 现有 Rating，因此会改变有效 anchor 输入集合。
SCORE_ANCHOR_REVISION_SOURCES: frozenset[str] = frozenset(
    {
        RatingRevisionSource.INITIAL.value,
        RatingRevisionSource.MANUAL.value,
        RatingRevisionSource.IMPORT.value,
        RatingRevisionSource.COMPARISON.value,
        RatingRevisionSource.DELETE.value,
    },
)


class RedBlueOutcome(str, Enum):
    """一次红蓝合战比较的用户选择。"""

    LEFT_WIN = 'LEFT_WIN'
    RIGHT_WIN = 'RIGHT_WIN'
    TIE = 'TIE'
    SKIP = 'SKIP'


class PreferenceModelRunStatus(str, Enum):
    """偏好模型计算任务状态。"""

    PENDING = 'PENDING'
    RUNNING = 'RUNNING'
    COMPLETED = 'COMPLETED'
    FAILED = 'FAILED'


class PreferenceStability(str, Enum):
    """排名结果的稳定性标签；本阶段只定义语义，不判断标签。"""

    UNCALIBRATED = 'UNCALIBRATED'
    CALIBRATING = 'CALIBRATING'
    RELATIVELY_STABLE = 'RELATIVELY_STABLE'
    STABLE = 'STABLE'
    ORDER_UNCERTAIN = 'ORDER_UNCERTAIN'


class ScoreSuggestionStatus(str, Enum):
    """评分建议当前状态。"""

    PENDING = 'PENDING'
    ACCEPTED = 'ACCEPTED'
    DISMISSED = 'DISMISSED'
    REJECTED = 'REJECTED'
    EXPIRED = 'EXPIRED'


class ScoreSuggestionActionType(str, Enum):
    """用户对评分建议执行的不可丢失操作。"""

    ACCEPTED = 'ACCEPTED'
    DISMISSED = 'DISMISSED'
    REJECTED = 'REJECTED'


def _enum_column(enum_class: type[Enum], name: str) -> SqlEnum:
    """创建在 SQLite 中保存枚举值并带 CHECK 约束的字符串枚举列。"""
    return SqlEnum(
        enum_class,
        name=name,
        native_enum=False,
        create_constraint=True,
        values_callable=lambda values: [member.value for member in values],
    )


class User(Base):
    """System user (admin or regular user)."""

    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    nickname = Column(String(50), unique=True, nullable=False, index=True)  # display name, unique
    password_hash = Column(String(128), nullable=False)
    avatar_id = Column(Integer, default=0)
    avatar_url = Column(String(255), nullable=True)  # 上传的头像图片路径（/api/avatars/...）
    avatar_crop = Column(Text, nullable=True)  # GIF 显示裁剪参数（JSON）
    role = Column(String(20), default='user')  # admin / user
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    ratings = relationship('Rating', back_populates='user', cascade='all, delete-orphan')
    rating_revisions = relationship('RatingRevision', back_populates='user', cascade='all, delete-orphan')
    red_blue_comparisons = relationship(
        'RedBlueComparison',
        back_populates='user',
        cascade='all, delete-orphan',
    )
    preference_model_runs = relationship(
        'PreferenceModelRun',
        back_populates='user',
        cascade='all, delete-orphan',
    )
    preference_results = relationship(
        'PreferenceResult',
        back_populates='user',
        cascade='all, delete-orphan',
    )
    score_suggestions = relationship(
        'ScoreSuggestion',
        back_populates='user',
        cascade='all, delete-orphan',
    )
    score_suggestion_actions = relationship(
        'ScoreSuggestionAction',
        back_populates='user',
        cascade='all, delete-orphan',
    )
    red_blue_state = relationship(
        'RedBlueUserState',
        back_populates='user',
        uselist=False,
        cascade='all, delete-orphan',
    )
    # 删除账号时内容会先转交给执行操作的超级管理员，不能随父用户级联删除。
    content_items = relationship('ContentItem', back_populates='creator')
    statuses = relationship('UserContentStatus', back_populates='user', cascade='all, delete-orphan')


class InviteCode(Base):
    """Registration invite code."""

    __tablename__ = 'invite_codes'

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    used_by = Column(Integer, ForeignKey('users.id'), nullable=True)
    max_uses = Column(Integer, default=1)  # 可重复使用次数
    use_count = Column(Integer, default=0)  # 已使用次数
    expires_at = Column(DateTime, nullable=True)  # 有效截止时间（None=永不过期）
    created_at = Column(DateTime, default=_utcnow)


class ContentItem(Base):
    """Unified content model for anime, anime movie, movie, game, software, website, book."""

    __tablename__ = 'content_items'

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    title_alt = Column(String(200), default='')
    cover_url = Column(String(500), default='')
    description = Column(Text, default='')
    content_type = Column(String(20), nullable=False, index=True)
    episodes = Column(Integer, default=0)
    status = Column(String(20), default='')  # airing/finished/upcoming
    release_date = Column(String(20), default='')
    platform = Column(String(50), default='')
    source_type = Column(String(20), default='manual')  # bangumi/manual
    source_id = Column(String(50), default='', index=True)
    source_url = Column(String(500), default='')
    content_metadata = Column('metadata', Text, default='{}')
    is_public = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    deleted_at = Column(DateTime, nullable=True, index=True)  # soft delete

    creator = relationship('User', back_populates='content_items')
    ratings = relationship('Rating', back_populates='content', cascade='all, delete-orphan')
    rating_revisions = relationship('RatingRevision', back_populates='content', cascade='all, delete-orphan')
    tags = relationship('Tag', secondary='content_tags', back_populates='contents')
    statuses = relationship('UserContentStatus', back_populates='content', cascade='all, delete-orphan')

    __table_args__ = ({'comment': 'Unified content table for all content types'},)


class Tag(Base):
    """Content tag (bangumi or custom)."""

    __tablename__ = 'tags'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False, index=True)
    tag_type = Column(String(20), default='custom')  # bangumi / custom
    created_at = Column(DateTime, default=_utcnow)

    contents = relationship('ContentItem', secondary='content_tags', back_populates='tags')


class ContentTag(Base):
    """Association table for content <-> tag."""

    __tablename__ = 'content_tags'

    content_id = Column(
        Integer,
        ForeignKey('content_items.id', ondelete='CASCADE'),
        primary_key=True,
    )
    tag_id = Column(
        Integer,
        ForeignKey('tags.id', ondelete='CASCADE'),
        primary_key=True,
    )


class Rating(Base):
    """User rating for a content item (0-100 scale)."""

    __tablename__ = 'ratings'

    id = Column(Integer, primary_key=True, index=True)
    content_id = Column(
        Integer,
        ForeignKey('content_items.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    user_id = Column(
        Integer,
        ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    score = Column(Integer, nullable=False, default=0)  # 0-100
    # 最近一次独立于红蓝合战建议、由用户明确表达的评分。
    score_anchor = Column(Integer, nullable=False, default=0)  # 0-100
    recommend = Column(Integer, nullable=False, default=0)  # 0-100
    review = Column(Text, default='')
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    content = relationship('ContentItem', back_populates='ratings')
    user = relationship('User', back_populates='ratings')

    __table_args__ = (
        UniqueConstraint('content_id', 'user_id', name='uq_content_user'),
        Index('ix_ratings_user_score_anchor', 'user_id', 'score_anchor'),
        {'comment': 'Per-user rating for a content item'},
    )


class RatingRevision(Base):
    """One persisted primary-score change for a user's content rating."""

    __tablename__ = 'rating_revisions'

    id = Column(Integer, primary_key=True, index=True)
    rating_id = Column(
        Integer,
        ForeignKey('ratings.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )
    content_id = Column(
        Integer,
        ForeignKey('content_items.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    user_id = Column(
        Integer,
        ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    previous_score = Column(Integer, nullable=False)
    new_score = Column(Integer, nullable=False)
    changed_at = Column(DateTime, default=_utcnow, nullable=False, index=True)
    source = Column(String(30), nullable=False, default='manual')
    comparison_id = Column(String(64), nullable=True, index=True)
    score_suggestion_id = Column(
        Integer,
        ForeignKey('score_suggestions.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )
    score_suggestion_action_id = Column(
        Integer,
        ForeignKey('score_suggestion_actions.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )

    user = relationship('User', back_populates='rating_revisions')
    content = relationship('ContentItem', back_populates='rating_revisions')
    score_suggestion = relationship('ScoreSuggestion', back_populates='rating_revisions')
    score_suggestion_action = relationship('ScoreSuggestionAction')


class RedBlueComparison(Base):
    """红蓝合战的不可变 PK 事实；撤销只写 revoked_at，不物理删除。"""

    __tablename__ = 'red_blue_comparisons'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    left_content_id = Column(Integer, ForeignKey('content_items.id'), nullable=False, index=True)
    right_content_id = Column(Integer, ForeignKey('content_items.id'), nullable=False, index=True)
    outcome = Column(_enum_column(RedBlueOutcome, 'red_blue_outcome'), nullable=False)
    client_event_id = Column(String(64), nullable=False)
    selector_version = Column(String(32), nullable=False, default='v1')
    created_at = Column(DateTime, default=_utcnow, nullable=False, index=True)
    revoked_at = Column(DateTime, nullable=True, index=True)

    user = relationship('User', back_populates='red_blue_comparisons')

    __table_args__ = (
        CheckConstraint(
            'left_content_id != right_content_id',
            name='ck_red_blue_comparison_distinct_contents',
        ),
        UniqueConstraint('user_id', 'client_event_id', name='uq_red_blue_comparison_client_event'),
        Index(
            'ix_red_blue_comparisons_user_created',
            'user_id',
            'created_at',
        ),
        Index(
            'ix_red_blue_comparisons_user_active_created',
            'user_id',
            'revoked_at',
            'created_at',
        ),
        Index(
            'ix_red_blue_comparisons_user_pair_created',
            'user_id',
            'left_content_id',
            'right_content_id',
            'created_at',
        ),
    )


class PreferenceModelRun(Base):
    """一次可追踪、可失败、可全量重算的偏好模型计算。"""

    __tablename__ = 'preference_model_runs'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    algorithm_version = Column(String(64), nullable=False)
    status = Column(
        _enum_column(PreferenceModelRunStatus, 'preference_model_run_status'),
        nullable=False,
        default=PreferenceModelRunStatus.PENDING,
    )
    input_comparison_max_id = Column(Integer, nullable=True)
    # 记录本次完整计算读取到的用户 comparison 事实状态版本。
    input_comparison_state_version = Column(Integer, nullable=False, default=0, server_default='0')
    # 记录本次完整计算读取到的 revoke 状态版本；它单独表达旧 evidence 是否可能被移除。
    input_revoke_version = Column(Integer, nullable=False, default=0, server_default='0')
    # 最新一条会改变有效 score_anchor 输入的 RatingRevision.id。
    input_rating_revision_max_id = Column(Integer, nullable=True)
    # JSON object；保存本次运行实际参数，而不是只依赖 algorithm_version。
    algorithm_config_json = Column(
        Text,
        nullable=False,
        default='{}',
        server_default='{}',
    )
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)

    user = relationship('User', back_populates='preference_model_runs')
    results = relationship(
        'PreferenceResult',
        back_populates='model_run',
        cascade='all, delete-orphan',
    )
    score_suggestions = relationship(
        'ScoreSuggestion',
        back_populates='model_run',
        cascade='all, delete-orphan',
    )

    __table_args__ = (
        Index(
            'ix_preference_model_runs_user_status_started',
            'user_id',
            'status',
            'started_at',
        ),
        Index(
            'ix_preference_model_runs_algorithm_status',
            'algorithm_version',
            'status',
        ),
        Index(
            'ix_preference_model_runs_user_input_watermarks',
            'user_id',
            'input_comparison_max_id',
            'input_comparison_state_version',
            'input_revoke_version',
            'input_rating_revision_max_id',
        ),
    )


class RedBlueUserState(Base):
    """每个用户的 comparison 状态 watermark；不是排名缓存或事实明细。"""

    __tablename__ = 'red_blue_user_states'

    user_id = Column(
        Integer,
        ForeignKey('users.id', ondelete='CASCADE'),
        primary_key=True,
    )
    # 新增 Comparison（包括 SKIP）都会递增。
    comparison_state_version = Column(Integer, nullable=False, default=0, server_default='0')
    # revoke 已有 Comparison 时与 comparison_state_version 一起递增。
    revoke_version = Column(Integer, nullable=False, default=0, server_default='0')
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)

    user = relationship('User', back_populates='red_blue_state')


class PreferenceResult(Base):
    """某次模型运行生成的排名快照，可从事实重新建立。"""

    __tablename__ = 'preference_results'

    id = Column(Integer, primary_key=True, index=True)
    model_run_id = Column(
        Integer,
        ForeignKey('preference_model_runs.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    content_id = Column(Integer, ForeignKey('content_items.id', ondelete='CASCADE'), nullable=False, index=True)
    preference_mean = Column(Float, nullable=False)
    preference_std = Column(Float, nullable=False)
    expected_rank = Column(Float, nullable=False)
    rank_low = Column(Integer, nullable=False)
    rank_high = Column(Integer, nullable=False)
    stability = Column(
        _enum_column(PreferenceStability, 'preference_result_stability'),
        nullable=False,
        default=PreferenceStability.UNCALIBRATED,
    )
    comparison_count = Column(Integer, nullable=False, default=0)
    computed_at = Column(DateTime, default=_utcnow, nullable=False, index=True)

    model_run = relationship('PreferenceModelRun', back_populates='results')
    user = relationship('User', back_populates='preference_results')
    content = relationship('ContentItem')

    __table_args__ = (
        CheckConstraint('rank_low <= rank_high', name='ck_preference_result_rank_interval'),
        CheckConstraint('comparison_count >= 0', name='ck_preference_result_comparison_count'),
        UniqueConstraint('model_run_id', 'content_id', name='uq_preference_result_run_content'),
        Index(
            'ix_preference_results_user_rank_interval',
            'user_id',
            'rank_low',
            'rank_high',
        ),
        Index(
            'ix_preference_results_user_content',
            'user_id',
            'content_id',
        ),
    )


class ScoreSuggestion(Base):
    """某次模型运行推导出的评分建议；状态只是派生展示缓存。"""

    __tablename__ = 'score_suggestions'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    content_id = Column(Integer, ForeignKey('content_items.id', ondelete='CASCADE'), nullable=False, index=True)
    model_run_id = Column(
        Integer,
        ForeignKey('preference_model_runs.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    # 由未来算法根据建议依据生成；不包含 model_run_id，便于跨重算识别同一建议。
    suggestion_key = Column(String(128), nullable=False)
    current_score = Column(Integer, nullable=False)
    suggested_score_low = Column(Integer, nullable=False)
    suggested_score_high = Column(Integer, nullable=False)
    recommended_score = Column(Integer, nullable=False)
    direction = Column(String(16), nullable=True)
    confidence = Column(Float, nullable=True)
    severity = Column(Float, nullable=True)
    reason_code = Column(String(64), nullable=True)
    status = Column(
        _enum_column(ScoreSuggestionStatus, 'score_suggestion_status'),
        nullable=False,
        default=ScoreSuggestionStatus.PENDING,
    )
    created_at = Column(DateTime, default=_utcnow, nullable=False, index=True)
    handled_at = Column(DateTime, nullable=True)

    user = relationship('User', back_populates='score_suggestions')
    content = relationship('ContentItem')
    model_run = relationship('PreferenceModelRun', back_populates='score_suggestions')
    rating_revisions = relationship('RatingRevision', back_populates='score_suggestion')

    __table_args__ = (
        CheckConstraint('current_score BETWEEN 0 AND 100', name='ck_score_suggestion_current_score'),
        CheckConstraint('suggested_score_low BETWEEN 0 AND 100', name='ck_score_suggestion_low'),
        CheckConstraint('suggested_score_high BETWEEN 0 AND 100', name='ck_score_suggestion_high'),
        CheckConstraint('recommended_score BETWEEN 0 AND 100', name='ck_score_suggestion_recommended'),
        CheckConstraint(
            'suggested_score_low <= suggested_score_high',
            name='ck_score_suggestion_score_interval',
        ),
        CheckConstraint(
            'confidence IS NULL OR confidence BETWEEN 0 AND 1',
            name='ck_score_suggestion_confidence',
        ),
        CheckConstraint(
            'severity IS NULL OR severity BETWEEN 0 AND 1',
            name='ck_score_suggestion_severity',
        ),
        UniqueConstraint(
            'model_run_id',
            'user_id',
            'content_id',
            'suggestion_key',
            name='uq_score_suggestion_run_user_content_key',
        ),
        Index(
            'ix_score_suggestions_user_status_created',
            'user_id',
            'status',
            'created_at',
        ),
        Index(
            'ix_score_suggestions_user_content_status',
            'user_id',
            'content_id',
            'status',
        ),
        Index(
            'ix_score_suggestions_user_content_key',
            'user_id',
            'content_id',
            'suggestion_key',
        ),
    )


class ScoreSuggestionAction(Base):
    """用户处理评分建议的权威事实，重算或删除派生 suggestion 后仍保留。"""

    __tablename__ = 'score_suggestion_actions'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    content_id = Column(Integer, ForeignKey('content_items.id'), nullable=False, index=True)
    score_suggestion_id = Column(
        Integer,
        ForeignKey('score_suggestions.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )
    model_run_id = Column(
        Integer,
        ForeignKey('preference_model_runs.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )
    suggestion_key = Column(String(128), nullable=False)
    action = Column(
        _enum_column(ScoreSuggestionActionType, 'score_suggestion_action_type'),
        nullable=False,
    )
    current_score = Column(Integer, nullable=False)
    recommended_score = Column(Integer, nullable=False)
    # 用户执行动作时的事实状态版本；不能依赖可删除的 Model Run 推导。
    comparison_state_version_at_action = Column(Integer, nullable=False, default=0, server_default='0')
    # 排除 SKIP 后最后一条有效 comparison 的 id，用于精确判断新 evidence。
    effective_comparison_max_id_at_action = Column(Integer, nullable=True)
    # 客户端写操作幂等键；NULL 兼容历史 action，非 NULL 时按用户唯一。
    client_event_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=_utcnow, nullable=False, index=True)

    user = relationship('User', back_populates='score_suggestion_actions')
    content = relationship('ContentItem')
    score_suggestion = relationship('ScoreSuggestion')

    __table_args__ = (
        CheckConstraint('current_score BETWEEN 0 AND 100', name='ck_score_suggestion_action_current_score'),
        CheckConstraint('recommended_score BETWEEN 0 AND 100', name='ck_score_suggestion_action_recommended_score'),
        CheckConstraint(
            'comparison_state_version_at_action >= 0',
            name='ck_score_suggestion_action_comparison_state_version',
        ),
        UniqueConstraint(
            'user_id',
            'client_event_id',
            name='uq_score_suggestion_action_user_client_event',
        ),
        Index(
            'ix_score_suggestion_actions_user_content_created',
            'user_id',
            'content_id',
            'created_at',
        ),
        Index(
            'ix_score_suggestion_actions_user_content_key',
            'user_id',
            'content_id',
            'suggestion_key',
        ),
        Index(
            'ix_score_suggestion_actions_user_effective_comparison',
            'user_id',
            'effective_comparison_max_id_at_action',
        ),
    )


class UserContentStatus(Base):
    """Per-user watch status for a content item."""

    __tablename__ = 'user_content_status'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    content_id = Column(
        Integer,
        ForeignKey('content_items.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    status = Column(String(20), nullable=False)  # want/watching/watched/dropped
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    user = relationship('User', back_populates='statuses')
    content = relationship('ContentItem', back_populates='statuses')

    __table_args__ = (UniqueConstraint('user_id', 'content_id', name='uq_user_content_status'),)


class ResourceSubscription(Base):
    """A user's subscription to one Bangumi title, source, and fansub team."""

    __tablename__ = 'resource_subscriptions'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    content_id = Column(Integer, ForeignKey('content_items.id', ondelete='CASCADE'), nullable=False, index=True)
    subject_id = Column(Integer, nullable=False, index=True)
    source = Column(String(30), nullable=False, default='animegarden', index=True)
    fansub_key = Column(String(120), nullable=False)
    fansub_name = Column(String(120), nullable=False)
    fansub_id = Column(String(120), nullable=True)
    active = Column(Boolean, nullable=False, default=True, index=True)
    last_seen_created_at = Column(DateTime, nullable=True)
    last_seen_resource_key = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (
        UniqueConstraint(
            'user_id',
            'subject_id',
            'source',
            'fansub_key',
            name='uq_resource_subscription_target',
        ),
    )


class Notification(Base):
    """Public announcement or private user notification."""

    __tablename__ = 'notifications'

    id = Column(Integer, primary_key=True, index=True)
    scope = Column(String(20), nullable=False, index=True)  # public / private
    recipient_user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=True, index=True)
    kind = Column(String(30), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=False, default='')
    payload_json = Column(Text, nullable=False, default='{}')
    created_by = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    is_published = Column(Boolean, nullable=False, default=True, index=True)
    published_at = Column(DateTime, nullable=True, index=True)
    expires_at = Column(DateTime, nullable=True, index=True)
    dedupe_key = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=_utcnow, index=True)

    __table_args__ = (UniqueConstraint('recipient_user_id', 'dedupe_key', name='uq_notification_recipient_dedupe'),)


class NotificationRead(Base):
    """Per-user read receipt for public and private notifications."""

    __tablename__ = 'notification_reads'

    id = Column(Integer, primary_key=True, index=True)
    notification_id = Column(
        Integer,
        ForeignKey('notifications.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    read_at = Column(DateTime, default=_utcnow, nullable=False)

    __table_args__ = (UniqueConstraint('notification_id', 'user_id', name='uq_notification_read'),)


class AiringCalendarItem(Base):
    """A Bangumi weekly anime calendar item persisted by the daily sync."""

    __tablename__ = 'airing_calendar_items'

    id = Column(Integer, primary_key=True, index=True)
    subject_id = Column(Integer, nullable=False, index=True)
    weekday = Column(Integer, nullable=False, index=True)  # 1=Monday ... 7=Sunday
    title = Column(String(200), nullable=False)
    title_alt = Column(String(200), nullable=True, default='')
    cover_url = Column(String(500), nullable=True, default='')
    bangumi_url = Column(String(500), nullable=False)
    active = Column(Boolean, nullable=False, default=True, index=True)
    last_seen_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (UniqueConstraint('subject_id', 'weekday', name='uq_airing_calendar_subject_weekday'),)


class AiringCalendarSyncState(Base):
    """Singleton status row for the daily Bangumi calendar sync."""

    __tablename__ = 'airing_calendar_sync_state'

    id = Column(Integer, primary_key=True)
    last_attempt_at = Column(DateTime, nullable=True)
    last_success_at = Column(DateTime, nullable=True)
    status = Column(String(20), nullable=False, default='pending')  # success/failed/pending
    error_message = Column(Text, nullable=True)
    item_count = Column(Integer, nullable=False, default=0)
    consecutive_failure_days = Column(Integer, nullable=False, default=0)
    last_failure_at = Column(DateTime, nullable=True)
    failure_notified_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class CoverAsset(Base):
    """A cached cover asset keyed by its upstream Bangumi subject."""

    __tablename__ = 'cover_assets'

    id = Column(Integer, primary_key=True, index=True)
    source_type = Column(String(20), nullable=False, default='bangumi', index=True)
    source_id = Column(String(50), nullable=False, index=True)
    source_url = Column(String(500), nullable=False, default='')
    local_path = Column(String(500), nullable=True)
    source_version = Column(String(16), nullable=False, default='')
    content_hash = Column(String(64), nullable=True)
    mime_type = Column(String(100), nullable=True)
    byte_size = Column(Integer, nullable=False, default=0)
    status = Column(String(20), nullable=False, default='failed', index=True)  # ready/failed
    failure_count = Column(Integer, nullable=False, default=0)
    last_attempt_at = Column(DateTime, nullable=True)
    last_success_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (UniqueConstraint('source_type', 'source_id', name='uq_cover_asset_source'),)
