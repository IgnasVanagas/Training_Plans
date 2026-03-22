import enum
from datetime import datetime

from sqlalchemy import Boolean, Column, Enum, Float, ForeignKey, Integer, String, DateTime, Date, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from .database import Base


class RoleEnum(str, enum.Enum):
    coach = "coach"
    athlete = "athlete"
    admin = "admin"


class ComplianceStatusEnum(str, enum.Enum):
    planned = "planned"
    completed_green = "completed_green"
    completed_yellow = "completed_yellow"
    completed_red = "completed_red"
    missed = "missed"


class PlannedWorkout(Base):
    __tablename__ = "planned_workouts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    matched_activity_id = Column(Integer, ForeignKey("activities.id"), nullable=True)
    
    date = Column(Date, nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    sport_type = Column(String(50), nullable=False) # e.g. Cycling, Running
    planned_duration = Column(Integer, nullable=False) # minutes
    planned_distance = Column(Float, nullable=True) # km
    planned_intensity = Column(String(50), nullable=True)
    structure = Column(JSONB, nullable=True)
    season_plan_id = Column(Integer, ForeignKey("season_plans.id"), nullable=True)
    planning_context = Column(JSONB, nullable=True)
    
    # Execution / Feedback
    rpe = Column(Float, nullable=True) # 1-10
    notes = Column(Text, nullable=True) # User feedback

    compliance_status = Column(Enum(ComplianceStatusEnum), default=ComplianceStatusEnum.planned, nullable=False)

    user = relationship("User", back_populates="planned_workouts", foreign_keys=[user_id])
    created_by = relationship("User", foreign_keys=[created_by_user_id], back_populates="created_planned_workouts")
    matched_activity = relationship("Activity", back_populates="matched_workout")
    season_plan = relationship("SeasonPlan", back_populates="planned_workouts")


class OrganizationMember(Base):
    __tablename__ = "organization_members"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), primary_key=True)
    role = Column(String(20), nullable=False)  # coach, athlete, admin
    status = Column(String(20), default="active", nullable=False) # active, pending, pending_approval, rejected

    user = relationship("User", back_populates="organization_memberships")
    organization = relationship("Organization", back_populates="members")


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    code = Column(String(50), unique=True, index=True, nullable=True)
    description = Column(Text, nullable=True)
    picture = Column(String(255), nullable=True)
    settings_json = Column(JSONB, nullable=True)

    members = relationship("OrganizationMember", back_populates="organization")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    email_verified = Column(Boolean, nullable=False, default=False)
    role = Column(Enum(RoleEnum), nullable=False, default=RoleEnum.athlete)
    
    # Relationships
    organization_memberships = relationship("OrganizationMember", back_populates="user")
    
    profile = relationship("Profile", back_populates="user", uselist=False)
    activities = relationship("Activity", back_populates="athlete")
    planned_workouts = relationship("PlannedWorkout", foreign_keys="PlannedWorkout.user_id", back_populates="user")
    created_planned_workouts = relationship("PlannedWorkout", foreign_keys="PlannedWorkout.created_by_user_id", back_populates="created_by")
    season_plans = relationship("SeasonPlan", foreign_keys="SeasonPlan.athlete_id", back_populates="athlete")
    created_season_plans = relationship("SeasonPlan", foreign_keys="SeasonPlan.coach_id", back_populates="coach")
    
    created_structured_workouts = relationship("StructuredWorkout", back_populates="coach")


class Profile(Base):
    __tablename__ = "profiles"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    gender = Column(String(10), nullable=True)
    birth_date = Column(Date, nullable=True)
    weight = Column(Float, nullable=True)
    hrv_ms = Column(Float, nullable=True)
    ftp = Column(Float, nullable=True)
    lt2 = Column(Float, nullable=True)  # Lactate Threshold 2
    max_hr = Column(Float, nullable=True)
    resting_hr = Column(Float, nullable=True)
    
    # Sports configuration
    sports = Column(JSONB, nullable=True) 
    country = Column(String(100), nullable=True)
    contact_email = Column(String(255), nullable=True)
    contact_number = Column(String(50), nullable=True)
    menstruation_available_to_coach = Column(Boolean, default=False, nullable=True)
    training_days = Column(JSONB, nullable=True)  # e.g. ["monday","tuesday",...]
    main_sport = Column(String(50), nullable=True)
    timezone = Column(String(50), nullable=True)
    preferred_units = Column(String(20), default="metric", nullable=True) # metric, imperial
    week_start_day = Column(String(20), default="monday", nullable=True) # monday, sunday

    user = relationship("User", back_populates="profile")


