#!/bin/bash

# A script to back up application data to a remote storage provider using rclone.
#
# Usage:
# ./scripts/backup.sh <rclone_remote_path>
# Example: ./scripts/backup.sh b2-backups:my-print-shop-backups
#
# Prerequisites:
# - rclone installed and configured with a remote (e.g., "b2-backups").
# - Run this script from the root of the project directory.

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
RCLONE_REMOTE_PATH=$1
SOURCE_DB="server/db.json"
SOURCE_UPLOADS="server/uploads"
BACKUP_FILENAME="backup-$(date +%Y-%m-%d-%H%M%S).tar.gz"

# --- Validation ---
if [ -z "$RCLONE_REMOTE_PATH" ]; then
  echo "❌ Error: rclone remote path is required."
  echo "Usage: $0 <rclone_remote_path>"
  echo "Example: $0 b2-backups:my-print-shop-backups"
  exit 1
fi

if ! command -v rclone &> /dev/null; then
    echo "❌ Error: rclone is not installed. Please install and configure it to continue."
    exit 1
fi

if [ ! -f "$SOURCE_DB" ]; then
    echo "⚠️ Warning: Database file not found at $SOURCE_DB. Skipping."
fi

if [ ! -d "$SOURCE_UPLOADS" ]; then
    echo "⚠️ Warning: Uploads directory not found at $SOURCE_UPLOADS. Skipping."
fi

echo "🚀 Starting backup process..."

# --- Create Archive ---
echo "📦 Creating archive: $BACKUP_FILENAME..."
tar -czf "$BACKUP_FILENAME" "$SOURCE_DB" "$SOURCE_UPLOADS"

echo "✅ Archive created successfully."

# --- Upload to Remote Storage ---
echo "☁️  Uploading to rclone remote: $RCLONE_REMOTE_PATH..."
rclone copy "$BACKUP_FILENAME" "$RCLONE_REMOTE_PATH/"

echo "✅ Upload complete."

# --- Cleanup ---
echo "🧹 Cleaning up local archive file..."
rm "$BACKUP_FILENAME"

echo "🎉 Backup process finished successfully!"
