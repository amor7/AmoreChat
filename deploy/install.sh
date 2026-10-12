#!/usr/bin/env bash
# Install or update AmoreChat on Ubuntu (22.04/24.04).
# Usage: sudo bash deploy/install.sh
#   Optional: sudo DOMAIN=chat.example.ir TLS_MODE=internal bash deploy/install.sh   (no questions)
# If an amorechat-offline-*.tar.gz bundle sits in the project folder, images are
# loaded from it, so no access to Docker Hub or npm is needed.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo: sudo bash deploy/install.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo ">> Installing Docker from Ubuntu repositories..."
  apt-get update
  apt-get install -y docker.io docker-compose-v2
  systemctl enable --now docker
fi

if [ ! -f .env ]; then
  DOMAIN="${DOMAIN:-}"
  [ -n "$DOMAIN" ] || read -rp "Domain or IP of this server (e.g. chat.example.ir or 185.1.2.3): " DOMAIN </dev/tty
  sed "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" .env.example > .env
  echo ">> Wrote .env"
fi

# SSL for a new install: Let's Encrypt needs international internet (now and for every renewal);
# "internal" is this server's own certificate authority and works fully offline, even on a bare IP.
if ! grep -q '^TLS_MODE=' .env; then
  DOMAIN_VAL=$(grep '^DOMAIN=' .env | cut -d= -f2)
  if [ -z "${TLS_MODE:-}" ]; then
    if [[ "$DOMAIN_VAL" =~ ^[0-9.]+$ ]]; then
      TLS_MODE=internal
    else
      echo "SSL certificate:"
      echo "  1) Let's Encrypt  - needs international internet now and every ~60 days"
      echo "  2) Server's own   - works fully offline; each device installs it once from http://${DOMAIN_VAL}/ca"
      m=1
      read -rp "Choose 1 or 2 [1]: " m </dev/tty 2>/dev/null || m=1
      if [ "$m" = "2" ]; then TLS_MODE=internal; else TLS_MODE=auto; fi
    fi
  fi
  echo "TLS_MODE=${TLS_MODE}" >> .env
  echo ">> SSL mode: ${TLS_MODE}"
fi

mkdir -p data certs
# Your own copy of the Caddy config: updates never overwrite it.
[ -f Caddyfile ] || cp deploy/Caddyfile Caddyfile
# The app runs as uid 1000 (user "node") inside the container.
chown -R 1000:1000 data
bash deploy/ensure-env.sh

BUNDLE=$(ls -t amorechat-offline-*.tar.gz 2>/dev/null | head -n1 || true)
if [ -n "${BUNDLE}" ]; then
  echo ">> Loading images from ${BUNDLE}..."
  gunzip -c "${BUNDLE}" | docker load
  docker compose up -d --no-build
else
  # No offline bundle: build from the source in this folder (e.g. after `git pull`).
  echo ">> Building from source (needs Docker Hub + npm access)..."
  docker compose up -d --build
fi

bash deploy/install-command.sh .

sleep 5
docker compose ps
echo
if docker compose logs app 2>/dev/null | grep -q "SETUP CODE"; then
  docker compose logs app | grep "SETUP CODE" | tail -n1
  echo "Open https://$(grep ^DOMAIN= .env | cut -d= -f2) and register the owner account with the code above."
else
  echo "Done. Open https://$(grep ^DOMAIN= .env | cut -d= -f2)"
fi
if grep -q '^TLS_MODE=internal' .env; then
  echo
  echo ">> Offline SSL: on every phone/computer first open  http://$(grep ^DOMAIN= .env | cut -d= -f2)/ca"
  echo "   and install the certificate (the Android app does not need it: http://$(grep ^DOMAIN= .env | cut -d= -f2)/app)"
fi
echo "To update later run: sudo amorechat-update   (or a version: sudo amorechat-update v0.2.0)"
echo "Without GitHub access: copy the release files to a folder and run: sudo amorechat-update /path/to/folder"
