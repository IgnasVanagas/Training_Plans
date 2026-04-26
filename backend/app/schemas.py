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
    is_admin: bool = False
    message: Optional[str] = None

    class Config:
        from_attributes = True


class ProfileOut(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    birth_date: Optional[dt_date] = None
    gender: Optional[str] = None
    weight: Optional[float] = None
    country: Optional[str] = None
    contact_email: Optional[str] = None
    contact_number: Optional[str] = None
    menstruation_available_to_coach: Optional[bool] = None
    training_days: Optional[list[str]] = None
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
    preferred_language: Optional[str] = None
    preferred_units: Optional[str] = None
    week_start_day: Optional[str] = None
    picture: Optional[str] = None

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
    message: Optional[str] = Field(default=None, max_length=500)


class InvitationRespondRequest(BaseModel):
    action: Literal["accept", "decline"]


class ProfileUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    birth_date: Optional[dt_date] = None
    gender: Optional[str] = None
    weight: Optional[float] = None
    country: Optional[str] = None
    contact_email: Optional[str] = None
    contact_number: Optional[str] = None
    menstruation_available_to_coach: Optional[bool] = None
    training_days: Optional[list[str]] = None
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
    preferred_language: Optional[str] = None
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
    message: Optional[str] = Field(default=None, max_length=500)

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


class SupportRequestCreate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    email: EmailStr
    subject: Optional[str] = Field(default=None, max_length=160)
    message: str = Field(min_length=10, max_length=4000)
    page_url: Optional[str] = Field(default=None, max_length=600)
    error_message: Optional[str] = Field(default=None, max_length=1000)
    bot_trap: Optional[str] = Field(default=None, max_length=255)
    client_elapsed_ms: int = Field(default=0, ge=0, le=300000)

    @field_validator("name", "subject", "page_url", "error_message", "bot_trap")
    @classmethod
    def trim_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("email")
    @classmethod
    def normalize_support_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()

    @field_validator("message")
    @classmethod
    def validate_support_message(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 10:
            raise ValueError("message must be at least 10 characters")
        return cleaned


class SupportRequestResponse(BaseModel):
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
    has_upcoming_coach_workout: bool = False
    next_coach_workout_date: Optional[dt_date] = None
    pending_message: Optional[str] = None

    class Config:
        from_attributes = True


class CoachOperationsAthleteOut(BaseModel):
    athlete_id: int
    athlete_name: str
    athlete_email: EmailStr
    main_sport: Optional[str] = None
    last_activity_date: Optional[dt_date] = None
    days_since_last_activity: Optional[int] = None
    last_7d_load: float
    previous_28d_weekly_avg_load: float
    acwr: float
    planned_7d_minutes: float
    completed_7d_minutes: float
    overdue_planned_count: int
    missed_compliance_count: int
    risk_score: int
    risk_level: Literal["low", "moderate", "high"]
    at_risk: bool
    exception_reasons: list[str] = Field(default_factory=list)
    workload_delta_minutes: float
    workload_recommendation: Optional[str] = None


class CoachOperationsWorkloadBalanceOut(BaseModel):
    target_weekly_minutes: float
    avg_weekly_minutes: float
    overloaded_athletes: int
    underloaded_athletes: int
    balanced_athletes: int


class CoachOperationsOut(BaseModel):
    generated_at: datetime
    athletes: list[CoachOperationsAthleteOut]
    exception_queue: list[CoachOperationsAthleteOut]
    at_risk_athletes: list[CoachOperationsAthleteOut]
    workload_balance: CoachOperationsWorkloadBalanceOut


class AthletePermissionSettings(BaseModel):
    allow_delete_activities: bool = True
    allow_delete_workouts: bool = True
    allow_edit_workouts: bool = True
    allow_export_calendar: bool = True
    allow_public_calendar_share: bool = True
    require_workout_approval: bool = False


class AthletePermissionOut(BaseModel):
    athlete_id: int
    permissions: AthletePermissionSettings


class AthletePermissionUpdate(BaseModel):
    allow_delete_activities: Optional[bool] = None
    allow_delete_workouts: Optional[bool] = None
    allow_edit_workouts: Optional[bool] = None
    allow_export_calendar: Optional[bool] = None
    allow_public_calendar_share: Optional[bool] = None
    require_workout_approval: Optional[bool] = None


class ActivityBase(BaseModel):
    filename: str
    created_at: datetime
    local_date: Optional[dt_date] = None
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
    lactate_mmol_l: Optional[float] = None
    notes: Optional[str] = None

class ActivityOut(ActivityBase):
    id: int
    athlete_id: int
    duplicate_of_id: Optional[int] = None
    duplicate_recordings_count: Optional[int] = None
    source_provider: Optional[str] = None
    moving_time: Optional[float] = None

    class Config:
        from_attributes = True


class ActivityManualCreate(BaseModel):
    sport: str = Field(max_length=50)
    date: dt_date
    duration: float = Field(gt=0, description="Duration in seconds")
    distance: Optional[float] = Field(default=None, ge=0, description="Distance in km")
    average_hr: Optional[float] = Field(default=None, ge=20, le=250)
    average_watts: Optional[float] = Field(default=None, ge=0, le=3000)
    rpe: Optional[int] = Field(default=None, ge=1, le=10)
    notes: Optional[str] = Field(default=None, max_length=2000)


class ActivityDetail(ActivityOut):
    streams: Optional[Any] = None
    power_curve: Optional[Any] = None
    hr_zones: Optional[Any] = None
    pace_curve: Optional[Any] = None
    best_efforts: Optional[Any] = None
    personal_records: Optional[Any] = None
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
    ftp_at_time: Optional[float] = None
    weight_at_time: Optional[float] = None
    strava_activity_url: Optional[str] = None


class SplitAnnotationUpdate(BaseModel):
    split_type: str = Field(pattern="^(metric|laps)$")
    split_index: int = Field(ge=0)
    rpe: Optional[int] = Field(default=None, ge=1, le=10)
    lactate_mmol_l: Optional[float] = Field(default=None, ge=0.0, le=40.0)
    note: Optional[str] = Field(default=None, max_length=400)


class ActivityUpdate(BaseModel):
    rpe: Optional[int] = Field(default=None, ge=1, le=10)
    lactate_mmol_l: Optional[float] = Field(default=None, ge=0.0, le=40.0)
    notes: Optional[str] = Field(default=None, max_length=2000)
    split_annotations: Optional[List[SplitAnnotationUpdate]] = None


class WorkoutRecurrenceRule(BaseModel):
    frequency: Literal['weekly'] = 'weekly'
    interval_weeks: int = Field(default=1, ge=1, le=12)
    weekdays: List[int] = Field(min_length=1, max_length=7)
    span_weeks: Optional[int] = Field(default=None, ge=1, le=104)
    end_date: Optional[dt_date] = None
    exception_dates: List[dt_date] = Field(default_factory=list)
    series_id: Optional[str] = Field(default=None, max_length=64)
    anchor_date: Optional[dt_date] = None
    occurrence_index: Optional[int] = Field(default=None, ge=1)
    occurrences_total: Optional[int] = Field(default=None, ge=1)

    @field_validator('weekdays')
    @classmethod
    def validate_weekdays(cls, value: List[int]) -> List[int]:
        normalized = sorted({int(day) for day in value})
        if not normalized:
            raise ValueError('At least one weekday is required')
        for day in normalized:
            if day < 0 or day > 6:
                raise ValueError('Weekdays must use 0-6, where 0 is Monday')
        return normalized

class PlannedWorkoutBase(BaseModel):
    date: dt_date
    title: str
    description: Optional[str] = None
    sport_type: str
    planned_duration: int
    planned_distance: Optional[float] = None
    planned_intensity: Optional[str] = None
    structure: Optional[List[Union['ConcreteStep', 'RepeatStep']]] = None
    season_plan_id: Optional[int] = None
    planning_context: Optional[dict[str, Any]] = None
    recurrence: Optional[WorkoutRecurrenceRule] = None


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
    season_plan_id: Optional[int] = None
    planning_context: Optional[dict[str, Any]] = None
    recurrence: Optional[WorkoutRecurrenceRule] = None

class PlannedWorkoutOut(PlannedWorkoutBase):
    id: int
    user_id: int
    created_by_user_id: Optional[int] = None
    created_by_name: Optional[str] = None
    created_by_email: Optional[str] = None
    matched_activity_id: Optional[int] = None
    compliance_status: ComplianceStatusEnum
    approval_status: Optional[Literal['pending', 'approved', 'rejected']] = None
    approval_request_type: Optional[Literal['create', 'update', 'delete']] = None
    approval_requested_by_user_id: Optional[int] = None
    approval_requested_by_name: Optional[str] = None
    approval_requested_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True
        use_enum_values = True


class PlannedWorkoutVersionDiffItemOut(BaseModel):
    field: str
    before: Any = None
    after: Any = None


class PlannedWorkoutVersionOut(BaseModel):
    id: int
    workout_id: int
    version_number: int
    action: str
    changed_by_user_id: Optional[int] = None
    changed_by_name: Optional[str] = None
    changed_at: datetime
    note: Optional[str] = None
    diff: list[PlannedWorkoutVersionDiffItemOut] = []


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
    season_plan_id: Optional[int] = None
    planning_context: Optional[dict[str, Any]] = None
    recurrence: Optional[WorkoutRecurrenceRule] = None
    approval_status: Optional[Literal['pending', 'approved', 'rejected']] = None
    approval_request_type: Optional[Literal['create', 'update', 'delete']] = None
    approval_requested_by_user_id: Optional[int] = None
    approval_requested_by_name: Optional[str] = None
    approval_requested_at: Optional[datetime] = None
    
    # Activity specific
    filename: Optional[str] = None
    avg_hr: Optional[float] = None
    avg_watts: Optional[float] = None
    avg_speed: Optional[float] = None
    duplicate_recordings_count: Optional[int] = None
    training_load: Optional[float] = None

    # Sorting helper
    start_time: Optional[datetime] = None


class TrendDataPoint(BaseModel):
    date: str
    fitness: float    # 42-day exponential avg (open-source equiv of CTL)
    fatigue: float    # 7-day exponential avg (open-source equiv of ATL)
    form: float       # fitness − fatigue (open-source equiv of TSB)
    load: float       # daily aerobic + anaerobic load


class PerformanceTrendResponse(BaseModel):
    data: List[TrendDataPoint]


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
    tags: Optional[List[str]] = None
    is_favorite: Optional[bool] = False

class StructuredWorkoutUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    sport_type: Optional[str] = None
    structure: Optional[List[Union[ConcreteStep, RepeatStep]]] = None
    tags: Optional[List[str]] = None
    is_favorite: Optional[bool] = None

class StructuredWorkoutOut(StructuredWorkoutCreate):
    id: int
    coach_id: int
    tags: List[str] = []
    is_favorite: bool = False
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

RepeatStep.model_rebuild()
PlannedWorkoutBase.model_rebuild()
CalendarEvent.model_rebuild()


class PlannerTargetMetric(BaseModel):
    metric: str
    value: Union[str, float]
    unit: Optional[str] = None


class PlannerGoalRace(BaseModel):
    name: str
    date: dt_date
    priority: Literal['A', 'B', 'C'] = 'C'
    sport_type: Optional[str] = None
    distance_km: Optional[float] = None
    expected_time: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    target_metrics: List[PlannerTargetMetric] = Field(default_factory=list)


class PlannerConstraint(BaseModel):
    name: Optional[str] = None
    kind: Literal['injury', 'travel', 'sickness', 'unavailable']
    start_date: dt_date
    end_date: dt_date
    severity: Literal['low', 'moderate', 'high'] = 'moderate'
    impact: Literal['reduce', 'avoid_intensity', 'rest'] = 'reduce'
    notes: Optional[str] = None


class PeriodizationConfig(BaseModel):
    weekly_hours_target: float = Field(default=8.0, ge=1.0, le=40.0)
    longest_session_minutes: int = Field(default=180, ge=30, le=600)
    training_days_per_week: int = Field(default=5, ge=2, le=7)
    recovery_week_frequency: int = Field(default=4, ge=2, le=6)
    taper_profile: Literal['short', 'standard', 'extended'] = 'standard'
    periodization_model: Literal['polarized', 'pyramidal', 'threshold'] = 'polarized'


class SeasonPlanBase(BaseModel):
    name: str
    sport_type: str
    season_start: dt_date
    season_end: dt_date
    notes: Optional[str] = None
    target_metrics: List[PlannerTargetMetric] = Field(default_factory=list)
    goal_races: List[PlannerGoalRace] = Field(default_factory=list)
    constraints: List[PlannerConstraint] = Field(default_factory=list)
    periodization: PeriodizationConfig = Field(default_factory=PeriodizationConfig)


class SeasonPlanSaveRequest(SeasonPlanBase):
    id: Optional[int] = None


class SeasonPlanOut(SeasonPlanBase):
    id: int
    athlete_id: int
    coach_id: Optional[int] = None
    generated_summary: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SeasonPlanPreviewOut(BaseModel):
    countdowns: List[dict[str, Any]] = Field(default_factory=list)
    season_blocks: List[dict[str, Any]] = Field(default_factory=list)
    macro_cycles: List[dict[str, Any]] = Field(default_factory=list)
    meso_cycles: List[dict[str, Any]] = Field(default_factory=list)
    micro_cycles: List[dict[str, Any]] = Field(default_factory=list)
    generated_workouts: List[dict[str, Any]] = Field(default_factory=list)
    load_progression: List[dict[str, Any]] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)


class SeasonPlanApplyResponse(BaseModel):
    plan_id: int
    athlete_id: int
    created_count: int
    replaced_count: int
    skipped_count: int
    preserved_manual_count: int
    preview: SeasonPlanPreviewOut


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
    history_imported: bool = False


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
    member_count: int = 0


class OrganizationDiscoverOut(BaseModel):
    items: list[OrganizationDiscoverItemOut]


class OrganizationChatMessageCreate(BaseModel):
    body: str = Field(min_length=0, max_length=2000)
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None


class OrganizationChatMessageOut(BaseModel):
    id: int
    organization_id: int
    sender_id: int
    sender_role: str
    sender_name: Optional[str] = None
    sender_picture: Optional[str] = None
    body: str
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None
    created_at: datetime


class OrganizationCoachChatMessageOut(BaseModel):
    id: int
    organization_id: int
    athlete_id: int
    coach_id: int
    sender_id: int
    sender_role: str
    sender_name: Optional[str] = None
    sender_picture: Optional[str] = None
    body: str
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None
    created_at: datetime


class OrgMemberOut(BaseModel):
    id: int
    email: str
    role: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    picture: Optional[str] = None


class OrgMemberWithAdminOut(BaseModel):
    id: int
    email: str
    role: str
    status: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    picture: Optional[str] = None
    is_admin: bool = False


class OrgSettingsOut(BaseModel):
    id: int
    name: str
    code: Optional[str] = None
    description: Optional[str] = None
    picture: Optional[str] = None
    creator_id: Optional[int] = None
    members: list[OrgMemberWithAdminOut] = []


class OrgUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)


