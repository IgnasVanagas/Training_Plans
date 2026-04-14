#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deployment/hetzner/bootstrap-ubuntu.sh"
  exit 1
fi

USERNAME="${SUDO_USER:-${USER:-root}}"
if [[ "${USERNAME}" == "root" ]]; then
  USERNAME="ubuntu"
fi

apt-get update
apt-get install -y ca-certificates curl gnupg git ufw fail2ban

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable" > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if id "${USERNAME}" >/dev/null 2>&1; then
  usermod -aG docker "${USERNAME}" || true
fi

systemctl enable docker
systemctl restart docker

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl enable fail2ban
systemctl restart fail2ban

echo "Bootstrap complete."
echo "Next: log out/in so docker group applies, then run deployment/hetzner/deploy.sh"
