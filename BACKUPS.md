# Application Backup & Restore Guide

This document explains how to back up and restore the application's data using the provided backup script. This process is crucial for disaster recovery.

## Backup Strategy

The backup strategy is simple:
1.  A shell script (`scripts/backup.sh`) creates a compressed archive (`.tar.gz`) of the application's stateful data.
2.  This data includes the `db.json` file (the database) and the `uploads/` directory (all user-uploaded images).
3.  The script then uploads this archive to a secure, durable cloud storage location (AWS S3).
4.  This process should be automated to run on a regular schedule (e.g., daily).

## 1. Prerequisites: AWS CLI Setup

The backup script uses the official AWS Command Line Interface (CLI) to communicate with AWS S3. You must install and configure it on the server where you run the application.

### Installation
Follow the official AWS documentation to install the AWS CLI:
[https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

### Configuration
1.  **Create an S3 Bucket:** Go to the AWS S3 console and create a new, private S3 bucket to store your backups. Note the bucket name.

2.  **Create an IAM User:** For security, create a dedicated IAM user with programmatic access and give it permission to **only** write objects to your backup bucket.
    - Attach a policy to this user with permissions like `s3:PutObject` on the resource `arn:aws:s3:::your-bucket-name/*`.

3.  **Configure the CLI:** Run `aws configure` on your server. It will prompt you for the Access Key ID, Secret Access Key, and default region for the IAM user you just created.
    ```bash
    aws configure
    AWS Access Key ID [None]: YOUR_ACCESS_KEY
    AWS Secret Access Key [None]: YOUR_SECRET_KEY
    Default region name [None]: us-east-1
    Default output format [None]: json
    ```
    This will store the credentials securely for the script to use.

## 2. Running a Manual Backup

You can trigger a backup at any time by running the script from the **root of the project directory**.

**Usage:**
```bash
./scripts/backup.sh your-s3-bucket-name
```
Replace `your-s3-bucket-name` with the name of the S3 bucket you created. The script will print its progress and confirm when the backup is complete.

## 3. Automating Backups with Cron

To ensure your data is backed up regularly, you should automate the script using a cron job.

1.  Open the crontab editor:
    ```bash
    crontab -e
    ```

2.  Add a new line to schedule the script. For example, to run the backup every day at 3:00 AM:
    ```cron
    # m h  dom mon dow   command
    0 3 * * * /bin/bash /path/to/your/project/scripts/backup.sh your-s3-bucket-name > /path/to/your/project/logs/backup.log 2>&1
    ```
    **Important:**
    - Replace `/path/to/your/project/` with the absolute path to your application's root directory.
    - Replace `your-s3-bucket-name` with your actual S3 bucket name.
    - Redirecting the output (`> ... 2>&1`) to a log file is highly recommended for troubleshooting.

## 4. Restoring from a Backup

If you need to restore your application's state from a backup, follow these steps:

1.  **Download the Backup:** Go to your S3 bucket and download the desired backup file (e.g., `backup-2023-10-27-030001.tar.gz`) to your server.

2.  **Stop the Application:** Ensure your application server (e.g., the PM2 process) is stopped to prevent data corruption during the restore.
    ```bash
    pm2 stop print-shop-backend
    ```

3.  **Extract the Backup:** From the root of your project directory, extract the archive. This will overwrite the existing `server/db.json` and `server/uploads/` directory.
    ```bash
    # Make sure you are in the project root directory
    tar -xzf /path/to/your/downloaded/backup-file.tar.gz
    ```
    This command will restore the files to their original locations within the project structure (e.g., `server/db.json`).

4.  **Restart the Application:**
    ```bash
    pm2 restart print-shop-backend
    ```

Your application is now restored to the state of the backup.
