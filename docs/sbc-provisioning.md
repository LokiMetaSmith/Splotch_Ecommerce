# Splotch SBC Provisioning & Remote Management

This document outlines the standard operating procedures and best practices for provisioning lightweight Ubuntu Single Board Computers (SBCs) to host the Splotch application. It includes inventory tracking, security hardening, and advanced remote management techniques (such as SSH agent forwarding and nested SSH jumps).

## 1. Hardware Inventory

Maintain a log of active physical SBC units deployed:

| Hostname       | Associated Location | Active | Version | SBC Hardware                                | Date Last Updated |
|----------------|------------------|--------|---------|---------------------------------------------|-------------------|
| `splotch-sbc-1` |           | Yes    | 0.5     | GMKtec N150, 12GB DDR5, 512GB SSD, Dual LAN | April 1st, 2025   |


---

## 2. Best Practices for Provisioning & Hardening

When flashing a new Ubuntu server image to a GMKtec N150 (or similar SBC), follow these hardening best practices. 

> **Note:** We have provided an automated init script (`scripts/setup-sbc-init.sh`) that automates much of the OS-level installation. The steps below outline the manual security fundamentals.

### A. Non-Root User Setup
Never run the application as `root`. Create a dedicated user (e.g., `user` or `splotch`):
```bash
sudo adduser user
sudo usermod -aG sudo,docker user
```

### B. Secure SSH Configurations
Edit `/etc/ssh/sshd_config` to secure the perimeter:
* **Disable Password Login:** Ensure `PasswordAuthentication no` is set.
* **Change Default Port (Recommended for obfuscation/NAT):** e.g., `Port 11447` or `Port 8020`.
* **Enable Agent Forwarding:** `AllowAgentForwarding yes`
* **Restart SSH:** `sudo systemctl restart ssh`

### C. Firewall Setup (UFW)
Only allow essential traffic using UFW:
```bash
sudo ufw allow 11447/tcp # Replace with your custom SSH port
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```
*(Note: If using Cloudflare Tunnels via `scripts/deploy-cloudflare-tunnel.sh`, you do not even need to open ports 80/443 on your firewall!)*

---

## 3. Remote Management (SSH Agent Forwarding)

Instead of copying private SSH keys to the SBC (which is insecure if the physical device is stolen), use **SSH Agent Forwarding** (`-A`). This allows your local computer to authenticate you when jumping between servers or cloning private repositories.

### Basic Connection
Connect securely over the internet:
```bash
ssh user@xxx.xxx.xxx.xxx -A
```
Or if on the local network:
```bash
ssh user@pubinv-sbc-2 -A 
```

### Troubleshooting Agent Forwarding
If forwarding is failing, follow this checklist:

#### 1. Verify Your Local `ssh-agent` is Working
Before connecting to the remote server, ensure the `ssh-agent` on your **local machine** is running and has your keys loaded. On your **local machine's terminal** (not the remote one), run:
```bash
ssh-add -l
```
* **If you see your key's fingerprint:** Your local agent is running and has the key. Proceed.
* **If you see `Could not open a connection...`:** Start your local agent and add your key:
  ```bash
  eval "$(ssh-agent -s)"
  ssh-add ~/.ssh/id_rsa  # Or the path to your specific key
  ```
  *(Note: On a Mac, this `ssh-add` command is not "sticky"; it must be re-performed in each shell. Because it asks for a passphrase, it is inefficient to add to a shell init resource script.)*

#### 2. Check the Environment on the Remote Server
After connecting with `ssh -A user@remote-server`, the remote `sshd` service creates a socket to talk back to your local agent. This is stored in `SSH_AUTH_SOCK`. On the **remote server**, run:
```bash
echo $SSH_AUTH_SOCK
```
* **If you see a path (e.g., `/tmp/ssh-XXXXXXXXXX/agent.12345`):** Forwarding is active.
* **If it prints nothing:** Agent forwarding failed. Proceed to the next step.

#### 3. Check the Remote Server's SSH Configuration
Ensure the remote server allows agent forwarding. Run on the remote server:
```bash
cat /etc/ssh/sshd_config | grep AllowAgentForwarding
```
* **`AllowAgentForwarding yes` (or commented out):** Correct. The issue lies elsewhere.
* **`AllowAgentForwarding no`:** The remote server explicitly forbids agent forwarding. You must change it to `yes` and restart the SSH service.

#### 4. Be Mindful of `sudo`
By default, `sudo` creates a clean environment and **strips** the `SSH_AUTH_SOCK` variable.
```bash
ssh git@github.com        # Works (uses forwarded key)
sudo ssh git@github.com   # Fails (environment stripped)
```
To run as another user (like root) while keeping your forwarded key, use `-E` to preserve the environment:
```bash
sudo -E ssh git@github.com
```
> **Warning:** Be cautious when using `sudo -E`. Passing your entire environment to the root user can have security implications if the root account could be accessed by others.

