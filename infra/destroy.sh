#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if [ -d "${SCRIPT_DIR}/bin" ]; then
    export PATH="${SCRIPT_DIR}/bin:${PATH}"
fi

echo "============================================================"
echo "   Hospital Management System (HMS) - Cloud Teardown        "
echo "============================================================"

# Verify Terraform is installed
if ! command -v terraform &> /dev/null; then
    echo "[ERROR] 'terraform' CLI is not installed."
    exit 1
fi

echo "[INFO] Destroying all AWS EC2 instances, security groups, and cloud resources..."
terraform destroy -auto-approve

echo ""
echo "============================================================"
echo "   ALL AWS RESOURCES DESTROYED SUCCESSFULLY                 "
echo "   Cloud charges stopped. Current running cost: \$0.00.       "
echo "============================================================"
