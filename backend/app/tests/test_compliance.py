from __future__ import annotations

from datetime import date

from app.models import ComplianceStatusEnum, PlannedWorkout
from app.services import compliance as compliance_service


def test_default_unmatched_compliance_status_marks_past_rest_day_as_complete():
    workout = PlannedWorkout(
        title="Rest Day",
        sport_type="Rest",
        planned_duration=0,
        planned_intensity="Rest",
    )

    status = compliance_service._default_compliance_status_for_unmatched_workout(
        workout,
        date(2026, 3, 30),
        today=date(2026, 4, 3),
    )

    assert status == ComplianceStatusEnum.completed_green


def test_default_unmatched_compliance_status_marks_past_training_day_as_missed():
    workout = PlannedWorkout(
        title="Endurance Ride",
        sport_type="Cycling",
        planned_duration=90,
        planned_intensity="Endurance",
    )

    status = compliance_service._default_compliance_status_for_unmatched_workout(
        workout,
        date(2026, 3, 30),
        today=date(2026, 4, 3),
    )

    assert status == ComplianceStatusEnum.missed