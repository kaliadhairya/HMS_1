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

# ── Step 5: Build and Start Docker Containers ─────────────────────────────────
info "Building and launching Docker stack (Postgres, Backend, Frontend, Prometheus, Grafana)..."
docker compose down --remove-orphans 2>/dev/null || true
docker compose up -d --build

# ── Step 6: Wait for Health Checks ────────────────────────────────────────────
info "Waiting for services to become healthy..."

MAX_WAIT=90
ELAPSED=0
BACKEND_HEALTHY=false

while [ $ELAPSED -lt $MAX_WAIT ]; do
  if curl -s -f http://127.0.0.1:5001/api/health >/dev/null 2>&1; then
    BACKEND_HEALTHY=true
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  echo -n "."
done
echo ""

if [ "$BACKEND_HEALTHY" = true ]; then
  success "Backend API is healthy and reachable on port 5001."
else
  warn "Backend took longer than expected to report healthy. Checking container logs..."
  docker compose logs --tail=20 backend
fi

# Check Frontend
if curl -s -f http://127.0.0.1:4999/healthz >/dev/null 2>&1; then
  success "Frontend Nginx is healthy and serving on port 4999."
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
echo -e "${CYAN}Access URLs:${NC}"
echo -e "  🌐 Frontend Application : ${GREEN}http://${PUBLIC_IP}:4999${NC}"
echo -e "  📊 Grafana Dashboards   : ${GREEN}http://${PUBLIC_IP}:3001${NC} (admin / admin)"
echo -e "  🩺 Backend Healthcheck  : ${GREEN}http://${PUBLIC_IP}:5001/api/health${NC}"
echo -e "  📈 Prometheus Metrics   : ${GREEN}http://${PUBLIC_IP}:9090${NC}"
echo ""
echo -e "${CYAN}Demo Credentials:${NC}"
echo -e "  • Superadmin  : ${YELLOW}superadmin${NC}   /  ${YELLOW}Superadmin@123${NC}"
echo -e "  • Doctor      : ${YELLOW}doctor${NC}       /  ${YELLOW}Doctor@123${NC}"
echo -e "  • Nurse       : ${YELLOW}nurse${NC}        /  ${YELLOW}Nurse@123${NC}"
echo -e "  • Pharmacist  : ${YELLOW}pharmacist${NC}   /  ${YELLOW}Pharmacist@123${NC}"
echo -e "  • Receptionist: ${YELLOW}receptionist${NC} /  ${YELLOW}Receptionist@123${NC}"
echo -e "  • System Admin: ${YELLOW}admin${NC}        /  ${YELLOW}Admin@123${NC}"
echo ""
echo -e "${YELLOW}IMPORTANT: AWS Security Group Inbound Rules Required!${NC}"
echo -e "Ensure your EC2 Security Group allows inbound traffic for these ports:"
echo -e "  - Port ${GREEN}4999${NC} (TCP) -> Custom TCP -> 0.0.0.0/0 (HMS Web Application)"
echo -e "  - Port ${GREEN}3001${NC} (TCP) -> Custom TCP -> 0.0.0.0/0 (Grafana Dashboard)"
echo -e "  - Port ${GREEN}22${NC}   (TCP) -> SSH -> Your IP"
echo ""
echo -e "${GREEN}================================================================================${NC}"
