#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 or 26.04 server for Bolt. Run as root, right after creating the server
# with your SSH key:   ssh root@SERVER 'bash -s' < deploy/setup-server.sh
# It creates the "bolt" user (your SSH key), locks SSH to keys only and no root login, turns on the
# firewall (SSH, HTTP, HTTPS), fail2ban, automatic security updates, exact time, and Docker.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run as root."; exit 1; fi
if [ ! -s /root/.ssh/authorized_keys ]; then echo "No SSH key on root: add yours first, or you'd lock yourself out."; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install ufw fail2ban unattended-upgrades chrony git docker.io docker-compose-v2 restic cron

# The user that runs everything (SSH with the same key as root; sudo; Docker)
id bolt >/dev/null 2>&1 || adduser --disabled-password --gecos "" bolt
usermod -aG sudo,docker bolt
install -d -m 700 -o bolt -g bolt /home/bolt/.ssh
install -m 600 -o bolt -g bolt /root/.ssh/authorized_keys /home/bolt/.ssh/authorized_keys
echo "bolt ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-bolt && chmod 440 /etc/sudoers.d/90-bolt

# SSH: keys only, no root login (01- so it wins over cloud-init's 50-cloud-init.conf: the first value read counts)
cat > /etc/ssh/sshd_config.d/01-bolt.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
CONF
systemctl reload ssh

# Firewall: only SSH, HTTP (certificate check) and HTTPS
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Brute-force protection, automatic security updates, exact time (trading APIs check signed timestamps)
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now chrony
timedatectl set-timezone UTC
systemctl enable --now docker

# Where Bolt lives
install -d -m 750 -o bolt -g bolt /srv/bolt /srv/bolt/data /srv/bolt/app

echo
echo "Done. From now on log in as: ssh bolt@$(hostname -I | awk '{print $1}')"
echo "Next: deploy/README.md, step 3."
