#!/usr/bin/env bash
set -euo pipefail
[ "$(uname -s)" = "Linux" ] || { echo "Linux only" >&2; exit 2; }
ACTION="${1:-status}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${BRIDGE_ENV_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/chatgpt-sol-local-bridge/runtime.env}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
NODE="$(command -v node)"
TUNNEL="$(command -v tunnel-client || true)"
SERVER_UNIT="chatgpt-sol-local-bridge.service"
TUNNEL_UNIT="chatgpt-sol-local-bridge-tunnel.service"

systemd_quote() {
  local value="${1//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

write_unit() {
  local target="$1"; shift
  local exec_line=""
  for arg in "$@"; do exec_line+="$(systemd_quote "$arg") "; done
  cat > "$UNIT_DIR/$target" <<EOF
[Unit]
Description=ChatGPT Sol Local Bridge ${target}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO
ExecStart=$exec_line
Restart=always
RestartSec=10
TimeoutStartSec=60
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
UMask=0077

[Install]
WantedBy=default.target
EOF
}

case "$ACTION" in
  install)
    [ -x "$TUNNEL" ] || { echo "tunnel-client not found" >&2; exit 1; }
    [ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE; run scripts/connect-chatgpt.sh" >&2; exit 1; }
    [ "$(stat -c '%a' "$ENV_FILE")" = "600" ] || { echo "$ENV_FILE must be mode 0600" >&2; exit 1; }
    mkdir -p "$UNIT_DIR"
    write_unit "$SERVER_UNIT" "$NODE" "$REPO/scripts/run-with-env.mjs" "$ENV_FILE" --exclude=CONTROL_PLANE_API_KEY -- "$NODE" "$REPO/src/server.js"
    write_unit "$TUNNEL_UNIT" "$NODE" "$REPO/scripts/run-with-env.mjs" "$ENV_FILE" -- "$NODE" "$REPO/scripts/run-tunnel.mjs" "$TUNNEL"
    systemctl --user daemon-reload
    systemctl --user enable --now "$SERVER_UNIT" "$TUNNEL_UNIT"
    sleep 2
    "$0" status
    ;;
  uninstall)
    systemctl --user disable --now "$TUNNEL_UNIT" "$SERVER_UNIT" >/dev/null 2>&1 || true
    rm -f "$UNIT_DIR/$TUNNEL_UNIT" "$UNIT_DIR/$SERVER_UNIT"
    systemctl --user daemon-reload
    echo "services uninstalled; runtime config and state were kept"
    ;;
  start) systemctl --user start "$SERVER_UNIT" "$TUNNEL_UNIT" ;;
  stop) systemctl --user stop "$TUNNEL_UNIT" "$SERVER_UNIT" ;;
  restart) systemctl --user restart "$SERVER_UNIT" "$TUNNEL_UNIT" ;;
  status)
    systemctl --user --no-pager status "$SERVER_UNIT" "$TUNNEL_UNIT"
    host="$($NODE "$REPO/scripts/runtime-value.mjs" "$ENV_FILE" HOST)"
    port="$($NODE "$REPO/scripts/runtime-value.mjs" "$ENV_FILE" PORT)"
    url_host="$host"; [[ "$url_host" == *:* ]] && url_host="[$url_host]"
    curl -fsS "http://$url_host:$port/healthz"
    tunnel_port="$($NODE "$REPO/scripts/runtime-value.mjs" "$ENV_FILE" TUNNEL_HEALTH_PORT)"
    curl -fsS "http://127.0.0.1:$tunnel_port/readyz"
    echo
    ;;
  logs) journalctl --user -n 100 --no-pager -u "$SERVER_UNIT" -u "$TUNNEL_UNIT" ;;
  logs-follow) echo "following logs; press Ctrl-C to stop"; journalctl --user -f -u "$SERVER_UNIT" -u "$TUNNEL_UNIT" ;;
  *) echo "Usage: $0 {install|uninstall|start|stop|restart|status|logs|logs-follow}" >&2; exit 2 ;;
esac
