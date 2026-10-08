#!/usr/bin/env bash
# Update AmoreChat from GitHub Releases, or switch to a specific version.
#   sudo bash deploy/update.sh            # latest release
#   sudo bash deploy/update.sh v0.1.0     # a specific version
# After the first run you can simply use:  sudo amorechat-update [version]
# Your data (data/), settings (.env), Caddyfile and certs/ are kept.
# Everything runs inside main(), which bash parses fully before running:
# this script replaces itself mid-run when switching versions.
main() {
set -euo pipefail
cd "${AMORECHAT_DIR:-$(dirname "$0")/..}"

REPO="${AMORECHAT_REPO:-amor7/AmoreChat}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo: sudo bash deploy/update.sh [version]"
  exit 1
fi
command -v curl >/dev/null 2>&1 || apt-get install -y curl

TAG="${1:-}"
if [ -z "$TAG" ]; then
  TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/' || true)
  [ -n "$TAG" ] || { echo "!! Could not reach GitHub to find the latest version."; exit 1; }
fi
case "$TAG" in v*) ;; *) TAG="v${TAG}" ;; esac

CURRENT="v$(grep -m1 '"version"' package.json | sed -E 's/.*"([0-9][^"]*)".*/\1/')"
echo ">> Installed: ${CURRENT}   Target: ${TAG}"
if [ "$CURRENT" = "$TAG" ] && [ "${FORCE:-}" != "1" ]; then
  echo ">> Already on ${TAG}. (Use FORCE=1 to reinstall.)"
  exit 0
fi
LOWEST=$(printf '%s\n%s\n' "${CURRENT#v}" "${TAG#v}" | sort -V | head -n1)
if [ "$LOWEST" = "${TAG#v}" ]; then
  echo "!! ${TAG} is OLDER than ${CURRENT}. A newer database may not work with an older version."
  echo "   A backup is taken first; to restore it see README (Backup and restore)."
  read -rp "Continue with the downgrade? [y/N] " ok </dev/tty
  [ "$ok" = "y" ] || [ "$ok" = "Y" ] || exit 1
fi

# Older installs mounted deploy/Caddyfile directly; keep any edits by moving them to ./Caddyfile.
[ -f Caddyfile ] || cp deploy/Caddyfile Caddyfile

if docker compose ps --status running --services 2>/dev/null | grep -qx app; then
  echo ">> Backing up the database..."
  docker compose exec -T app node server/src/backup-cli.js </dev/null || echo "!! Backup failed, continuing"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
BASE="https://github.com/${REPO}/releases/download/${TAG}"

echo ">> Downloading ${TAG} source..."
curl -fL --retry 3 -o "$TMP/source.tar.gz" "${BASE}/amorechat-source.tar.gz" || { echo "!! Version ${TAG} not found."; exit 1; }
if [ -d .git ]; then
  # Git checkout: move to the release tag so `git status` stays clean.
  git fetch -q --tags --force origin && git checkout -q -f "$TAG"
else
  # The archive holds code only, so data/, .env, Caddyfile and certs/ are untouched.
  tar xzf "$TMP/source.tar.gz" --strip-components=1
fi

if [ "$(uname -m)" = "x86_64" ] && curl -fL --retry 3 -o "$TMP/offline.tar.gz" "${BASE}/amorechat-offline-amd64.tar.gz"; then
  echo ">> Loading prebuilt images..."
  gunzip -c "$TMP/offline.tar.gz" | docker load
  docker compose up -d --no-build --remove-orphans
else
  echo ">> No prebuilt image for this server; building from source (needs Docker Hub + npm access)..."
  docker compose up -d --build --remove-orphans
fi

[ -f deploy/install-command.sh ] && bash deploy/install-command.sh . || true
echo ">> AmoreChat ${TAG} is running. Next time just run: sudo amorechat-update"
}

main "$@"
exit