---

## 4. Advanced Maintenance & Routing

### Nested Jumps (Jumping from one SBC to another)
After verifying the agent forwarding is working, you can log into one SBC and securely jump to an internal one without placing keys on the intermediate hop.

1. Connect to an edge node (e.g., via a custom port `11447`):
   ```bash
   ssh user@107.192.228.159 -p 11447 -A
   ```
2. From *inside* that node, jump securely to the internal SBC (e.g., port `8020`):
   ```bash
   ssh user@81.31.108.83 -p 8020 -A
   ```
   You should then be logged into your internal node (e.g., `pubinv-sbc-3`)!

### Screen Management
For persistent background terminal sessions (especially useful when applying lengthy updates or monitoring logs):
* **Attach to an existing screen:**
  ```bash
  screen -r
  ```
* **Detach from a screen (leaving processes running):**
  Press `Ctrl + A`, then press `D`.

### Capturing Logs Across Custom Ports
When extracting logs from an SBC securely using SCP and agent forwarding:

1. Pulling logs from the internal SBC (`81.31.108.83`) to the intermediate server (`./logs`):
   ```bash
   scp -P 8020 -A user@81.31.108.83:~/splotch_website/server/server.log ./logs
   ```
2. Pulling logs from the intermediate server to your local machine:
   ```bash
   scp -P 11447 -A user@107.192.228.159:~/logs/server.log .
   ```

---

## 5. Media Drop Box & RGB Status Indicators

To turn the SBC into a headless "media drop box," the system can be configured to automatically save all processed images to an inserted USB HID device (thumb drive) so it can be physically unplugged and moved to the sticker printing PC. 

The GMKtec NucBox G2 Plus's built-in RGB array will be used to visually communicate the system and USB state to the physical operator without needing a monitor.

### Status Color Codes
* **Solid Green:** Safe to remove USB / Idle.
* **Blinking Red or Yellow:** Actively writing to the USB stick (DO NOT REMOVE).
* **Flash of Purple:** New order incoming.
* **Flashing Yellow:** Order is stuck/errored.

### A. OpenRGB Installation & I2C Configuration
The GMKtec chassis lighting is natively integrated at the firmware level but is fully compatible with OpenRGB on Linux over the SMBus/I2C kernel interface. This eliminates vendor bloatware.

1. **Install OpenRGB:**
   Download the appropriate package from the [official OpenRGB Downloads Page](https://openrgb.org/), or via apt if available:
   ```bash
   sudo add-apt-repository ppa:thopiekar/openrgb
   sudo apt update
   sudo apt install openrgb i2c-tools
   ```
2. **Enable I2C Kernel Modules (Crucial Step):**
   OpenRGB requires direct access to the I2C lines to detect the motherboard lighting.
   ```bash
   sudo modprobe i2c-dev
   sudo modprobe i2c-piix4  # For AMD processors (use i2c-i801 for Intel)
   ```
   *Make it permanent so it loads on boot:*
   ```bash
   echo "i2c-dev" | sudo tee -a /etc/modules
   echo "i2c-piix4" | sudo tee -a /etc/modules
   ```
3. **Scan Devices:**
   Run the OpenRGB CLI to scan your system's SMBus interfaces and map out the lighting parameters.
   ```bash
   openrgb --cli --list-devices
   ```

### B. USB Auto-Mounting (Media Drop Box)
To ensure all processed images are seamlessly saved and flushed to physical storage safely (and immediately), run the provided setup script.

1. **Run the Automount Setup Script:**
   ```bash
   sudo bash scripts/setup-usb-automount.sh
   ```
   This script configures `autofs` and `udev` to mount USB sticks robustly with the `sync` option, preventing data loss if the drive is removed.
   
2. **Trigger the Mount:**
   The `setup-usb-automount.sh` script maps USB devices to `/media/auto_mount_usb`. Whenever a process accesses that directory, `autofs` mounts the drive on the fly. To manually activate and list them, run:
   ```bash
   bash scripts/activate-usb-mounts.sh
   ```

### C. Integrating RGB with Application State
The Splotch Node.js application executes `openrgb` CLI commands during the order lifecycle.

**Example implementation (Bash wrapper):**
```bash
# Order Incoming (Purple Flash)
openrgb --mode direct --color A020F0

# Writing to USB (Blinking Red)
# (In script, loop between FF0000 and 000000, or use the hardware 'Breathing' mode)
openrgb --mode breathing --color FF0000

# Safe to Remove (Solid Green)
# Must run `sync` to flush USB buffers to the physical stick before turning green!
sync /media/splotch_usb
openrgb --mode direct --color 00FF00

# Order Stuck (Flashing Yellow)
openrgb --mode breathing --color FFFF00
```
*(Alternatively, you can change the LED Colour Settings in the GMKtec BIOS by repeatedly pressing Delete/F7 on boot -> Boot tab -> LED Colour Settings if a static color is preferred without software).*
