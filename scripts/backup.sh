#!/bin/bash

# Set the source and destination directories
SOURCE_DB="server/db.json"
SOURCE_UPLOADS="server/uploads"
BACKUP_DIR="backups"
TIMESTAMP=$(date +"%Y%m%d%H%M%S")
BACKUP_FILE="$BACKUP_DIR/backup-$TIMESTAMP.tar.gz"

# Create backup directory if it doesn't exist
mkdir -p $BACKUP_DIR

# Create the archive
echo "Creating backup archive..."
tar -czf $BACKUP_FILE $SOURCE_DB $SOURCE_UPLOADS

if [ $? -eq 0 ]; then
    echo "Backup archive created successfully: $BACKUP_FILE"
else
    echo "Error creating backup archive."
    exit 1
fi

# Upload the archive
echo "Uploading backup to transfer.whalebone.io..."
UPLOAD_URL=$(curl -v --upload-file $BACKUP_FILE https://transfer.whalebone.io/backup.tar.gz)

if [ $? -eq 0 ]; then
    echo "Backup uploaded successfully."
    echo "Download URL: $UPLOAD_URL"
    # Clean up the local backup file
    rm $BACKUP_FILE
else
    echo "Error uploading backup."
    exit 1
fi
