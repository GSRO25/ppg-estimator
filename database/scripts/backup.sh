#!/bin/bash
# PPG Estimator - Database Backup Script
# Run daily via Windows Task Scheduler or cron

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="ppg_estimator_${TIMESTAMP}.sql.gz"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Dump database
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-ppg}" "${POSTGRES_DB:-ppg_estimator}" | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "Backup created: ${BACKUP_DIR}/${FILENAME}"
echo "Size: $(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)"

# Clean old backups
find "$BACKUP_DIR" -name "ppg_estimator_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
echo "Cleaned backups older than ${RETENTION_DAYS} days"
