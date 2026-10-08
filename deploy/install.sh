#!/usr/bin/env bash
# Install or update AmoreChat on Ubuntu (22.04/24.04).
# Usage: sudo bash deploy/install.sh
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
  read -rp "Domain pointing to this server (e.g. chat.example.ir): " DOMAIN
  sed "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" .env.example > .env
  echo ">> Wrote .env"
fi

mkdir -p data certs
# The app runs as uid 1000 (user "node") inside the container.
chown -R 1000:1000 data

BUNDLE=$(ls -t amorechat-offline-*.tar.gz 2>/dev/null | head -n1 || true)
if [ -n "${BUNDLE}" ]; then
  echo ">> Loading images from ${BUNDLE}..."
  gunzip -c "${BUNDLE}" | docker load
fi

if docker image inspect amorechat:latest >/dev/null 2>&1; then
  docker compose up -d --no-build
else
  echo ">> No prebuilt image found; building (needs Docker Hub + npm access)..."
  docker compose up -d --build
fi

sleep 5
docker compose ps
echo
if docker compose logs app 2>/dev/null | grep -q "SETUP CODE"; then
  docker compose logs app | grep "SETUP CODE" | tail -n1
  echo "Open https://$(grep ^DOMAIN= .env | cut -d= -f2) and register the owner account with the code above."
else
  echo "Done. Open https://$(grep ^DOMAIN= .env | cut -d= -f2)"
fi
