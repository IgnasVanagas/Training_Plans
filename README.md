# Endurance Sports Management Platform (MVP)

## Features

- **Activity Tracking**: Upload and view detailed analysis of your rides and runs (via `.fit` or `.gpx` files).
- **Training Calendar**: Plan your workouts with a drag-and-drop calendar.
- **Compliance Monitoring**: Automatically match uploaded activities to planned workouts.
  - 🟢 Green: Executed as planned (<10% deviation)
  - 🟡 Yellow: Minor deviation (<20%)
  - 🔴 Red: Major deviation or Missed
- **Coach/Athlete Roles**: Coaches can invite athletes and view their data.

## Quick start

```bash
docker-compose up --build
```

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000/docs

## Render deployment

This repository now includes [render.yaml](render.yaml) for Render Blueprint deploys from the repo root.

Recommended layout on Render:

- Static site for the frontend from `frontend/`
- Docker web service for the backend from `backend/`
- Managed Postgres database

Important production values:

- `FRONTEND_BASE_URL`: your frontend public URL, for example `https://training-plans-frontend.onrender.com`
- `ALLOWED_ORIGINS`: your frontend public URL, or a comma-separated list if you have multiple allowed origins
- `VITE_API_URL`: your backend public URL, for example `https://training-plans-backend.onrender.com`
- `STRAVA_REDIRECT_URI`: must match your backend public callback URL, for example `https://training-plans-backend.onrender.com/integrations/strava/callback`

Notes:

- The backend accepts Render Postgres connection strings and normalizes them for SQLAlchemy async usage.
- Uploaded activity files are stored under `/app/uploads`, so the Render backend service attaches a persistent disk there.
- `AUTO_SEED_DEMO` should remain `false` in production unless you intentionally want demo data.

## Safe GitHub publishing

Before creating your first public commit/push, follow `PUBLISHING_CHECKLIST.md`.

At minimum:

- keep real credentials only in local `.env` files
- commit only template files such as `.env.example`
- run a secret scan before pushing

### Development DB persistence

- PostgreSQL data is persisted in the Docker named volume `db_data`.
- Your local dev data will survive `docker-compose up --build` and container restarts.
- Data is removed only if you explicitly run `docker-compose down -v` (or remove `db_data`).

### Database backups (Windows / PowerShell)

- Create backup:
   - `./scripts/backup-db.ps1`
   - or custom path: `./scripts/backup-db.ps1 -OutputPath backups/my-backup.sql`
- Restore backup:
   - `./scripts/restore-db.ps1 -InputPath backups/my-backup.sql`

## Development

- **Frontend**: React, TypeScript, Vite, Mantine UI
- **Backend**: FastAPI, SQLAlchemy, AsyncPG
- **Database**: PostgreSQL

## Usage

1. **Register/Login**: Create an account.
2. **Dashboard**:
   - **Activities Tab**: Upload `.fit` files.
   - **Training Plan Tab**: Click on a date to schedule a workout.
3. **Compliance**:
   - Upload an activity that matches a planned workout (same date & sport).
   - The calendar event will update its color based on compliance.

## Wearable Integrations

### Integration Matrix

| Provider | Activities | HRV | Resting HR | Sleep | Stress | Approval Required | Current Status |
|---|---:|---:|---:|---:|---:|---|---|
| Strava | ✅ | ❌ | ❌ | ❌ | ❌ | No | Fully integrated (OAuth + sync + webhook receiver) |
| Polar AccessLink | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | Yes | Scaffolded (pending partner approval) |
| Suunto Partner API | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | Yes | Scaffolded (pending partner approval) |
| WHOOP | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | Yes | Scaffolded (pending partner approval) |
| Garmin Health API | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | Yes | Scaffolded (pending partner approval) |
| COROS | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | Yes | Scaffolded (pending partner approval) |
| Google Fit (bridge) | ✅ (bridge) | ✅ (bridge) | ✅ (bridge) | ✅ (bridge) | ✅ (bridge) | No (bridge flow) | Bridge ingestion endpoints implemented |
| Apple Health (bridge) | ✅ (bridge) | ✅ (bridge) | ✅ (bridge) | ✅ (bridge) | ✅ (bridge) | No (bridge flow) | Bridge ingestion endpoints implemented |

`✅` = implemented now, `⚠️` = scaffolded with production-safe disabled path and docs link.

### Backend Endpoints

- `GET /integrations/providers`
- `GET /integrations/{provider}/connect`
- `GET /integrations/{provider}/callback`
- `POST /integrations/{provider}/disconnect`
- `GET /integrations/{provider}/status`
- `POST /integrations/{provider}/sync-now`
- `GET /integrations/{provider}/webhook` (challenge/verification)
- `POST /integrations/{provider}/webhook`
- `POST /integrations/{provider}/bridge/wellness` (Google Fit / Apple Health)
- `POST /integrations/{provider}/bridge/sleep` (Google Fit / Apple Health)
- `GET /integrations/wellness/summary`

### Environment Variables

Feature flags:

- `ENABLE_STRAVA_INTEGRATION`
- `ENABLE_POLAR_INTEGRATION`
- `ENABLE_SUUNTO_INTEGRATION`
- `ENABLE_WHOOP_INTEGRATION`
- `ENABLE_GARMIN_INTEGRATION`
- `ENABLE_COROS_INTEGRATION`
- `ENABLE_GOOGLE_FIT_INTEGRATION`
- `ENABLE_APPLE_HEALTH_INTEGRATION`

Secrets/config:

