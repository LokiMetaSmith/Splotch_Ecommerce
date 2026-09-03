#!/bin/bash

# --- Configuration Variables ---
MOUNT_POINT="/media/auto_mount_usb"
UDEV_RULE_FILE="/etc/udev/rules.d/99-usb-auto-mount.rules"
AUTO_MASTER_FILE="/etc/auto.master"
AUTO_USB_SCRIPT="/etc/auto_mount.usb"

# --- Functions ---

log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_message "This script must be run as root. Please use sudo."
        exit 1
    fi
}

install_package() {
    local package_name="$1"
    if ! dpkg -s "$package_name" &> /dev/null; then
        log_message "Installing $package_name..."
        if sudo apt-get update && sudo apt-get install -y "$package_name"; then
            log_message "$package_name installed successfully."
        else
            log_message "Error installing $package_name. Please check your internet connection and apt repositories."
            exit 1
        fi
    else
        log_message "$package_name is already installed."
    fi
}

# --- Main Script ---

check_root

log_message "Starting USB automount setup with sync option..."

# 1. Install necessary packages
install_package "autofs"
install_package "util-linux" # Provides blkid
install_package "ntfs-3g"    # For NTFS formatted USB drives

# 2. Create the UDEV Rule
log_message "Creating udev rule: $UDEV_RULE_FILE"
# This rule creates a stable symbolic link in /dev/usbdisks/ for any USB partition.
cat <<EOF > "$UDEV_RULE_FILE"
ACTION=="add", KERNEL=="sd*[0-9]", ENV{DEVTYPE}=="partition", ENV{ID_BUS}=="usb", SYMLINK+="usbdisks/%k", MODE:="0660"
EOF
if [[ $? -eq 0 ]]; then
    log_message "Udev rule created successfully."
else
    log_message "Error creating udev rule."
    exit 1
fi

log_message "Reloading udev rules..."
sudo udevadm control --reload-rules
sudo udevadm trigger
log_message "Udev rules reloaded."

# 3. Configure autofs Master Map
log_message "Configuring autofs master map: $AUTO_MASTER_FILE"
# Check if the exact line already exists before adding it
if ! grep -q "^${MOUNT_POINT} ${AUTO_USB_SCRIPT}" "$AUTO_MASTER_FILE"; then
    echo "" | sudo tee -a "$AUTO_MASTER_FILE" > /dev/null # Add a newline for safety
    echo "${MOUNT_POINT} ${AUTO_USB_SCRIPT} --timeout=60" | sudo tee -a "$AUTO_MASTER_FILE" > /dev/null
    log_message "Autofs master map entry added."
else
    log_message "Autofs master map entry already exists."
fi

# 4. Create the autofs Mount Map with the corrected logic
log_message "Creating autofs mount map script: $AUTO_USB_SCRIPT"
# Note the use of 'EOF' which prevents variable expansion in the here-document.
# This ensures that $1 is written literally to the script file.
cat <<'EOF' > "$AUTO_USB_SCRIPT"
#!/bin/bash
# Autofs mount script for USB devices with 'sync' option.
# The device key (e.g., "sdb1") is passed by autofs as the first command-line argument.

KEY="$1"

# Check if the key was provided by autofs.
if [ -z "${KEY}" ]; then
    # Exit cleanly if no key is passed.
    exit 1
fi

# Construct the full device path using the stable symlink.
device_path="/dev/usbdisks/${KEY}"

# Check if the device block file actually exists.
if [ ! -b "$device_path" ]; then
    # Exit if the device is not found or is not a block device.
    exit 1
fi

# Get the filesystem type using blkid.
fstype=$(/sbin/blkid -o value -s TYPE "${device_path}")

# Default mount options, including the critical 'sync' option for data safety.
mount_options="-fstype=auto,sync,uid=0,gid=plugdev,umask=007"

# Filesystem-specific options for vfat and ntfs.
if [ "${fstype}" = "vfat" ]; then
    mount_options="-fstype=vfat,sync,uid=0,gid=plugdev,umask=007"
elif [ "${fstype}" = "ntfs" ]; then
    mount_options="-fstype=ntfs-3g,sync,uid=0,gid=plugdev,umask=007"
fi

# This final line is the output read by autofs to perform the mount.
# Format: <mount_options> :<device_location>
echo "${mount_options} :${device_path}"

exit 0
EOF

if [[ $? -eq 0 ]]; then
    log_message "Autofs mount map script created successfully."
    log_message "Setting execute permissions for $AUTO_USB_SCRIPT."
    sudo chmod +x "$AUTO_USB_SCRIPT"
else
    log_message "Error creating autofs mount map script."
    exit 1
fi

# 5. Restart autofs service to apply all changes
log_message "Restarting autofs service..."
sudo systemctl restart autofs
if [[ $? -eq 0 ]]; then
    log_message "Autofs service restarted successfully."
else
    log_message "Error restarting autofs service. Please check 'sudo systemctl status autofs' for details."
    exit 1
fi

log_message "USB automount setup complete. Plug in a USB stick to test."
log_message "Access the drive via its device name, e.g., 'ls ${MOUNT_POINT}/sdb1'"
