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
    matched_activity_id = Column(Integer, ForeignKey("activities.id"), nullable=True)
    
    date = Column(Date, nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    sport_type = Column(String(50), nullable=False) # e.g. Cycling, Running
    planned_duration = Column(Integer, nullable=False) # minutes
    planned_distance = Column(Float, nullable=True) # km
    planned_intensity = Column(String(50), nullable=True)
    structure = Column(JSONB, nullable=True)
    
    compliance_status = Column(Enum(ComplianceStatusEnum), default=ComplianceStatusEnum.planned, nullable=False)

    user = relationship("User", back_populates="planned_workouts")
    matched_activity = relationship("Activity", back_populates="matched_workout")


class OrganizationMember(Base):
    __tablename__ = "organization_members"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), primary_key=True)
    role = Column(String(20), nullable=False)  # coach, athlete, admin
    status = Column(String(20), default="active", nullable=False) # active, pending, rejected

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
    role = Column(Enum(RoleEnum), nullable=False, default=RoleEnum.athlete)
    
    # Relationships
    organization_memberships = relationship("OrganizationMember", back_populates="user")
    
    profile = relationship("Profile", back_populates="user", uselist=False)
    activities = relationship("Activity", back_populates="athlete")
    planned_workouts = relationship("PlannedWorkout", back_populates="user")
    
    created_structured_workouts = relationship("StructuredWorkout", back_populates="coach")


class Profile(Base):
    __tablename__ = "profiles"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    gender = Column(String(10), nullable=True)
    birth_date = Column(Date, nullable=True)
    weight = Column(Float, nullable=True)
    ftp = Column(Float, nullable=True)
    lt2 = Column(Float, nullable=True)  # Lactate Threshold 2
    max_hr = Column(Float, nullable=True)
    resting_hr = Column(Float, nullable=True)
    
    # Sports configuration
    sports = Column(JSONB, nullable=True) 
    main_sport = Column(String(50), nullable=True)
    timezone = Column(String(50), nullable=True)
    preferred_units = Column(String(20), default="metric", nullable=True) # metric, imperial
    week_start_day = Column(String(20), default="monday", nullable=True) # monday, sunday

    user = relationship("User", back_populates="profile")


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

    streams = Column(JSONB, nullable=True)

    athlete = relationship("User", back_populates="activities")
    matched_workout = relationship("PlannedWorkout", back_populates="matched_activity", uselist=False)


class StructuredWorkout(Base):
    __tablename__ = "structured_workouts"

    id = Column(Integer, primary_key=True, index=True)
    coach_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(String, nullable=True)
    sport_type = Column(String(50), nullable=False) # RUNNING, CYCLING
    structure = Column(JSONB, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    coach = relationship("User", back_populates="created_structured_workouts")


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
