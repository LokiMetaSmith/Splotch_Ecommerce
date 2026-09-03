#!/bin/bash

# ==============================================================================
# SBC Master Init Setup Script V1.0 (Cleaned for Splotch)
# ==============================================================================
# SBC requirements recommendations
# Ethernet Ports |  one   | two
# WiFi           | none   | yes 
# boot on power cycle | yes | yes
#
# download  Ubuntu Server 24.04.2 LTS                                                       
# copy to usb                                                                     
# plug in keyboard , display and usb to sbc
# power up sbc                                       
# when splash screen hit F12 or DEL 
# change Wake on Power to S0, such that "System will boot when power is applied"
# make sure Advanced->"Intel Trusted Execution Technology" enabled
#
# boot to usb, and make sure the SBC powers on automatically
# install ubuntu server name it 'pubinv-sbc-#' where # is the serial number of the Single board computer                                                      th
#   (don't choose minimal install, unless more testing is done)                                             
#   use entire disk                                                              
#   (you can turn off lvm - don't need it)                                     
#   install open ssh server                                                      
#   no need for any extra programs (at this time)                                
#   set username and password   
#   username: user password:(strong password, record for later use)                                                  
#   add GitHub Keys to SSH account by providing your github user name (case sensitive)
#
#   let install finish                                                           
#   unplug usb flash drive
#   reboot                                                                       
#   add personal ssh key, use the password recorded previously 
#   when logged in 
#   ssh-import-id gh:github_username
#   when on the same network
#   ssh-copy-id user@pubinv-sbc-#
#
# ssh into sbc, you must be on a computer that has valid github repo keys already
# the -A forwards your local ssh key agent to the remote
# (where # is the S/N of the sbc)
# ssh -A  user@pubinv-sbc-# 
# run the following
# sudo apt install git
# cd /home/user/
# git clone git@github.com:PubInv/NASA-MCOG.git -y
# the file should be executable but if not, run the following command: chmod +x /home/user/NASA-COG/'SBC setup instructions'
# run: ./home/user/NASA-COG/SBC/'SBC setup instructions'

echo "=========================================================="
echo "Starting SBC Init Provisioning Script..."
echo "=========================================================="

# 1. System Updates & Firmware
sudo apt update
sudo apt-get dist-upgrade -y
# check for firmware updates
sudo fwupdmgr get-upgrades
sudo fwupdmgr update -y

# 2. Install Core Utilities
# install your favorite editor (sudo apt install emacs-nox)                 
# install tmux https://github.com/tmux/tmux/wiki                                          
# edit /etc/dpkg/dpkg.cfg.d/excludes                                              
sudo apt install -y avahi-daemon bash-completion emacs-nox nano vim less build-essential python3-venv python3-pip git tmux net-tools moreutils fail2ban wormhole
# netstat -tulpn # to troubleshoot port issues

# comment out the excludes for man and docs                                    
sudo apt install -y man-db manpages manpages-dev manpages-posix manpages-posix-dev                                                                            
sudo mv /usr/bin/man.REAL /usr/bin/man || true
sudo mandb -c

# 3. UFW Firewall Configuration
sudo ufw allow ssh
sudo ufw status

# 4. USB Auto Mount Setup (Linked to our Splotch Drop Box script)
echo "Starting USB Automount Setup..."
# Ensure we are in the project directory where the script lives
cd "$(dirname "$0")"
if [ -f "./setup-usb-automount.sh" ]; then
    sudo bash ./setup-usb-automount.sh
else
    echo "Warning: ./setup-usb-automount.sh not found in current directory."
fi
echo "Ending USB Automount Setup."

echo "=========================================================="
echo " SBC Init Provisioning Complete!"
echo "=========================================================="
