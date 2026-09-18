#!/usr/bin/env bash
set -e

# Change directory to the infra folder where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Include local portable binaries if installed in infra/bin
if [ -d "${SCRIPT_DIR}/bin" ]; then
    export PATH="${SCRIPT_DIR}/bin:${PATH}"
fi

echo "============================================================"
echo "   🏥 Hospital Management System (HMS) - Cloud Deployment   "
echo "============================================================"

# Verify Terraform is installed
if ! command -v terraform &> /dev/null; then
    echo "❌ Error: 'terraform' CLI is not installed."
    echo "👉 Install Terraform: https://developer.hashicorp.com/terraform/install"
    exit 1
fi

# Verify AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ Error: 'aws' CLI is not installed."
    echo "👉 Install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

# Verify AWS Authentication
echo "🔍 Checking AWS authentication..."
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ Error: AWS CLI is not authenticated."
    echo "👉 Run 'aws configure' to set up your AWS Access Key, Secret Key, and Region."
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
echo "✅ Authenticated to AWS Account: ${ACCOUNT_ID}"

# Initialize Terraform
echo ""
echo "📦 Initializing Terraform providers and modules..."
terraform init -input=false

# Apply Infrastructure
echo ""
echo "🚀 Provisioning AWS Infrastructure (EC2, Security Groups, Cloud-Init)..."
terraform apply -auto-approve -input=false

echo ""
echo "============================================================"
echo "   🎉 AWS INFRASTRUCTURE PROVISIONED SUCCESSFULLY!          "
echo "============================================================"
echo ""
terraform output
echo ""
echo "⏳ NOTE: The EC2 instance is now bootstrapping Docker and building"
echo "   containers in the background. Please allow 60 to 90 seconds"
echo "   for the frontend and backend services to become fully accessible."
echo ""
echo "👉 To monitor bootstrap progress on the instance:"
echo "   $(terraform output -raw ssh_command 2>/dev/null || echo 'ssh ubuntu@<ip>') 'sudo tail -f /var/log/hms-bootstrap.log'"
echo ""
echo "🛑 When you are done testing, run './destroy.sh' to terminate all"
echo "   AWS resources and keep your cloud costs at \$0.00."
echo "============================================================"