class ProfileMetricHistory(Base):
    __tablename__ = "profile_metric_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    metric = Column(String(20), nullable=False)   # 'ftp' | 'weight'
    value = Column(Float, nullable=False)
    recorded_at = Column(DateTime, nullable=False)  # date this value became active


class CoachAthleteLink(Base):
    __tablename__ = "coach_athlete_links"

    id = Column(Integer, primary_key=True, index=True)
    coach_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    athlete_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    is_active = Column(Boolean, default=False, nullable=False)
    invite_token = Column(String(64), unique=True, nullable=False, index=True)


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True, index=True)
    athlete_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String(255), nullable=False)
    file_path = Column(String(512), nullable=False)
    file_type = Column(String(10), nullable=False)
    sport = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    distance = Column(Float, nullable=True)
    duration = Column(Float, nullable=True)
    avg_speed = Column(Float, nullable=True)
    average_hr = Column(Float, nullable=True)
    average_watts = Column(Float, nullable=True)

    # User Feedback
    rpe = Column(Float, nullable=True) # 1-10
    notes = Column(Text, nullable=True) # User feedback

    streams = Column(JSONB, nullable=True)

    # Duplicate detection: if set, this activity is a secondary recording of duplicate_of_id
    duplicate_of_id = Column(Integer, ForeignKey("activities.id"), nullable=True, index=True)

    # Soft-delete flag (set when Strava webhook reports deletion)
    is_deleted = Column(Boolean, default=False, server_default="false", nullable=False)

    athlete = relationship("User", back_populates="activities")
    matched_workout = relationship("PlannedWorkout", back_populates="matched_activity", uselist=False)
    duplicate_recordings = relationship("Activity", foreign_keys="Activity.duplicate_of_id", back_populates="duplicate_of", lazy="dynamic")
    duplicate_of = relationship("Activity", foreign_keys="Activity.duplicate_of_id", remote_side="Activity.id", back_populates="duplicate_recordings")


class StructuredWorkout(Base):
    __tablename__ = "structured_workouts"

    id = Column(Integer, primary_key=True, index=True)
    coach_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(String, nullable=True)
    sport_type = Column(String(50), nullable=False) # RUNNING, CYCLING
    structure = Column(JSONB, nullable=False)
    
    # Library features
    tags = Column(JSONB, nullable=True, default=[])
    is_favorite = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    coach = relationship("User", back_populates="created_structured_workouts")


class SeasonPlan(Base):
    __tablename__ = "season_plans"

    id = Column(Integer, primary_key=True, index=True)
    athlete_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    coach_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    sport_type = Column(String(50), nullable=False)
    season_start = Column(Date, nullable=False)
    season_end = Column(Date, nullable=False)
    notes = Column(Text, nullable=True)
    target_metrics = Column(JSONB, nullable=True, default=list)
    goal_races = Column(JSONB, nullable=True, default=list)
    constraints = Column(JSONB, nullable=True, default=list)
    periodization = Column(JSONB, nullable=True, default=dict)
    generated_summary = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    athlete = relationship("User", foreign_keys=[athlete_id], back_populates="season_plans")
    coach = relationship("User", foreign_keys=[coach_id], back_populates="created_season_plans")
    planned_workouts = relationship("PlannedWorkout", back_populates="season_plan")


