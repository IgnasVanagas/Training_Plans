from __future__ import annotations

from datetime import date

from app.models import Profile, User
from app.routers import users as users_router
from app.schemas import ProfileUpdate


def test_build_next_coach_workout_lookup_keeps_earliest_date_per_athlete():
    lookup = users_router._build_next_coach_workout_lookup(
        [
            (10, date(2026, 3, 18)),
            (10, date(2026, 3, 20)),
            (11, date(2026, 3, 19)),
        ]
    )

    assert lookup == {
        10: date(2026, 3, 18),
        11: date(2026, 3, 19),
    }


def test_apply_profile_update_to_user_merges_zone_settings_without_losing_existing_sports():
    athlete = User(id=42, email='athlete@example.com', password_hash='x')
    athlete.profile = Profile(
        user_id=42,
        sports={
            'items': ['running'],
            'zone_settings': {
                'running': {
                    'hr': {
                        'upper_bounds': [120, 135, 150, 165],
                    }
                }
            },
            'integration_settings': {
                'auto_sync_integrations': True,
            },
        },
        ftp=250,
    )

    users_router._apply_profile_update_to_user(
        athlete,
        ProfileUpdate(
            ftp=275,
            zone_settings={
                'cycling': {
                    'power': {
                        'upper_bounds': [150, 200, 240, 280, 320, 380],
                        'lt1': 210,
                        'lt2': 260,
                    }
                }
            },
        ),
    )

    assert athlete.profile.ftp == 275
    assert athlete.profile.sports['items'] == ['running']
    assert athlete.profile.sports['zone_settings'] == {
        'cycling': {
            'power': {
                'upper_bounds': [150, 200, 240, 280, 320, 380],
                'lt1': 210,
                'lt2': 260,
            }
        }
    }
    assert athlete.profile.sports['integration_settings']['auto_sync_integrations'] is True