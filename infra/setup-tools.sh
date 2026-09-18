#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${SCRIPT_DIR}/bin"
mkdir -p "${BIN_DIR}"

echo "============================================================"
echo "   🛠️ HMS Cloud Tooling Checker & Setup                     "
echo "============================================================"

# 1. Check / Install Terraform
if command -v terraform &> /dev/null; then
    echo "✅ Terraform is already installed globally: $(terraform version | head -n 1)"
elif [ -f "${BIN_DIR}/terraform" ]; then
    echo "✅ Terraform is available locally in infra/bin: $("${BIN_DIR}/terraform" version | head -n 1)"
else
    echo "📦 Downloading portable Terraform binary (v1.9.5)..."
    TERRAFORM_VERSION="1.9.5"
    ZIP_URL="https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip"
    curl -fsSL "${ZIP_URL}" -o "${SCRIPT_DIR}/terraform.zip"
    unzip -q -o "${SCRIPT_DIR}/terraform.zip" -d "${BIN_DIR}"
    rm -f "${SCRIPT_DIR}/terraform.zip"
    chmod +x "${BIN_DIR}/terraform"
    echo "✅ Terraform installed into ${BIN_DIR}/terraform: $("${BIN_DIR}/terraform" version | head -n 1)"
fi

# 2. Check AWS CLI
if command -v aws &> /dev/null; then
    echo "✅ AWS CLI is installed: $(aws --version)"
else
    echo "⚠️  AWS CLI is not installed."
    echo "👉 Run: sudo apt install awscli -y"
fi

echo "============================================================"
