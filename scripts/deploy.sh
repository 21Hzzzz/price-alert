#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/price-alert"
ENV_FILE="$APP_DIR/.env"
REPOSITORY_URL="https://github.com/21Hzzzz/price-alert.git"
DEFAULT_BRANCH="master"

die() { echo "Error: $*" >&2; exit 1; }
info() { echo "==> $*"; }

require_root() {
  [[ "${EUID}" -eq 0 ]] || die "Run this command as root."
}

require_supported_os() {
  [[ -f /etc/os-release ]] || die "Only Ubuntu/Debian is supported."
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID}" == "ubuntu" || "${ID}" == "debian" ]] || die "Only Ubuntu/Debian is supported."
}

install_docker() {
  apt-get update
  apt-get install -y ca-certificates curl git gnupg openssl
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  info "Installing Docker Engine and Docker Compose plugin"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/"$(. /etc/os-release && echo "$ID")"/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  local arch codename
  arch="$(dpkg --print-architecture)"
  codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  echo "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $codename stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

generate_password_hash() {
  docker run --rm -i oven/bun:1.3-alpine bun -e '
    const { randomBytes, scryptSync } = require("node:crypto")
    const password = (await Bun.stdin.text()).replace(/\r?\n$/, "")
    const salt = randomBytes(16).toString("base64url")
    process.stdout.write(`${salt}.${scryptSync(password, salt, 64).toString("base64url")}`)
  '
}

read_panel_password() {
  local password confirmation
  while true; do
    read -r -s -p "Panel password: " password
    echo >&2
    read -r -s -p "Confirm panel password: " confirmation
    echo >&2

    if [[ -z "$password" ]]; then
      echo "Panel password cannot be empty. Please try again." >&2
      continue
    fi
    if [[ "$password" != "$confirmation" ]]; then
      echo "Passwords do not match. Please enter the password again." >&2
      continue
    fi

    printf '%s' "$password"
    return
  done
}

read_domain() {
  local domain
  read -r -p "Domain name (for example alert.example.com): " domain
  [[ "$domain" =~ ^[A-Za-z0-9.-]+$ && "$domain" == *.* ]] || die "Enter a valid DNS name."
  printf '%s' "$domain"
}

ensure_runtime_directories() {
  mkdir -p "$APP_DIR/data" "$APP_DIR/caddy/data" "$APP_DIR/caddy/config"
}

usage() {
  cat <<'EOF'
Usage:
  deploy.sh install [--branch <branch>]
  deploy.sh update
  deploy.sh uninstall [--purge-data]
EOF
}

install_app() {
  local domain branch="$DEFAULT_BRANCH"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --branch) branch="${2:-}"; shift 2 ;;
      *) die "Unknown install option: $1" ;;
    esac
  done
  [[ -n "$branch" ]] || die "--branch cannot be empty."
  [[ ! -e "$APP_DIR" ]] || die "$APP_DIR already exists. Use update or remove it deliberately first."

  require_supported_os
  install_docker
  domain="$(read_domain)"
  info "Cloning $REPOSITORY_URL ($branch)"
  git clone --depth 1 --branch "$branch" "$REPOSITORY_URL" "$APP_DIR"
  ensure_runtime_directories

  local password hash
  password="$(read_panel_password)"
  hash="$(printf '%s' "$password" | generate_password_hash)"
  unset password

  umask 077
  cat > "$ENV_FILE" <<EOF
DOMAIN=$domain
PRICE_ALERT_ENCRYPTION_KEY=$(openssl rand -hex 32)
PANEL_PASSWORD_HASH=$hash
PANEL_SESSION_SECRET=$(openssl rand -hex 32)
PANEL_COOKIE_SECURE=true
DEPLOY_REPOSITORY=$REPOSITORY_URL
DEPLOY_BRANCH=$branch
EOF
  chmod 600 "$ENV_FILE"

  info "Building and starting Price Alert"
  (cd "$APP_DIR" && docker compose up -d --build --remove-orphans)
  info "Deployment complete: https://$domain"
}

update() {
  [[ -f "$ENV_FILE" && -d "$APP_DIR/.git" ]] || die "No installation found at $APP_DIR."
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  [[ -n "${DEPLOY_BRANCH:-}" ]] || die "DEPLOY_BRANCH is missing from $ENV_FILE."
  ensure_runtime_directories
  info "Updating source from ${DEPLOY_BRANCH}"
  git -C "$APP_DIR" fetch --depth 1 origin "$DEPLOY_BRANCH"
  git -C "$APP_DIR" reset --hard FETCH_HEAD
  info "Rebuilding containers; .env, data, and caddy directories are preserved"
  (cd "$APP_DIR" && docker compose up -d --build --remove-orphans)
}

uninstall() {
  local purge_data=false
  [[ "${1:-}" != "--purge-data" || $# -eq 1 ]] || die "Unknown uninstall option."
  [[ "${1:-}" == "--purge-data" ]] && purge_data=true
  [[ -d "$APP_DIR" ]] || die "No installation found at $APP_DIR."
  info "Stopping containers"
  (cd "$APP_DIR" && docker compose down --remove-orphans)
  if [[ "$purge_data" == true ]]; then
    info "Removing $APP_DIR including all persistent data"
    rm -rf "$APP_DIR"
  else
    info "Uninstalled containers. Configuration and persistent data remain in $APP_DIR."
  fi
}

main() {
  require_root
  local command="${1:-}"
  shift || true
  case "$command" in
    install) install_app "$@" ;;
    update) [[ $# -eq 0 ]] || die "update takes no options."; update ;;
    uninstall) uninstall "$@" ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
