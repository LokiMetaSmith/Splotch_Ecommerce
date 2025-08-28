#!/bin/bash

# A script to back up application data to a remote storage provider.
# Supports 'rclone' (recommended) and 'aws-cli' as upload methods.
#
# Usage:
#   ./scripts/backup.sh --method rclone <rclone_remote_path>
#   ./scripts/backup.sh --method aws <s3_bucket_name>
#
# Examples:
#   ./scripts/backup.sh --method rclone b2-backups:my-bucket
#   ./scripts/backup.sh --method aws my-s3-bucket
#
# Prerequisites:
# - The chosen upload tool (rclone or aws-cli) must be installed and configured.
# - Run this script from the root of the project directory.

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Argument Parsing ---
if [ "$1" != "--method" ]; then
  echo "❌ Error: First argument must be --method."
  echo "Usage: $0 --method [rclone|aws] <destination>"
  exit 1
fi

METHOD=$2
DESTINATION=$3

# --- Configuration ---
SOURCE_DB="server/db.json"
SOURCE_UPLOADS="server/uploads"
BACKUP_FILENAME="backup-$(date +%Y-%m-%d-%H%M%S).tar.gz"

# --- Validation ---
if [ -z "$METHOD" ] || [ -z "$DESTINATION" ]; then
  echo "❌ Error: Invalid arguments. Method and destination are required."
  echo "Usage: $0 --method [rclone|aws] <destination>"
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
else
  echo "❌ Error: Invalid method '$METHOD'. Must be 'rclone' or 'aws'."
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

# --- Upload to Remote Storage ---
echo "☁️  Uploading to $DESTINATION..."
if [ "$METHOD" == "rclone" ]; then
  rclone copy "$BACKUP_FILENAME" "$DESTINATION/"
elif [ "$METHOD" == "aws" ]; then
  aws s3 cp "$BACKUP_FILENAME" "s3://$DESTINATION/"
fi
echo "✅ Upload complete."

# --- Cleanup ---
echo "🧹 Cleaning up local archive file..."
rm "$BACKUP_FILENAME"

echo "🎉 Backup process finished successfully!"