class ProviderConnection(Base):
    __tablename__ = "provider_connections"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_provider_connection_user_provider"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    provider = Column(String(50), nullable=False, index=True)
    external_athlete_id = Column(String(128), nullable=True)

    encrypted_access_token = Column(Text, nullable=True)
    encrypted_refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    scopes = Column(JSONB, nullable=True)

    status = Column(String(30), nullable=False, default="disconnected")
    last_sync_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ProviderSyncState(Base):
    __tablename__ = "provider_sync_state"
    __table_args__ = (UniqueConstraint("provider", "user_id", name="uq_provider_sync_state_provider_user"),)

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(50), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    cursor = Column(JSONB, nullable=True)
    last_success = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Sync Progress Tracking
    sync_status = Column(String(20), default="idle", nullable=False) # idle, syncing, completed, failed
    sync_progress = Column(Integer, default=0, nullable=False)
    sync_total = Column(Integer, default=0, nullable=False) # Estimated if available
    sync_message = Column(Text, nullable=True)


class ProviderWebhookEvent(Base):
    __tablename__ = "provider_webhook_events"
    __table_args__ = (UniqueConstraint("provider", "event_key", name="uq_provider_webhook_provider_event"),)

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(50), nullable=False, index=True)
    event_key = Column(String(255), nullable=False)
    payload = Column(JSONB, nullable=False)
    received_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    processed_at = Column(DateTime, nullable=True)
    status = Column(String(30), nullable=False, default="received")
    last_error = Column(Text, nullable=True)


class IntegrationAuditLog(Base):
    __tablename__ = "integration_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    provider = Column(String(50), nullable=False, index=True)
    action = Column(String(50), nullable=False)
    status = Column(String(30), nullable=False, default="ok")
    message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class HRVDaily(Base):
    __tablename__ = "hrv_daily"
    __table_args__ = (UniqueConstraint("user_id", "source_provider", "record_date", name="uq_hrv_daily_user_provider_date"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_provider = Column(String(50), nullable=False, index=True)
    external_record_id = Column(String(128), nullable=True)
    record_date = Column(Date, nullable=False, index=True)
    hrv_ms = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class RHRDaily(Base):
    __tablename__ = "rhr_daily"
    __table_args__ = (UniqueConstraint("user_id", "source_provider", "record_date", name="uq_rhr_daily_user_provider_date"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_provider = Column(String(50), nullable=False, index=True)
    external_record_id = Column(String(128), nullable=True)
    record_date = Column(Date, nullable=False, index=True)
    resting_hr = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class SleepSession(Base):
    __tablename__ = "sleep_sessions"
    __table_args__ = (UniqueConstraint("user_id", "source_provider", "external_record_id", name="uq_sleep_session_user_provider_external"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_provider = Column(String(50), nullable=False, index=True)
    external_record_id = Column(String(128), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    duration_seconds = Column(Integer, nullable=False)
    quality_score = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class StressDaily(Base):
    __tablename__ = "stress_daily"
    __table_args__ = (UniqueConstraint("user_id", "source_provider", "record_date", name="uq_stress_daily_user_provider_date"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_provider = Column(String(50), nullable=False, index=True)
    external_record_id = Column(String(128), nullable=True)
    record_date = Column(Date, nullable=False, index=True)
    stress_score = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class CommunicationThread(Base):
    __tablename__ = "communication_threads"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", "athlete_id", name="uq_comm_thread_entity_athlete"),
    )

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(20), nullable=False, index=True)  # activity | workout
    entity_id = Column(Integer, nullable=False, index=True)
    athlete_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    coach_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class CommunicationComment(Base):
    __tablename__ = "communication_comments"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("communication_threads.id"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class CommunicationAcknowledgement(Base):
    __tablename__ = "communication_acknowledgements"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(20), nullable=False, index=True)  # activity | workout
    entity_id = Column(Integer, nullable=False, index=True)
    athlete_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    action = Column(String(40), nullable=False)  # acknowledged | seen | coach_note
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class OrganizationGroupMessage(Base):
    __tablename__ = "organization_group_messages"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class OrganizationCoachMessage(Base):
    __tablename__ = "organization_coach_messages"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    athlete_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    coach_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class DayNote(Base):
    __tablename__ = "day_notes"
    __table_args__ = (
        UniqueConstraint("athlete_id", "date", "author_id", name="uq_day_note_athlete_date_author"),
    )

    id = Column(Integer, primary_key=True, index=True)
    athlete_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
