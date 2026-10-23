#!/usr/bin/env bash
# Nightly encrypted backup of Bolt's data (bot state, Autopilot users, history) with restic.
# Needs /srv/bolt/backup.env (chmod 600) with:
#   RESTIC_REPOSITORY=b2:your-bucket:bolt   (Backblaze B2; or s3:..., sftp:...)
#   RESTIC_PASSWORD=...                      (keep a copy somewhere safe: without it backups can't be read)
#   B2_ACCOUNT_ID=...  B2_ACCOUNT_KEY=...
# Cron (as bolt):  30 3 * * *  bash /srv/bolt/app/deploy/backup.sh >> /srv/bolt/backup.log 2>&1
set -euo pipefail
set -a; . /srv/bolt/backup.env; set +a
restic snapshots >/dev/null 2>&1 || restic init
restic backup /srv/bolt/data --tag bolt --quiet
restic forget --tag bolt --keep-daily 14 --keep-weekly 8 --keep-monthly 6 --prune --quiet
echo "$(date -u +%FT%TZ) backup ok"
