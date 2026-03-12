"""
One-time script: add 50 demo athletes linked to the existing coach.
Idempotent – skips athletes whose email already exists.
Run inside the backend container:
    docker-compose exec backend python -m app.seed_50_athletes
"""

import asyncio
import logging
import uuid
from datetime import date
from random import choice, randint, uniform

from sqlalchemy import select

from app.auth import get_password_hash
from app.database import AsyncSessionLocal
from app.models import (
    CoachAthleteLink,
    Organization,
    OrganizationMember,
    Profile,
    RoleEnum,
    User,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FIRST_NAMES = [
    "Janet", "Maria", "Olin", "Brian", "Jeffrey", "Lisa", "Tonya",
    "George", "Sandra", "Kevin", "Diana", "Marcus", "Elena", "Patrick",
    "Yuki", "Andrius", "Sophie", "Carlos", "Fatima", "Liam",
    "Nora", "Tomas", "Aisha", "Riku", "Ingrid", "Felipe",
    "Hana", "Dmitri", "Chloe", "Owen", "Priya", "Mateo",
    "Sara", "Viktor", "Ada", "Lukas", "Mei", "Noah",
    "Zara", "Erik", "Clara", "Hugo", "Amara", "Leo",
    "Dana", "Emil", "Isla", "Kai", "Rosa", "Finn",
]

LAST_NAMES = [
    "Rogers", "Diaz", "Ware", "Barkman", "Gaza", "Burke", "Miler",
    "Harvey", "Chen", "Thompson", "Petrov", "Santos", "Kim", "O'Brien",
    "Tanaka", "Jonaitis", "Laurent", "Garcia", "Hassan", "Murphy",
    "Berg", "Kazlauskas", "Okafor", "Sato", "Lindgren", "Costa",
    "Yamada", "Volkov", "Dubois", "Hughes", "Sharma", "Fernandez",
    "Nilsson", "Kovac", "Turing", "Nori", "Zhou", "Andersen",
    "Al-Farsi", "Holm", "Fischer", "Morales", "Ngozi", "Rossi",
    "Stone", "Virtanen", "Mackenzie", "Takahashi", "Reyes", "Baker",
]

SPORTS = ["running", "cycling"]


async def seed_50_athletes():
    password_hash = get_password_hash("password")

    async with AsyncSessionLocal() as db:
        # Find existing coach
        result = await db.execute(
            select(User).where(User.role == RoleEnum.coach).order_by(User.id.asc())
        )
        coach = result.scalar_one_or_none()
        if not coach:
            logger.error("No coach found in database. Run the main seed first.")
            return

        # Find the organisation the coach belongs to
        result = await db.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == coach.id,
                OrganizationMember.role == "coach",
            )
        )
        coach_membership = result.scalar_one_or_none()
        if not coach_membership:
            logger.error("Coach has no organisation membership.")
            return

        org_id = coach_membership.organization_id
        created = 0

        for i in range(50):
            first = FIRST_NAMES[i % len(FIRST_NAMES)]
            last = LAST_NAMES[i % len(LAST_NAMES)]
            email = f"athlete{i + 1}@example.com"

            # Skip if already exists
            existing = await db.execute(select(User).where(User.email == email))
            if existing.scalar_one_or_none():
                logger.info(f"  skip {email} (exists)")
                continue

            user = User(
                email=email,
                password_hash=password_hash,
                role=RoleEnum.athlete,
            )
            db.add(user)
            await db.flush()  # get user.id

            sport = choice(SPORTS)
            profile = Profile(
                user_id=user.id,
                first_name=first,
                last_name=last,
                gender=choice(["Male", "Female"]),
                birth_date=date(randint(1988, 2002), randint(1, 12), randint(1, 28)),
                weight=round(uniform(52, 90), 1),
                ftp=randint(180, 340) if sport == "cycling" else None,
                lt2=round(uniform(3.2, 5.5), 2) if sport == "running" else None,
                max_hr=randint(175, 205),
                resting_hr=randint(42, 62),
                sports=[sport],
                main_sport=sport,
                timezone="UTC",
            )
            db.add(profile)

            token = f"seed_ath_{uuid.uuid4().hex[:12]}"
            db.add(
                CoachAthleteLink(
                    coach_id=coach.id,
                    athlete_id=user.id,
                    is_active=True,
                    invite_token=token,
                )
            )

            db.add(
                OrganizationMember(
                    user_id=user.id,
                    organization_id=org_id,
                    role="athlete",
                    status="active",
                )
            )

            created += 1
            logger.info(f"  + {first} {last} ({email}) [{sport}]")

        await db.commit()
        logger.info(f"Done – {created} athletes added to coach '{coach.email}' in org {org_id}.")


if __name__ == "__main__":
    asyncio.run(seed_50_athletes())
