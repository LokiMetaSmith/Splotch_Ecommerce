#!/bin/bash

# This script finds all available USB drives managed by our udev/autofs setup
# and triggers their mount by performing a simple listing.

AUTODIR="/media/auto_mount_usb"
DEVDIR="/dev/usbdisks"

echo "Looking for available USB devices..."

# Check if the directory created by the udev rule exists and is not empty
if [ -d "$DEVDIR" ] && [ "$(ls -A $DEVDIR)" ]; then
    # Loop through every device symlink in our udev directory
    for device in $(ls $DEVDIR); do
        echo "Activating mount for $device..."
        # Access the directory to trigger the autofs mount.
        # Redirect output to /dev/null to keep things clean.
        ls -d "${AUTODIR}/${device}" > /dev/null 2>&1
    done
    echo "Done. All available drives are now active."
    echo "You can access them in: ${AUTODIR}"
    ls -l $AUTODIR
else
    echo "No USB devices found in ${DEVDIR}."
fi
