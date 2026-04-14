#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Run deployment/hetzner/bootstrap-ubuntu.sh first."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is missing. Run deployment/hetzner/bootstrap-ubuntu.sh first."
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <repo_url> [branch] [app_dir]"
  echo "Example: $0 https://github.com/your-org/Training_Plans.git main /opt/training_plans"
  exit 1
fi

REPO_URL="$1"
BRANCH="${2:-main}"
APP_DIR="${3:-/opt/training_plans}"
ENV_FILE="${APP_DIR}/.env.production"

mkdir -p "${APP_DIR}"

if [[ ! -d "${APP_DIR}/.git" ]]; then
  git clone --branch "${BRANCH}" --single-branch "${REPO_URL}" "${APP_DIR}"
else
  git -C "${APP_DIR}" fetch origin
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${APP_DIR}/env.production.template" "${ENV_FILE}"
  echo "Created ${ENV_FILE}. Fill real values, then rerun this script."
  exit 2
fi

docker compose -f "${APP_DIR}/docker-compose.prod.yml" --env-file "${ENV_FILE}" pull || true
docker compose -f "${APP_DIR}/docker-compose.prod.yml" --env-file "${ENV_FILE}" up -d --build

echo "Deployment complete."
echo "Health check: curl -fsS http://127.0.0.1/healthz"
echo "API check:    curl -fsS http://127.0.0.1/api/health"
