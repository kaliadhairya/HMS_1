#!/usr/bin/env bash
# ==============================================================================
# Hospital Management System (HMS) - One-Click AWS EC2 Deployment Script
# Supports: Ubuntu 20.04 / 22.04 / 24.04 LTS, Debian, Amazon Linux 2023
# ==============================================================================

set -euo pipefail

# ── Color Output Helpers ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

echo -e "${CYAN}"
cat << "BANNER"
================================================================================
   _  _ __  __ ___    ___             _                            _   
  | || |  \/  / __|  |   \ ___ _ __  | |___ _  _ _ __  ___ _ _  _| |_ 
  | __ | |\/| \__ \  | |) / -_) '_ \ | / _ \ || | '  \/ -_) ' \ _  _|
  |_||_|_|  |_|___/  |___/\___| .__/ |_\___/\_, |_|_|_\___|_||_| \__|
                              |_|           |__/                      
================================================================================
   Hospital Management System (HMS) — Automated EC2 Setup & Deployment
================================================================================
BANNER
echo -e "${NC}"

# ── Step 0: Ensure Root Privileges ───────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  warn "This script must run with administrative privileges. Re-running with sudo..."
  exec sudo bash "$0" "$@"
fi

# Detect non-root invoking user (usually 'ubuntu' or 'ec2-user')
INVOKING_USER="${SUDO_USER:-$USER}"
if [ "$INVOKING_USER" = "root" ]; then
  INVOKING_USER="ubuntu"
  if ! id "ubuntu" &>/dev/null; then
    INVOKING_USER="root"
  fi
fi
HOME_DIR=$(eval echo "~$INVOKING_USER")
APP_DIR="${HOME_DIR}/HMS_1"
REPO_URL="https://github.com/kaliadhairya/HMS_1.git"

info "Target user: ${INVOKING_USER}"
info "Target directory: ${APP_DIR}"

# ── Step 1: Configure 2GB Swap Memory (Prevents OOM during build) ─────────────
info "Checking system swap memory..."
TOTAL_SWAP=$(free -m | awk '/Swap:/ {print $2}')

if [ "$TOTAL_SWAP" -lt 1024 ]; then
  info "Configuring 2GB swap file to prevent compiler out-of-memory errors on small EC2 instances..."
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    if ! grep -q '/swapfile' /etc/fstab; then
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    success "2GB swap memory active."
  else
    swapon /swapfile 2>/dev/null || true
  fi
else
  info "Swap is already configured (${TOTAL_SWAP} MB available)."
fi

# ── Step 2: Install Essential Packages & System Updates ───────────────────────
info "Updating system packages and installing prerequisites..."
apt-get update -y
apt-get install -y ca-certificates curl gnupg git lsb-release jq

# ── Step 3: Install Docker & Docker Compose Plugin ────────────────────────────
if ! command -v docker &>/dev/null; then
  info "Docker not found. Installing official Docker Engine..."
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
  success "Docker Engine installed successfully."
else
  info "Docker is already installed ($(docker --version))."
fi

# Ensure docker service is enabled and started
systemctl enable docker
systemctl start docker

# Add non-root user to docker group
if [ "$INVOKING_USER" != "root" ]; then
  usermod -aG docker "$INVOKING_USER" || true
  info "Added user '${INVOKING_USER}' to the docker group."
fi

# ── Step 4: Clone / Update HMS Repository ─────────────────────────────────────
if [ -d "$APP_DIR" ]; then
  info "Repository already exists at ${APP_DIR}. Pulling latest changes..."
  cd "$APP_DIR"
  git fetch origin main
  git reset --hard origin/main
else
  info "Cloning repository from ${REPO_URL}..."
  sudo -u "$INVOKING_USER" git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# Fix file permissions
chown -R "$INVOKING_USER":"$INVOKING_USER" "$APP_DIR"

# ── Step 5: Release with the production configuration ─────────────────────────
# Production secrets live in .env (see .env.example) and are never generated or printed here.
# No demo data or demo accounts are loaded: the first administrator is created by hand.
if [ ! -f "$APP_DIR/.env" ]; then
  error "Create ${APP_DIR}/.env from .env.example (JWT_SECRET, database passwords, data keys, HMS_SITE_ADDRESS, GRAFANA_PASSWORD), then run this script again."
fi
# A first installation has no database yet: start it (and wait) so the release can back it up.
sudo -u "$INVOKING_USER" docker compose -f docker-compose.prod.yml up -d --wait db
info "Releasing HMS (backup, migrate, replace containers, health check, automatic rollback)..."
sudo -u "$INVOKING_USER" bash scripts/release.sh docker-compose.prod.yml

# ── Step 6: Check HTTPS ───────────────────────────────────────────────────────
if curl -skf https://127.0.0.1/api/ready >/dev/null 2>&1; then
  success "HMS answers over HTTPS."
else
  warn "HMS did not answer on https://127.0.0.1/api/ready yet: docker compose -f docker-compose.prod.yml logs proxy backend"
fi

# ── Step 7: Detect Public IP Address ──────────────────────────────────────────
# Try AWS IMDSv2 first
IMDS_TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)
PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)

# Fallback to public IP services
if [ -z "$PUBLIC_IP" ] || [[ "$PUBLIC_IP" =~ ^404 ]] || [[ "$PUBLIC_IP" == \<* ]]; then
  PUBLIC_IP=$(curl -s https://checkip.amazonaws.com 2>/dev/null || curl -s https://ifconfig.me 2>/dev/null || echo "YOUR_EC2_PUBLIC_IP")
fi

# ── Step 8: Display Access Summary ────────────────────────────────────────────
echo ""
echo -e "${GREEN}================================================================================${NC}"
echo -e "${GREEN}             🎉 HMS DEPLOYMENT COMPLETED SUCCESSFULLY!                         ${NC}"
echo -e "${GREEN}================================================================================${NC}"
echo ""
echo -e "${CYAN}Access:${NC}"
echo -e "  🌐 HMS : ${GREEN}https://<HMS_SITE_ADDRESS from .env>${NC}  (server address: ${PUBLIC_IP})"
echo -e "  📊 Grafana, Prometheus and the API listen on this server's loopback only; use an SSH tunnel."
echo ""
echo -e "${YELLOW}AWS Security Group inbound rules:${NC}"
echo -e "  - 443 and 80 (TCP) from the users' networks"
echo -e "  - 22 (SSH) from the administrators' network only"
echo ""
echo -e "${GREEN}================================================================================${NC}"