class OrgAdminUpdateRequest(BaseModel):
    is_admin: bool


class OrganizationInboxThreadOut(BaseModel):
    key: str
    thread_type: Literal["group", "coach", "member"]
    participant_id: Optional[int] = None
    participant_role: Optional[str] = None
    participant_name: Optional[str] = None
    participant_picture: Optional[str] = None
    body_preview: Optional[str] = None
    attachment_name: Optional[str] = None
    sender_id: Optional[int] = None
    created_at: Optional[datetime] = None


class OrganizationInboxOut(BaseModel):
    items: list[OrganizationInboxThreadOut]


class OrganizationDirectMessageCreate(BaseModel):
    body: str = Field(min_length=0, max_length=2000)
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None


class OrganizationDirectMessageOut(BaseModel):
    id: int
    organization_id: int
    sender_id: int
    recipient_id: int
    sender_name: Optional[str] = None
    sender_picture: Optional[str] = None
    sender_role: str
    body: str
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None
    created_at: datetime


# --- Day Notes ---

class DayNoteOut(BaseModel):
    id: int
    athlete_id: int
    author_id: int
    author_name: Optional[str] = None
    author_role: Optional[str] = None
    date: dt_date
    content: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DayNoteUpsert(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


class CalendarShareSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    include_completed: Optional[bool] = None
    include_descriptions: Optional[bool] = None


class CalendarShareSettingsOut(BaseModel):
    athlete_id: int
    enabled: bool = False
    token: Optional[str] = None
    include_completed: bool = False
    include_descriptions: bool = False


class CalendarApprovalSummaryOut(BaseModel):
    workout_id: int
    athlete_id: int
    athlete_name: str
    title: str
    date: dt_date
    sport_type: Optional[str] = None
    request_type: Literal['create', 'update', 'delete']
    requested_by_user_id: int
    requested_by_name: Optional[str] = None
    requested_at: datetime
    proposed_changes: Optional[dict[str, Any]] = None


class CalendarApprovalDecisionRequest(BaseModel):
    decision: Literal['approve', 'reject']
    note: Optional[str] = Field(default=None, max_length=1000)


class CalendarApprovalDecisionResponse(BaseModel):
    workout_id: int
    status: Literal['approved', 'rejected']
    deleted: bool = False


class PublicCalendarMetaOut(BaseModel):
    athlete_name: str
    include_completed: bool = False
    include_descriptions: bool = False


class PublicCalendarResponse(BaseModel):
    meta: PublicCalendarMetaOut
    events: List[CalendarEvent]
