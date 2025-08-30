# Backup and Restore

This document outlines the process for backing up and restoring the application's data.

## Backups

A backup consists of the application's database (`server/db.json`) and all user uploads (`server/uploads/`).

### Automated Backups

There is no automated backup process configured yet.

### Manual Backups

To create a manual backup, run the following command from the root of the repository:

```bash
bash scripts/backup.sh
```

This script will:
1.  Create a timestamped `.tar.gz` archive of the database and uploads directory.
2.  Upload the archive to `transfer.whalebone.io`.
3.  Print the download URL to the console.
4.  Delete the local archive file.

**Important:** The download link is only valid for 7 days.

## Restore

To restore from a backup:
1.  Download the backup archive from the URL provided by the backup script.
2.  Extract the archive. You will have a `server` directory containing `db.json` and the `uploads` directory.
3.  Stop the application server.
4.  Replace the `server/db.json` file and the `server/uploads` directory with the files from the backup.
5.  Restart the application server.
