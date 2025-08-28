# Automated Offsite Backups

A local backup script that zips your data is an excellent first step, but the most important part of a backup strategy is getting that zip file **off the server**. A backup isn't truly safe if it's stored in the same place as the original data.

The best way to manage this is with an automated, offsite solution.

## The Strategy: Automate Offsite Backups

The goal is to automatically run your script, create the zip file, and then immediately copy that file to a secure, remote location. We can accomplish this easily using a command-line tool and a scheduler.

**Tool Recommendation:** **`rclone`**

`rclone` is a powerful command-line program known as "the rsync for cloud storage." It can sync files and directories to dozens of different cloud storage providers. It's perfect for this task.

**Storage Recommendation:** **Backblaze B2**

Backblaze B2 is a simple, incredibly cheap object storage service.

  * **Cost:** The first 10 GB are **free** every month. Downloads are also free up to 1 GB per day. For most small projects, your backup storage will cost you **$0/month**.
  * **Reliability:** It's designed for durable, long-term data storage.

## The Plan

Here’s how we'll set it up on your DigitalOcean Droplet:

1.  **Install and Configure `rclone`:** We'll install `rclone` on your server and configure it to connect to a new, free Backblaze B2 account. This is a one-time setup.

2.  **Enhance Your Backup Script:** We'll add a single line to the end of your existing backup script. After it successfully creates the zip file, it will use `rclone` to copy it to your Backblaze B2 bucket.

    ```bash
    # (Your existing script to create backup.zip)

    # Add this line at the end:
    # This copies the new backup file to the "my-print-shop-backups" bucket on Backblaze
    rclone copy /path/to/backup.zip b2-backups:my-print-shop-backups
    ```

3.  **Automate with a Cron Job:** We'll create a cron job, which is a standard Linux scheduler. We can set it to run your backup script automatically every night at a specific time (e.g., 3:00 AM).

This "set it and forget it" system ensures you always have a recent, secure, and offsite backup of your critical data without any manual intervention.

Would you like to proceed with installing `rclone` and setting up the automated backup workflow?