- `INTEGRATIONS_TOKEN_ENCRYPTION_KEY`
- `SECRET_KEY`
- `ACCESS_TOKEN_EXPIRE_MINUTES` (default `60`)
- `JWT_ISSUER` (default `endurance-platform`)
- `JWT_AUDIENCE` (default `endurance-client`)
- `ALLOWED_ORIGINS` (comma-separated frontend origins)
- `ALLOW_SELF_REGISTER_COACH` (default `false`)
- `AUTH_COOKIE_SECURE` (set `true` in HTTPS production)
- `EXPOSE_AUTH_DEBUG_LINKS` (default `false`; only enable for local development if you intentionally want reset/verification links returned in API responses)
- `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI`, `STRAVA_WEBHOOK_VERIFY_TOKEN`
- `POLAR_CLIENT_ID`, `POLAR_CLIENT_SECRET`, `POLAR_REDIRECT_URI`
- `SUUNTO_CLIENT_ID`, `SUUNTO_CLIENT_SECRET`, `SUUNTO_REDIRECT_URI`
- `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`
- `GARMIN_CLIENT_ID`, `GARMIN_CLIENT_SECRET`, `GARMIN_REDIRECT_URI`
- `COROS_CLIENT_ID`, `COROS_CLIENT_SECRET`, `COROS_REDIRECT_URI`
- `GOOGLE_FIT_CLIENT_ID`, `GOOGLE_FIT_CLIENT_SECRET`, `GOOGLE_FIT_REDIRECT_URI`
- `APPLE_HEALTH_CLIENT_ID`, `APPLE_HEALTH_CLIENT_SECRET`, `APPLE_HEALTH_REDIRECT_URI`

Strava sync tuning (optional):

- `STRAVA_INITIAL_SYNC_MAX_ACTIVITIES` (default `50`, clamped `20-50` for fast first sync)
- `STRAVA_SYNC_MAX_ACTIVITIES` (default `50`, clamped `20-50`; every sync always fetches newest activities first)
- `STRAVA_FULL_HISTORY_ENABLED` (default `true`)
- `STRAVA_BACKFILL_BATCH_ACTIVITIES` (default `100` per backfill phase)
- `STRAVA_BACKFILL_REQUEST_DELAY_SECONDS` (default `2.0` between Strava history requests)
- `STRAVA_DAILY_REQUEST_LIMIT` (default `500`, hard cap for Strava API calls per UTC day during import)
- `STRAVA_MAX_REQUESTS_PER_MINUTE` (default `50`, hard-capped at `50`; runtime throttle across Strava requests)
- `STRAVA_AUTO_BACKFILL_CONTINUE` (default `true`, chain backfill phases in one background run)
- `STRAVA_AUTO_BACKFILL_DELAY_SECONDS` (default `8`, pause between backfill phases)
- `STRAVA_AUTO_BACKFILL_MAX_PHASES` (default `0` = no phase limit)
- `STRAVA_ENRICH_ON_IMPORT` (default `true`; enriches activity detail during import)
- `STRAVA_ENRICH_INITIAL_ONLY` (default `true`; limit enrichment to initial recent-sync phase)
- `STRAVA_ENRICH_MAX_ACTIVITIES` (default `50`; clamped `20-50` for full-detail enrichment of most recent activities)
- `STRAVA_DETAIL_BACKFILL_BATCH_ACTIVITIES` (default `50`, clamped `20-50`; additional saved activities enriched per background sync run)
- `STRAVA_DETAIL_BACKFILL_WINDOW_DAYS` (default `365`; default full-detail backfill window when all-time is disabled)
- `STRAVA_ALLOW_LAZY_DETAIL_FETCH` (default `false`; when `false`, opening activity detail never triggers Strava API calls)

Strava sync status/debug includes a rolling `requests last 10m` counter in sync messages for troubleshooting API usage.

Per-user Strava detail scope:

- Settings → Integrations includes **Strava detail backfill: import all-time history**.
- OFF (default): full-detail backfill runs in background for the last `STRAVA_DETAIL_BACKFILL_WINDOW_DAYS` only.
- ON: full-detail backfill runs in background for all historical imported activities.
- In both cases, work is chunked and constrained by `STRAVA_DAILY_REQUEST_LIMIT`.

App startup is safe when credentials are missing (providers remain disabled/scaffolded).

### Local Testing Guide

1. Enable Strava integration:
   - set `ENABLE_STRAVA_INTEGRATION=true`
   - set `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI`
2. In the dashboard Settings → Integrations, click **Connect** for Strava.
3. Complete OAuth and call **Sync now**.
4. Verify imported activities appear in Activities and no duplicates appear on repeated syncs.
5. For Google Fit / Apple Health bridge flows, POST normalized records to:
   - `/integrations/google_fit/bridge/wellness`
   - `/integrations/google_fit/bridge/sleep`
   - `/integrations/apple_health/bridge/wellness`
   - `/integrations/apple_health/bridge/sleep`
6. Verify wellness widgets on athlete dashboard (HRV, Resting HR, Sleep, Stress).

### Production Hardening Checklist

- Use unique strong `INTEGRATIONS_TOKEN_ENCRYPTION_KEY` and rotate it via secret manager.
- Do not rely on placeholder `SECRET_KEY` values; the app now falls back to an ephemeral runtime key, which is safer for public code but unsuitable for persistent deployments.
- Enforce HTTPS-only redirect URIs and production callback domains.
- Keep all non-approved providers behind `ENABLE_*` flags (default `false`).
- Configure provider webhook secrets/verification and monitor webhook idempotency logs.
- Monitor `integration_audit_logs` and `provider_sync_state.last_error` for failed syncs.
- Add scheduled polling workers that call `/integrations/{provider}/sync-now` for connected users.
- Keep `ALLOW_SELF_REGISTER_COACH=false` unless you explicitly need open coach self-signup.
- Set strong `SECRET_KEY` and dedicated `JWT_ISSUER`/`JWT_AUDIENCE` per environment.
