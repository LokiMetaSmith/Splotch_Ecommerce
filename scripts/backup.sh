#!/bin/bash

# A script to back up application data to an AWS S3 bucket.
#
# Usage:
# ./scripts/backup.sh your-s3-bucket-name
#
# Prerequisites:
# - aws-cli installed and configured with credentials that have
#   write access to the target S3 bucket.
# - Run this script from the root of the project directory.

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
S3_BUCKET_NAME=$1
SOURCE_DB="server/db.json"
SOURCE_UPLOADS="server/uploads"
BACKUP_FILENAME="backup-$(date +%Y-%m-%d-%H%M%S).tar.gz"

# --- Validation ---
if [ -z "$S3_BUCKET_NAME" ]; then
  echo "❌ Error: S3 bucket name is required."
  echo "Usage: $0 your-s3-bucket-name"
  exit 1
fi

if ! command -v aws &> /dev/null; then
    echo "❌ Error: aws-cli is not installed. Please install it to continue."
    exit 1
fi

if [ ! -f "$SOURCE_DB" ]; then
    echo "⚠️ Warning: Database file not found at $SOURCE_DB. Skipping."
    # Decide if you want to exit or continue without the DB
    # For this script, we'll continue, to back up uploads even if DB is missing.
    # exit 1
fi

if [ ! -d "$SOURCE_UPLOADS" ]; then
    echo "⚠️ Warning: Uploads directory not found at $SOURCE_UPLOADS. Skipping."
fi

echo "🚀 Starting backup process..."

# --- Create Archive ---
echo "📦 Creating archive: $BACKUP_FILENAME..."
# The tar command will create the archive.
# 'c' for create, 'z' for gzip, 'f' for file.
# The files and directories to be archived are listed at the end.
tar -czf "$BACKUP_FILENAME" "$SOURCE_DB" "$SOURCE_UPLOADS"

echo "✅ Archive created successfully."

# --- Upload to S3 ---
echo "☁️  Uploading to S3 bucket: $S3_BUCKET_NAME..."
aws s3 cp "$BACKUP_FILENAME" "s3://$S3_BUCKET_NAME/"

echo "✅ Upload complete."

# --- Cleanup ---
echo "🧹 Cleaning up local archive file..."
rm "$BACKUP_FILENAME"

echo "🎉 Backup process finished successfully!"
