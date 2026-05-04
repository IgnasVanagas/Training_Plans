# Production Demo Seed Runbook

This runbook covers the one-off demo organization seed implemented in [backend/app/production_demo_seed.py](../backend/app/production_demo_seed.py).

These are Linux VPS shell commands. Do not run them in local Windows PowerShell unless you intentionally target a Linux container runtime from there.

## Safety Rules

- Keep `AUTO_SEED_DEMO=false` in production. This workflow is a one-off command path, not a startup hook.
- Use `docker compose -f docker-compose.prod.yml --env-file .env.production ...` on the VPS. Do not run plain `docker compose up` there.
- Use a stable `--alias-prefix` so reruns target the same 10 demo accounts.
- Capture the JSON output from the real seed command securely. It may contain newly generated passwords.
- The real seed rotates fresh secure passwords for existing demo accounts by default on reruns. Use `--preserve-passwords` only if you intentionally want to keep the current demo credentials.

## What Gets Seeded

- 1 coach account
- 1 admin account that is both global admin and organization admin
- 8 athlete accounts linked to the coach's organization
- Verified email state for all 10 accounts
- 1 season plan per athlete with 2 goal races
- 8 planned workouts per athlete: 4 past and 4 future
- 6 activities per athlete: 4 primary activities and 2 duplicate secondaries
- Seeded organization chat history: group chat, coach-athlete threads, and member direct messages
- Completed compliance examples per athlete: green, yellow/red, missed, and future planned

All personas are fictional and deterministic by email alias.

## Required Inputs

- `--gmail-base`: the inbox you own and want to use with plus-addressing, for example `test98765432987@gmail.com`
- `--alias-prefix`: a stable short token such as `prod-demo-may2026`
- `--organization-name`: optional display name override; defaults to `North Harbour Endurance Collective`

## Dry Run

Run this first on the VPS to confirm the exact email set and record counts:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec backend \
  python -m app.production_demo_seed seed \
  --gmail-base test98765432987@gmail.com \
  --alias-prefix prod-demo-may2026 \
  --organization-name "North Harbour Endurance Collective" \
  --dry-run
```

Expected dry-run behavior:

- No database writes are performed.
- The JSON response lists all 10 derived email addresses.
- Counts show the full planned seed volume before execution.

## Real Seed

After the dry run looks correct, execute the real seed:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec backend \
  python -m app.production_demo_seed seed \
  --gmail-base test98765432987@gmail.com \
  --alias-prefix prod-demo-may2026 \
  --organization-name "North Harbour Endurance Collective" \
  --confirm-production
```

If you intentionally need to keep the current demo passwords on a rerun:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec backend \
  python -m app.production_demo_seed seed \
  --gmail-base test98765432987@gmail.com \
  --alias-prefix prod-demo-may2026 \
  --organization-name "North Harbour Endurance Collective" \
  --confirm-production \
  --preserve-passwords
```

## Purge Preview

Preview the same deterministic account slice before deletion:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec backend \
  python -m app.production_demo_seed purge \
  --gmail-base test98765432987@gmail.com \
  --alias-prefix prod-demo-may2026 \
  --organization-name "North Harbour Endurance Collective" \
  --dry-run
```

## Real Purge

Delete the demo organization and the demo accounts:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec backend \
  python -m app.production_demo_seed purge \
  --gmail-base test98765432987@gmail.com \
  --alias-prefix prod-demo-may2026 \
  --organization-name "North Harbour Endurance Collective" \
  --confirm-production
```

## Spot Checks After Seeding

- Verify the seed JSON shows 10 accounts and captures any newly generated passwords.
- Confirm the coach can see all 8 athletes in the organization roster.
- Confirm the admin account can access global admin tooling and still appears as an organization admin.
- Open at least one athlete calendar and verify past green, yellow/red, and missed workouts alongside future planned workouts.
- Open the organization chat and verify the group thread, coach-athlete threads, and admin/member direct messages are already populated.
- Open one matched activity detail and confirm planned-vs-completed analysis is available.
- Open a duplicated activity pair and confirm the secondary recording is marked as a duplicate.

## Notes

- The command uses the checked-in FIT or GPX files under `backend/uploads/activities` when they are available and suitable. Otherwise it falls back to realistic manual activity rows.
- The seed is deterministic by alias prefix and email set, and every real seed run rotates strong passwords for created or existing demo accounts unless you explicitly preserve them.
- The demo organization is intended to stay isolated from real production accounts through its dedicated email aliases and demo-specific metadata.