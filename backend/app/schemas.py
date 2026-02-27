from typing import Optional, Any, List, Union, Literal
from datetime import datetime, date as dt_date

from pydantic import BaseModel, EmailStr, Field, field_validator

from .models import RoleEnum, ComplianceStatusEnum


class OrganizationOut(BaseModel):
    id: int
    name: str
    code: Optional[str] = None
    description: Optional[str] = None
    picture: Optional[str] = None

    class Config:
        from_attributes = True


class OrganizationMemberOut(BaseModel):
    organization: OrganizationOut
    role: str
    status: str

    class Config:
        from_attributes = True


class ProfileOut(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    birth_date: Optional[dt_date] = None
    gender: Optional[str] = None
    weight: Optional[float] = None
    hrv_ms: Optional[float] = None
    ftp: Optional[float] = None
    lt2: Optional[float] = None
    max_hr: Optional[float] = None
    resting_hr: Optional[float] = None
    sports: Optional[list[str]] = None
    zone_settings: Optional[dict[str, Any]] = None
    auto_sync_integrations: bool = True
    main_sport: Optional[str] = None
    timezone: Optional[str] = None
    preferred_units: Optional[str] = None
    week_start_day: Optional[str] = None

    class Config:
        from_attributes = True


class CoachSummaryOut(BaseModel):
    id: int
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    organization_ids: list[int] = []
    organization_names: list[str] = []


class UserOut(BaseModel):
    id: int
    email: EmailStr
    email_verified: bool = False
    role: RoleEnum
    organization_memberships: list[OrganizationMemberOut] = []
    profile: Optional[ProfileOut] = None
    coaches: list[CoachSummaryOut] = []

    class Config:
        from_attributes = True


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    picture: Optional[str] = None


class OrganizationCreate(BaseModel):
    name: str
    description: Optional[str] = None
    picture: Optional[str] = None


class JoinOrganization(BaseModel):
    code: str


class JoinOrganizationRequest(BaseModel):
    organization_id: int = Field(gt=0)


class InvitationRespondRequest(BaseModel):
    action: Literal["accept", "decline"]


class ProfileUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    birth_date: Optional[dt_date] = None
    weight: Optional[float] = None
    hrv_ms: Optional[float] = None
    ftp: Optional[float] = None
    lt2: Optional[float] = None
    max_hr: Optional[float] = None
    resting_hr: Optional[float] = None
    sports: Optional[list[str]] = None
    zone_settings: Optional[dict[str, Any]] = None
    auto_sync_integrations: Optional[bool] = None
    main_sport: Optional[str] = None
    timezone: Optional[str] = None
    preferred_units: Optional[str] = None
    week_start_day: Optional[str] = None

    @field_validator("zone_settings")
    @classmethod
    def validate_zone_settings(cls, value: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ValueError("zone_settings must be an object")

        for sport_key in ("running", "cycling"):
            sport_cfg = value.get(sport_key)
            if sport_cfg is None:
                continue
            if not isinstance(sport_cfg, dict):
                raise ValueError(f"zone_settings.{sport_key} must be an object")

            metric_keys = ("hr", "pace") if sport_key == "running" else ("hr", "power")
            for metric_key in metric_keys:
                metric_cfg = sport_cfg.get(metric_key)
                if metric_cfg is None:
                    continue
                if not isinstance(metric_cfg, dict):
                    raise ValueError(f"zone_settings.{sport_key}.{metric_key} must be an object")

                lt1 = metric_cfg.get("lt1")
                lt2 = metric_cfg.get("lt2")
                if lt1 is not None and lt2 is not None:
                    try:
                        lt1f = float(lt1)
                        lt2f = float(lt2)
                        if metric_key == "pace":
                            if lt2f >= lt1f:
                                raise ValueError(f"zone_settings.{sport_key}.{metric_key} requires lt2 < lt1")
                        else:
                            if lt2f <= lt1f:
                                raise ValueError(f"zone_settings.{sport_key}.{metric_key} requires lt2 > lt1")
                    except (TypeError, ValueError):
                        raise ValueError(f"zone_settings.{sport_key}.{metric_key} lt1/lt2 must be numbers")

                upper_bounds = metric_cfg.get("upper_bounds")
                if upper_bounds is None:
                    continue
                if not isinstance(upper_bounds, list) or len(upper_bounds) == 0:
                    raise ValueError(f"zone_settings.{sport_key}.{metric_key}.upper_bounds must be a non-empty list")

                previous = None
                for idx, raw_bound in enumerate(upper_bounds):
                    try:
                        bound = float(raw_bound)
                    except (TypeError, ValueError):
                        raise ValueError(f"zone_settings.{sport_key}.{metric_key}.upper_bounds[{idx}] must be a number")

                    if previous is not None and bound <= previous:
                        raise ValueError(
                            f"zone_settings.{sport_key}.{metric_key}.upper_bounds must be strictly increasing (no gaps/overlap)"
                        )
                    previous = bound

        return value


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10)
    role: RoleEnum = RoleEnum.athlete
    organization_name: Optional[str] = None 
    organization_code: Optional[str] = None
    first_name: str = Field(min_length=1)
    last_name: str = Field(min_length=1)
    gender: str
    birth_date: dt_date

    @field_validator("first_name", "last_name")
    @classmethod
    def validate_non_empty_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        has_lower = any(ch.islower() for ch in value)
        has_upper = any(ch.isupper() for ch in value)
        has_digit = any(ch.isdigit() for ch in value)
        has_symbol = any(not ch.isalnum() for ch in value)
        if not (has_lower and has_upper and has_digit and has_symbol):
            raise ValueError("password must include upper, lower, number and symbol")
        return value

    @field_validator("birth_date")
    @classmethod
    def validate_birth_date_not_future(cls, value: dt_date) -> dt_date:
        if value > dt_date.today():
            raise ValueError("must not be in the future")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class InviteLinkResponse(BaseModel):
    invite_token: str
    invite_url: str


class InviteByEmailRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class InviteByEmailResponse(BaseModel):
    email: EmailStr
    existing_user: bool
    invite_url: str
    status: str
    message: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10)

    @field_validator("new_password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        has_lower = any(ch.islower() for ch in value)
        has_upper = any(ch.isupper() for ch in value)
        has_digit = any(ch.isdigit() for ch in value)
        has_symbol = any(not ch.isalnum() for ch in value)
        if not (has_lower and has_upper and has_digit and has_symbol):
            raise ValueError("password must include upper, lower, number and symbol")
        return value


class EmailTokenRequest(BaseModel):
    token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=10)

    @field_validator("new_password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        has_lower = any(ch.islower() for ch in value)
        has_upper = any(ch.isupper() for ch in value)
        has_digit = any(ch.isdigit() for ch in value)
        has_symbol = any(not ch.isalnum() for ch in value)
        if not (has_lower and has_upper and has_digit and has_symbol):
            raise ValueError("password must include upper, lower, number and symbol")
        return value


class AthleteOut(BaseModel):
    id: int
    email: EmailStr
    profile: Optional[ProfileOut] = None

    class Config:
        from_attributes = True


class AthletePermissionSettings(BaseModel):
    allow_delete_activities: bool = False
    allow_delete_workouts: bool = False
    allow_edit_workouts: bool = False


class AthletePermissionOut(BaseModel):
    athlete_id: int
    permissions: AthletePermissionSettings


class AthletePermissionUpdate(BaseModel):
    allow_delete_activities: Optional[bool] = None
    allow_delete_workouts: Optional[bool] = None
    allow_edit_workouts: Optional[bool] = None


class ActivityBase(BaseModel):
    filename: str
    created_at: datetime
    file_type: str
    sport: Optional[str] = None
    distance: Optional[float] = None
    duration: Optional[float] = None
    avg_speed: Optional[float] = None
    average_hr: Optional[float] = None
    average_watts: Optional[float] = None
    is_deleted: Optional[bool] = False
    aerobic_load: Optional[float] = None
    anaerobic_load: Optional[float] = None
    total_load_impact: Optional[float] = None
    rpe: Optional[int] = None
    notes: Optional[str] = None

class ActivityOut(ActivityBase):
    id: int
    athlete_id: int
    
    class Config:
        from_attributes = True

class ActivityDetail(ActivityOut):
    streams: Optional[Any] = None
    power_curve: Optional[Any] = None
    hr_zones: Optional[Any] = None
    pace_curve: Optional[Any] = None
    laps: Optional[Any] = None
    splits_metric: Optional[Any] = None
    max_hr: Optional[float] = None
    max_speed: Optional[float] = None
    max_watts: Optional[float] = None
    max_cadence: Optional[float] = None
    avg_cadence: Optional[float] = None
    total_elevation_gain: Optional[float] = None
    total_calories: Optional[float] = None
    planned_comparison: Optional[Any] = None


class SplitAnnotationUpdate(BaseModel):
    split_type: str = Field(pattern="^(metric|laps)$")
    split_index: int = Field(ge=0)
    lactate_mmol_l: Optional[float] = Field(default=None, ge=0.0, le=40.0)
    note: Optional[str] = Field(default=None, max_length=400)


class ActivityUpdate(BaseModel):
    rpe: Optional[int] = Field(default=None, ge=1, le=10)
    notes: Optional[str] = Field(default=None, max_length=2000)
    split_annotations: Optional[List[SplitAnnotationUpdate]] = None

class PlannedWorkoutBase(BaseModel):
    date: dt_date
    title: str
    description: Optional[str] = None
    sport_type: str
    planned_duration: int
    planned_distance: Optional[float] = None
    planned_intensity: Optional[str] = None
    structure: Optional[List[Union['ConcreteStep', 'RepeatStep']]] = None


class PlannedWorkoutCreate(PlannedWorkoutBase):
    pass

class PlannedWorkoutUpdate(BaseModel):
    date: Optional[dt_date] = None
    title: Optional[str] = None
    description: Optional[str] = None
    sport_type: Optional[str] = None
    planned_duration: Optional[int] = None
    planned_distance: Optional[float] = None
    planned_intensity: Optional[str] = None
    structure: Optional[List[Union['ConcreteStep', 'RepeatStep']]] = None

class PlannedWorkoutOut(PlannedWorkoutBase):
    id: int
    user_id: int
    created_by_user_id: Optional[int] = None
    created_by_name: Optional[str] = None
    created_by_email: Optional[str] = None
    matched_activity_id: Optional[int] = None
    compliance_status: ComplianceStatusEnum
    
    class Config:
        from_attributes = True
        use_enum_values = True

class CalendarEvent(BaseModel):
    id: int
    user_id: int
    date: dt_date
    title: str
    sport_type: Optional[str] = None
    duration: Optional[float] = None
    distance: Optional[float] = None
    
    # Type discriminator
    is_planned: bool
    
    # Planned specific
    compliance_status: Optional[ComplianceStatusEnum] = None
    matched_activity_id: Optional[int] = None
    description: Optional[str] = None
    planned_intensity: Optional[str] = None
    planned_duration: Optional[int] = None
    planned_distance: Optional[float] = None
    structure: Optional[List[Union['ConcreteStep', 'RepeatStep']]] = None
    created_by_user_id: Optional[int] = None
    created_by_name: Optional[str] = None
    created_by_email: Optional[str] = None
    
    # Activity specific
    filename: Optional[str] = None
    avg_hr: Optional[float] = None
    avg_watts: Optional[float] = None
    avg_speed: Optional[float] = None
    
    # Sorting helper
    start_time: Optional[datetime] = None


# Structured Workout Schemas
from typing import Literal, Union, List

class DurationConfig(BaseModel):
    type: Literal['time', 'distance', 'lap_button', 'calories']
    value: Optional[float] = None

class TargetConfig(BaseModel):
    type: Literal['heart_rate_zone', 'power', 'pace', 'rpe', 'open', 'heart_rate']
    min: Optional[float] = None
    max: Optional[float] = None
    zone: Optional[int] = None
    value: Optional[float] = None
    unit: Optional[str] = None
    variance: Optional[float] = None

class WorkoutStepBase(BaseModel):
    id: str
    description: Optional[str] = None

class ConcreteStep(WorkoutStepBase):
    type: Literal['block']
    category: Literal['warmup', 'work', 'recovery', 'cooldown']
    duration: DurationConfig
    target: TargetConfig

class RepeatStep(WorkoutStepBase):
    type: Literal['repeat']
    repeats: int
    steps: List[Union[ConcreteStep, 'RepeatStep']]

class StructuredWorkoutCreate(BaseModel):
    title: str
    description: Optional[str] = None
    sport_type: str
    structure: List[Union[ConcreteStep, RepeatStep]]

class StructuredWorkoutOut(StructuredWorkoutCreate):
    id: int
    coach_id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

RepeatStep.model_rebuild()
PlannedWorkoutBase.model_rebuild()
CalendarEvent.model_rebuild()


class ProviderStatusOut(BaseModel):
    provider: str
    display_name: str
    enabled: bool
    configured: bool
    approval_required: bool
    bridge_only: bool
    required_scopes: list[str]
    docs_url: Optional[str] = None
    connection_status: str = "disconnected"
    last_sync_at: Optional[datetime] = None
    last_error: Optional[str] = None


class ProviderConnectOut(BaseModel):
    provider: str
    authorize_url: Optional[str] = None
    status: str
    message: Optional[str] = None


class SyncStatusOut(BaseModel):
    provider: str
    status: str # idle, syncing, completed, failed
    progress: int
    total: int
    message: Optional[str] = None
    last_success: Optional[datetime] = None
    last_error: Optional[str] = None


class ProviderSyncOut(BaseModel):
    provider: str
    imported_activities: int
    duplicate_activities: int
    wellness_updates: dict[str, int]
    status: str
    cursor: Optional[dict] = None


class BridgeWellnessIn(BaseModel):
    provider_record_id: Optional[str] = None
    date: dt_date
    hrv_ms: Optional[float] = None
    resting_hr: Optional[float] = None
    stress_score: Optional[float] = None


class BridgeSleepIn(BaseModel):
    provider_record_id: str
    start_time: datetime
    end_time: datetime
    quality_score: Optional[float] = None


class ManualWellnessIn(BaseModel):
    date: dt_date
    hrv_ms: Optional[float] = None
    resting_hr: Optional[float] = None


class StravaImportPreferencesIn(BaseModel):
    import_all_time: bool


class StravaImportPreferencesOut(BaseModel):
    import_all_time: bool
    default_window_days: int
    daily_request_limit: int


class WellnessSummaryOut(BaseModel):
    hrv: Optional[dict] = None
    resting_hr: Optional[dict] = None
    sleep: Optional[dict] = None
    stress: Optional[dict] = None


class CommunicationCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    athlete_id: Optional[int] = None


class CommunicationCommentOut(BaseModel):
    id: int
    thread_id: int
    author_id: int
    author_role: str
    body: str
    created_at: datetime


class CommunicationThreadOut(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    athlete_id: int
    coach_id: Optional[int] = None
    comments: list[CommunicationCommentOut] = []


class CommunicationAcknowledgementCreate(BaseModel):
    entity_type: str = Field(pattern="^(activity|workout)$")
    entity_id: int = Field(gt=0)
    athlete_id: Optional[int] = None
    action: str = Field(min_length=2, max_length=40)
    note: Optional[str] = Field(default=None, max_length=2000)


class CommunicationAcknowledgementOut(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    athlete_id: int
    actor_id: int
    action: str
    note: Optional[str] = None
    created_at: datetime


class NotificationItemOut(BaseModel):
    id: str
    type: str
    title: str
    message: str
    created_at: datetime
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    organization_id: Optional[int] = None
    athlete_id: Optional[int] = None
    status: Optional[str] = None


class NotificationsFeedOut(BaseModel):
    items: list[NotificationItemOut]


class OrganizationCoachOut(BaseModel):
    id: int
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class OrganizationDiscoverItemOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    picture: Optional[str] = None
    coaches: list[OrganizationCoachOut] = []
    my_membership_status: Optional[str] = None


class OrganizationDiscoverOut(BaseModel):
    items: list[OrganizationDiscoverItemOut]


class OrganizationChatMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class OrganizationChatMessageOut(BaseModel):
    id: int
    organization_id: int
    sender_id: int
    sender_role: str
    sender_name: Optional[str] = None
    body: str
    created_at: datetime


class OrganizationCoachChatMessageOut(BaseModel):
    id: int
    organization_id: int
    athlete_id: int
    coach_id: int
    sender_id: int
    sender_role: str
    sender_name: Optional[str] = None
    body: str
    created_at: datetime
