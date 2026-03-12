# GitHub Publishing Safety Checklist

Use this checklist before the first public push.

## 1) Keep secrets out of git

- Keep real credentials only in local `.env` files.
- Commit only example templates like `.env.example`.
- If any secret was ever committed before, rotate it immediately.

## 2) Confirm ignored files

Run:

```powershell
git check-ignore -v .env frontend/.env backend/uploads/sample.fit frontend/dist
```

Expected: each path is matched by `.gitignore`.

Also confirm local helper files are ignored:

```powershell
git check-ignore -v mobile-last-url.txt backups/test.sql
```

## 3) Start clean repo safely

```powershell
git init
git add .
git status
```

Before first commit, verify `git status` does **not** include:

- `.env` / `frontend/.env`
- `frontend/dist/`
- `backend/uploads/`, `frontend/uploads/`, `uploads/`
- activity files (`*.fit`, `*.gpx`, `*.tcx`)
- `mobile-last-url.txt`

## 4) Secret scan before push

Use one scanner (recommended):

```powershell
# Option A: gitleaks via Docker
docker run --rm -v ${PWD}:/repo zricethezav/gitleaks:latest detect --source=/repo --verbose

# Option B: trufflehog via Docker
docker run --rm -v ${PWD}:/pwd trufflesecurity/trufflehog:latest filesystem /pwd
```

Only push when scan is clean.

## 4.1) Confirm secure debug defaults

- Keep `EXPOSE_AUTH_DEBUG_LINKS=false` before publishing or deploying shared environments.
- Set a real `SECRET_KEY` and `INTEGRATIONS_TOKEN_ENCRYPTION_KEY`; do not rely on placeholder values.

## 5) If a secret was committed accidentally

- Rotate/revoke that credential in the provider dashboard first.
- Rewrite history before publishing (example with git-filter-repo):

```powershell
pip install git-filter-repo
git filter-repo --invert-paths --path .env --path frontend/.env
```

Then force-push only if needed, and re-run secret scan.
