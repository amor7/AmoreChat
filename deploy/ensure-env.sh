#!/usr/bin/env bash
# Fills in settings newer versions need, without touching existing values.
# Called by install.sh and update.sh from the project folder.
set -euo pipefail

touch .env
has() { grep -q "^$1=." .env; }

if ! has LIVEKIT_API_SECRET; then
  sed -i '/^LIVEKIT_API_SECRET=/d' .env
  echo "LIVEKIT_API_SECRET=$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')" >> .env
  echo ">> Generated a LiveKit secret in .env"
fi

if ! has PUBLIC_IP; then
  IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)
  sed -i '/^PUBLIC_IP=/d' .env
  echo "PUBLIC_IP=${IP}" >> .env
  echo ">> Detected server IP: ${IP:-unknown} (PUBLIC_IP in .env)"
  if [ -z "$IP" ] || echo "$IP" | grep -Eq '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'; then
    echo "!! That looks like a private address. Put the server's PUBLIC IP in .env (PUBLIC_IP=...)"
    echo "   or calls will not connect, then run: sudo docker compose up -d"
  fi
fi

if ! grep -q '^TLS_MODE=' .env; then
  echo "TLS_MODE=auto" >> .env
fi

# Caddyfile: older installs have a copy without the TLS_MODE switch. Replace it if it is
# an unmodified stock copy (only comments differ); keep it if the owner edited it.
if [ -f Caddyfile ] && ! grep -q 'tls-{\$TLS_MODE' Caddyfile; then
  stock=$(grep -v '^\s*#' Caddyfile | tr -d ' \t\n')
  old1=$(printf '{$DOMAIN}{encodezstdgzipreverse_proxyapp:3000}')
  if [ "$stock" = "$old1" ]; then
    cp Caddyfile Caddyfile.bak
    cp deploy/Caddyfile Caddyfile
    echo ">> Updated Caddyfile (TLS_MODE support). Old one saved as Caddyfile.bak"
  else
    echo "!! Your Caddyfile was customised, so it was kept. Compare with deploy/Caddyfile to get TLS_MODE support."
  fi
fi

# Open the media ports on ufw if it is active (the provider's cloud firewall must be opened by hand).
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  for p in 80/tcp 443/tcp 443/udp 7881/tcp 7882/udp 3478/udp; do ufw allow "$p" >/dev/null; done
  echo ">> ufw: opened 80, 443, 7881/tcp, 7882/udp, 3478/udp"
fi
