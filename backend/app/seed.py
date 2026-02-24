import asyncio
import logging
import os
from datetime import datetime, timezone, date
from pathlib import Path
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models import User, Organization, RoleEnum, CoachAthleteLink, Profile, OrganizationMember, Activity
from app.auth import get_password_hash
from app.parsing import parse_activity_file
from app.services.activity_dedupe import sha256_hex, build_fingerprint, extract_source_identity, find_duplicate_activity

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _normalize_created_at(start_time):
    if not start_time:
        return datetime.utcnow()

    created_at = start_time
    if isinstance(created_at, str):
        try:
            created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError:
            return datetime.utcnow()
    elif hasattr(created_at, 'to_pydatetime'):
        created_at = created_at.to_pydatetime()

    if created_at.tzinfo is not None:
        created_at = created_at.astimezone(timezone.utc).replace(tzinfo=None)

    return created_at


async def seed_athlete_activities(db, athletes: list[User]):
    seed_dir = Path(os.getenv("SEED_ACTIVITIES_DIR", "/app/uploads/activities"))

    if not seed_dir.exists() or not seed_dir.is_dir():
        logger.info(f"Activity seed directory not found: {seed_dir}")
        return

    files = sorted(
        [p for p in seed_dir.iterdir() if p.is_file() and p.suffix.lower() in {".fit", ".gpx"}],
        key=lambda p: p.name.lower()
    )

    if not files:
        logger.info("No seed activity files found.")
        return

    if not athletes:
        logger.info("No athlete users found for activity seeding.")
        return

    created_count = 0

    for idx, file_path in enumerate(files):
        athlete = athletes[idx % len(athletes)]
        relative_file_path = f"uploads/activities/{file_path.name}"

        existing = await db.scalar(
            select(Activity).where(
                Activity.athlete_id == athlete.id,
                Activity.file_path == relative_file_path
            )
        )
        if existing:
            continue

        file_type = "fit" if file_path.suffix.lower() == ".fit" else "gpx"
        file_sha256 = sha256_hex(file_path.read_bytes())

        duplicate_by_hash = await find_duplicate_activity(
            db,
            athlete_id=athlete.id,
            file_sha256=file_sha256,
        )
        if duplicate_by_hash:
            continue

        try:
            parsed_data = parse_activity_file(str(file_path), file_type)
        except Exception as exc:
            logger.warning(f"Failed to parse seed activity {file_path.name}: {exc}")
            continue

        if not parsed_data:
            logger.warning(f"Parsed data empty for seed activity {file_path.name}")
            continue

        summary = parsed_data.get("summary", {})
        streams = parsed_data.get("streams", [])
        created_at = _normalize_created_at(parsed_data.get("start_time"))
        source_provider, source_activity_id = extract_source_identity(parsed_data)
        fingerprint_v1 = build_fingerprint(
            sport=parsed_data.get("sport"),
            created_at=created_at,
            duration_s=summary.get("duration"),
            distance_m=summary.get("distance"),
        )

        duplicate = await find_duplicate_activity(
            db,
            athlete_id=athlete.id,
            file_sha256=file_sha256,
            source_provider=source_provider,
            source_activity_id=source_activity_id,
            fingerprint_v1=fingerprint_v1,
            sport=parsed_data.get("sport"),
            created_at=created_at,
            duration_s=summary.get("duration"),
            distance_m=summary.get("distance"),
        )
        if duplicate:
            continue

        composite_streams_data = {
            "data": streams,
            "power_curve": parsed_data.get("power_curve"),
            "hr_zones": parsed_data.get("hr_zones"),
            "pace_curve": parsed_data.get("pace_curve"),
            "laps": parsed_data.get("laps"),
            "splits_metric": parsed_data.get("splits_metric"),
            "_meta": {
                "deleted": False,
                "file_sha256": file_sha256,
                "fingerprint_v1": fingerprint_v1,
                "source_provider": source_provider,
                "source_activity_id": source_activity_id,
            },
            "stats": {
                "max_hr": summary.get("max_hr"),
                "max_speed": summary.get("max_speed"),
                "max_watts": summary.get("max_watts"),
                "max_cadence": summary.get("max_cadence"),
                "avg_cadence": summary.get("avg_cadence"),
                "total_elevation_gain": summary.get("total_elevation_gain"),
                "total_calories": summary.get("total_calories")
            }
        }

        db.add(
            Activity(
                athlete_id=athlete.id,
                filename=file_path.name,
                file_path=relative_file_path,
                file_type=file_type,
                sport=parsed_data.get("sport"),
                created_at=created_at,
                distance=summary.get("distance"),
                duration=summary.get("duration"),
                avg_speed=summary.get("avg_speed"),
                average_hr=summary.get("average_hr"),
                average_watts=summary.get("average_watts"),
                streams=composite_streams_data
            )
        )
        created_count += 1

    if created_count:
        await db.commit()
    logger.info(f"Seeded {created_count} athlete activities from {seed_dir}")

