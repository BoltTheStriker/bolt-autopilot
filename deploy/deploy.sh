#!/usr/bin/env bash
# Update and restart Bolt on the server (run as bolt, or from the GitHub deploy Action):
#   bash /srv/bolt/app/deploy/deploy.sh
set -euo pipefail
cd /srv/bolt/app
git fetch --quiet origin main
git reset --hard --quiet origin/main
docker compose -f deploy/docker-compose.yml up -d --build --remove-orphans
# Wait for the worker to report healthy (up to ~3 minutes)
for i in $(seq 1 36); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose -f deploy/docker-compose.yml ps -q bolt-worker)" 2>/dev/null || echo starting)
  [ "$state" = healthy ] && { echo "Deployed $(git rev-parse --short HEAD): healthy."; docker image prune -f >/dev/null; exit 0; }
  sleep 5
done
echo "The worker didn't become healthy. Logs:"; docker compose -f deploy/docker-compose.yml logs --tail 80 bolt-worker; exit 1
