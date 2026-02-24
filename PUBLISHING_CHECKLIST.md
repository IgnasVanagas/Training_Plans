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

## 4) Secret scan before push

Use one scanner (recommended):

```powershell
# Option A: gitleaks via Docker
docker run --rm -v ${PWD}:/repo zricethezav/gitleaks:latest detect --source=/repo --verbose

# Option B: trufflehog via Docker
docker run --rm -v ${PWD}:/pwd trufflesecurity/trufflehog:latest filesystem /pwd
```

Only push when scan is clean.

## 5) If a secret was committed accidentally

- Rotate/revoke that credential in the provider dashboard first.
- Rewrite history before publishing (example with git-filter-repo):

```powershell
pip install git-filter-repo
git filter-repo --invert-paths --path .env --path frontend/.env
```

Then force-push only if needed, and re-run secret scan.