async def seed_data():
    async with AsyncSessionLocal() as db:
        logger.info("Checking for existing data...")
        
        # Check if organization exists
        result = await db.execute(select(Organization).where(Organization.name == "Demo Team"))
        org = result.scalar_one_or_none()
        
        if not org:
            org = Organization(name="Demo Team", settings_json={})
            db.add(org)
            await db.flush()
            logger.info(f"Created organization: {org.name}")
        else:
            logger.info(f"Organization {org.name} already exists")

        def ensure_member(user_id: int, organization_id: int, role: str = "athlete"):
            return select(OrganizationMember).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id
            ), role

        # --- Coach ---
        result = await db.execute(select(User).where(User.email == "coach@example.com"))
        coach = result.scalar_one_or_none()

        if not coach:
            coach = User(
                email="coach@example.com",
                password_hash=get_password_hash("password"),
                role=RoleEnum.coach
            )
            db.add(coach)
            await db.flush()

            logger.info("Created Coach: coach@example.com / password")
        else:
            coach.password_hash = get_password_hash("password")
            coach.role = RoleEnum.coach
            logger.info("Coach already exists - reset password to default")

        result = await db.execute(select(Profile).where(Profile.user_id == coach.id))
        coach_profile = result.scalar_one_or_none()
        if not coach_profile:
            coach_profile = Profile(user_id=coach.id)
            db.add(coach_profile)

        coach_profile.first_name = "Demo"
        coach_profile.last_name = "Coach"
        coach_profile.birth_date = date(1988, 4, 12)
        coach_profile.gender = "Male"
        coach_profile.weight = 75.0
        coach_profile.ftp = 280
        coach_profile.max_hr = 190
        coach_profile.resting_hr = 50
        coach_profile.sports = ["cycling", "running"]
        coach_profile.main_sport = "cycling"
        coach_profile.timezone = "UTC"

        member_query, member_role = ensure_member(coach.id, org.id, "coach")
        result = await db.execute(member_query)
        coach_member = result.scalar_one_or_none()
        if not coach_member:
            db.add(OrganizationMember(user_id=coach.id, organization_id=org.id, role=member_role, status="active"))
        
        # --- Cyclist ---
        result = await db.execute(select(User).where(User.email == "cyclist@example.com"))
        cyclist = result.scalar_one_or_none()
        
        if not cyclist:
            cyclist = User(
                email="cyclist@example.com",
                password_hash=get_password_hash("password"),
                role=RoleEnum.athlete
            )
            db.add(cyclist)
            await db.flush()

            # Link to coach
            if coach:
                 link1 = CoachAthleteLink(coach_id=coach.id, athlete_id=cyclist.id, is_active=True, invite_token="seed_cyclist")
                 db.add(link1)
            
            logger.info("Created Cyclist: cyclist@example.com / password")
        else:
            cyclist.password_hash = get_password_hash("password")
            cyclist.role = RoleEnum.athlete
            logger.info("Cyclist already exists - reset password to default")

        result = await db.execute(select(Profile).where(Profile.user_id == cyclist.id))
        cyclist_profile = result.scalar_one_or_none()
        if not cyclist_profile:
            cyclist_profile = Profile(user_id=cyclist.id)
            db.add(cyclist_profile)

        cyclist_profile.first_name = "Alex"
        cyclist_profile.last_name = "Cyclist"
        cyclist_profile.birth_date = date(1994, 7, 23)
        cyclist_profile.gender = "Male"
        cyclist_profile.weight = 70.0
        cyclist_profile.ftp = 300
        cyclist_profile.max_hr = 185
        cyclist_profile.resting_hr = 55
        cyclist_profile.sports = ["cycling"]
        cyclist_profile.main_sport = "cycling"
        cyclist_profile.timezone = "Europe/Paris"

        member_query, member_role = ensure_member(cyclist.id, org.id, "athlete")
        result = await db.execute(member_query)
        cyclist_member = result.scalar_one_or_none()
        if not cyclist_member:
            db.add(OrganizationMember(user_id=cyclist.id, organization_id=org.id, role=member_role, status="active"))

        result = await db.execute(select(CoachAthleteLink).where(CoachAthleteLink.invite_token == "seed_cyclist"))
        if not result.scalar_one_or_none() and coach:
            db.add(CoachAthleteLink(coach_id=coach.id, athlete_id=cyclist.id, is_active=True, invite_token="seed_cyclist"))

        # --- Runner ---
        result = await db.execute(select(User).where(User.email == "runner@example.com"))
        runner = result.scalar_one_or_none()

        if not runner:
            runner = User(
                email="runner@example.com",
                password_hash=get_password_hash("password"),
                role=RoleEnum.athlete
            )
            db.add(runner)
            await db.flush()

            # Link to coach
            if coach:
                link2 = CoachAthleteLink(coach_id=coach.id, athlete_id=runner.id, is_active=True, invite_token="seed_runner")
                db.add(link2)
            
            logger.info("Created Runner: runner@example.com / password")
        else:
            runner.password_hash = get_password_hash("password")
            runner.role = RoleEnum.athlete
            logger.info("Runner already exists - reset password to default")

        result = await db.execute(select(Profile).where(Profile.user_id == runner.id))
        runner_profile = result.scalar_one_or_none()
        if not runner_profile:
            runner_profile = Profile(user_id=runner.id)
            db.add(runner_profile)

        runner_profile.first_name = "Mia"
        runner_profile.last_name = "Runner"
        runner_profile.birth_date = date(1996, 2, 9)
        runner_profile.gender = "Female"
        runner_profile.weight = 62.0
        runner_profile.lt2 = 3.75
        runner_profile.max_hr = 195
        runner_profile.resting_hr = 48
        runner_profile.sports = ["running"]
        runner_profile.main_sport = "running"
        runner_profile.timezone = "America/New_York"

        member_query, member_role = ensure_member(runner.id, org.id, "athlete")
        result = await db.execute(member_query)
        runner_member = result.scalar_one_or_none()
        if not runner_member:
            db.add(OrganizationMember(user_id=runner.id, organization_id=org.id, role=member_role, status="active"))

        result = await db.execute(select(CoachAthleteLink).where(CoachAthleteLink.invite_token == "seed_runner"))
        if not result.scalar_one_or_none() and coach:
            db.add(CoachAthleteLink(coach_id=coach.id, athlete_id=runner.id, is_active=True, invite_token="seed_runner"))

        await db.commit()

        athlete_users_result = await db.execute(
            select(User).where(User.role == RoleEnum.athlete).order_by(User.id.asc())
        )
        athlete_users = athlete_users_result.scalars().all()
        await seed_athlete_activities(db, athlete_users)

        logger.info("Seeding complete.")

if __name__ == "__main__":
    asyncio.run(seed_data())
