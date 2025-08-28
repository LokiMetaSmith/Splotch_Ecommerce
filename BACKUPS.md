# Application Backup & Restore Guide

This document explains how to back up and restore the application's data. A regular, automated, and offsite backup strategy is crucial for disaster recovery.

## Backup Strategy

The backup strategy is simple:
1.  A shell script (`scripts/backup.sh`) creates a compressed archive (`.tar.gz`) of the application's stateful data (`server/db.json` and `server/uploads/`).
2.  The script then uploads this archive to a secure, remote cloud storage location.
3.  This process should be automated to run on a regular schedule (e.g., daily) using a cron job.

We provide two methods for uploading your backups, which are supported by the `scripts/backup.sh` script.

---

## Method 1: `rclone` (Recommended)

This is the recommended method due to its flexibility. `rclone` is a powerful command-line program that can sync files to dozens of different cloud storage providers.

**Storage Recommendation: Backblaze B2**

We recommend Backblaze B2 because it is simple, reliable, and extremely inexpensive.
- **Cost:** The first 10 GB of storage are free each month.
- **Reliability:** It's designed for durable, long-term data storage.

### 1. Prerequisites: `rclone` Setup

1.  **Install `rclone`:** Follow the official `rclone` installation guide for your server's operating system: [https://rclone.org/install/](https://rclone.org/install/)

2.  **Configure `rclone`:** Run `rclone config` on your server. This will launch an interactive setup process to connect `rclone` to your chosen cloud storage provider (e.g., Backblaze B2).
    - Follow the prompts to create a new "remote".
    - Give your remote a simple name (e.g., `b2-backups`).
    - You will need your application key and key ID from your storage provider.

### 2. Running a Manual Backup

You can trigger a backup at any time by running the script from the **root of the project directory**.

**Usage:**
```bash
./scripts/backup.sh --method rclone <rclone_remote_path>
```
- **Example:** `./scripts/backup.sh --method rclone b2-backups:my-print-shop-backups`
- The `<rclone_remote_path>` should be the name of the remote you configured, a colon, and the name of the bucket or folder where you want to store the backups.

---

## Method 2: AWS CLI

This method is for users who prefer to use AWS S3 and the official AWS Command Line Interface (CLI).

### 1. Prerequisites: AWS CLI Setup

1.  **Install AWS CLI:** Follow the official AWS documentation to install the AWS CLI: [https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

2.  **Configure AWS:**
    - **Create an S3 Bucket:** Go to the AWS S3 console and create a new, private S3 bucket.
    - **Create an IAM User:** For security, create a dedicated IAM user with programmatic access and give it permission to **only** write objects to your backup bucket (e.g., `s3:PutObject` permission).
    - **Configure the CLI:** Run `aws configure` on your server and enter the Access Key ID and Secret Access Key for the IAM user you created.

### 2. Running a Manual Backup

**Usage:**
```bash
./scripts/backup.sh --method aws <your_s3_bucket_name>
```
- **Example:** `./scripts/backup.sh --method aws my-print-shop-s3-backups`

---

## 3. Automating Backups with Cron

To ensure your data is backed up regularly, you should automate the script using a cron job.

1.  Open the crontab editor:
    ```bash
    crontab -e
    ```

2.  Add a new line to schedule the script. For example, to run the backup every day at 3:00 AM.

    **For `rclone`:**
    ```cron
    # m h  dom mon dow   command
    0 3 * * * /bin/bash /path/to/project/scripts/backup.sh --method rclone b2-backups:my-bucket > /path/to/project/logs/backup.log 2>&1
    ```

    **For `aws-cli`:**
    ```cron
    # m h  dom mon dow   command
    0 3 * * * /bin/bash /path/to/project/scripts/backup.sh --method aws your-s3-bucket-name > /path/to/project/logs/backup.log 2>&1
    ```

    **Important:**
    - Replace `/path/to/project/` with the absolute path to your application's root directory.
    - Redirecting the output (`> ... 2>&1`) to a log file is highly recommended for troubleshooting.

## 4. Restoring from a Backup

If you need to restore your application's state from a backup:

1.  **Download the Backup:** Using your chosen tool (`rclone` or `aws-cli`), download the desired backup file (e.g., `backup-YYYY-MM-DD-HHMMSS.tar.gz`) from your cloud storage to the server.

2.  **Stop the Application:** Ensure your application server is stopped to prevent data corruption. If using the `docker-compose.yml` from the `cloud-config`, you can run:
    ```bash
    cd /path/to/project && docker-compose down
    ```

3.  **Extract the Backup:** From the **root of your project directory**, extract the archive. This will overwrite the existing `server/db.json` and `server/uploads/` directory.
    ```bash
    # Make sure you are in the project root directory
    tar -xzf /path/to/your/downloaded/backup-file.tar.gz
    ```
    This command will restore the files to their original locations (`server/db.json` and `server/uploads/*`).

4.  **Restart the Application:**
    ```bash
    cd /path/to/project && docker-compose up -d
    ```

Your application is now restored to the state of the backup.
