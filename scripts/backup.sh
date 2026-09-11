#!/bin/bash

# A script to back up application data to a remote storage provider.
# Supports 'rclone' (recommended) and 'aws-cli' as upload methods.
#
# Usage:
#   ./scripts/backup.sh --method <rclone|aws> <destination> [--retention-days <days>]
#
# Examples:
#   ./scripts/backup.sh --method rclone b2-backups:my-bucket --retention-days 30
#   ./scripts/backup.sh --method aws my-s3-bucket
#
# Prerequisites:
# - The chosen upload tool (rclone or aws-cli) must be installed and configured.
# - Run this script from the root of the project directory.

# Exit immediately if a command exits with a non-zero status.
set -e

# Change to the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# --- Argument Parsing ---
METHOD=""
DESTINATION=""
RETENTION_DAYS=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --method)
      METHOD="$2"
      shift # past argument
      shift # past value
      ;;
    --retention-days)
      RETENTION_DAYS="$2"
      shift # past argument
      shift # past value
      ;;
    -*|--*)
      echo "❌ Error: Unknown option $1"
      exit 1
      ;;
    *)
      if [ -z "$DESTINATION" ]; then
        DESTINATION="$1"
        shift
      else
        echo "❌ Error: Unknown argument $1"
        exit 1
      fi
      ;;
  esac
done

# --- Load Defaults from server/.env if not passed via CLI ---
if [ -f "server/.env" ]; then
  if [ -z "$METHOD" ]; then
    ENV_METHOD=$(grep -E '^[[:space:]]*BACKUP_METHOD=' server/.env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
    [ -n "$ENV_METHOD" ] && METHOD="$ENV_METHOD"
  fi
  if [ -z "$DESTINATION" ]; then
    ENV_DEST=$(grep -E '^[[:space:]]*BACKUP_DESTINATION=' server/.env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
    [ -n "$ENV_DEST" ] && DESTINATION="$ENV_DEST"
  fi
  if [ -z "$RETENTION_DAYS" ]; then
    ENV_RET=$(grep -E '^[[:space:]]*BACKUP_RETENTION_DAYS=' server/.env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
    [ -n "$ENV_RET" ] && RETENTION_DAYS="$ENV_RET"
  fi
fi

# Fallback defaults
METHOD="${METHOD:-local}"
DESTINATION="${DESTINATION:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# --- Configuration ---
SOURCE_DB="server/db.json"
SOURCE_UPLOADS="server/uploads"
BACKUP_FILENAME="backup-$(date +%Y-%m-%d-%H%M%S).tar.gz"

# --- Validation ---
if [ -z "$METHOD" ] || [ -z "$DESTINATION" ]; then
  echo "❌ Error: Method and destination could not be determined."
  echo "Usage: $0 [--method <local|rclone|aws>] [<destination>] [--retention-days <days>]"
  exit 1
fi

if [ "$METHOD" == "rclone" ]; then
  if ! command -v rclone &> /dev/null; then
    echo "❌ Error: rclone is not installed. Please install and configure it to continue."
    exit 1
  fi
elif [ "$METHOD" == "aws" ]; then
  if ! command -v aws &> /dev/null; then
    echo "❌ Error: aws-cli is not installed. Please install it to continue."
    exit 1
  fi
elif [ "$METHOD" == "local" ]; then
  # Local method only requires standard shell utilities
  true
else
  echo "❌ Error: Invalid method '$METHOD'. Must be 'local', 'rclone', or 'aws'."
  exit 1
fi

if [ ! -f "$SOURCE_DB" ] && [ ! -d "$SOURCE_UPLOADS" ]; then
    echo "❌ Error: Neither source database ($SOURCE_DB) nor uploads directory ($SOURCE_UPLOADS) found. Nothing to back up."
    exit 1
fi

echo "🚀 Starting backup process using method: $METHOD..."

# --- Create Archive ---
# Build the list of files to archive. This handles cases where one is missing.
FILES_TO_BACKUP=""
if [ -f "$SOURCE_DB" ]; then
    FILES_TO_BACKUP="$FILES_TO_BACKUP $SOURCE_DB"
else
    echo "⚠️ Warning: Database file not found at $SOURCE_DB. Skipping."
fi

if [ -d "$SOURCE_UPLOADS" ]; then
    FILES_TO_BACKUP="$FILES_TO_BACKUP $SOURCE_UPLOADS"
else
    echo "⚠️ Warning: Uploads directory not found at $SOURCE_UPLOADS. Skipping."
fi

echo "📦 Creating archive: $BACKUP_FILENAME..."
tar -czf "$BACKUP_FILENAME" $FILES_TO_BACKUP
echo "✅ Archive created successfully."

# --- Store or Upload Backup ---
if [ "$METHOD" == "local" ]; then
  echo "💾 Saving backup locally to $DESTINATION..."
  mkdir -p "$DESTINATION"
  cp "$BACKUP_FILENAME" "$DESTINATION/"
  echo "✅ Saved backup to $DESTINATION/$BACKUP_FILENAME"
elif [ "$METHOD" == "rclone" ]; then
  echo "☁️  Uploading to $DESTINATION via rclone..."
  rclone copy "$BACKUP_FILENAME" "$DESTINATION/"
  echo "✅ Upload complete."
elif [ "$METHOD" == "aws" ]; then
  echo "☁️  Uploading to s3://$DESTINATION via AWS CLI..."
  aws s3 cp "$BACKUP_FILENAME" "s3://$DESTINATION/"
  echo "✅ Upload complete."
fi

# --- Retention Policy ---
if [ -n "$RETENTION_DAYS" ] && [ "$RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
    echo "Cleanup: Checking for old backups (retention: $RETENTION_DAYS days)..."
    if [ "$METHOD" == "local" ]; then
        echo "🗑️  Pruning local backups older than $RETENTION_DAYS days..."
        find "$DESTINATION" -name "backup-*.tar.gz" -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
        echo "✅ Local cleanup complete."
    elif [ "$METHOD" == "rclone" ]; then
        echo "🗑️  Running rclone cleanup..."
        rclone delete "$DESTINATION/" --min-age "${RETENTION_DAYS}d" --include "backup-*.tar.gz"
        echo "✅ Cleanup complete."
    elif [ "$METHOD" == "aws" ]; then
        echo "⚠️  Warning: Retention policy management via this script is not supported for AWS."
        echo "   Please configure S3 Lifecycle Rules on your bucket to delete objects older than $RETENTION_DAYS days."
    fi
fi

# --- Cleanup temporary working archive ---
if [ "$METHOD" != "local" ] || [ "$DESTINATION" != "." ]; then
  echo "🧹 Cleaning up local archive file..."
  rm -f "$BACKUP_FILENAME"
fi

echo "🎉 Backup process finished successfully!"
