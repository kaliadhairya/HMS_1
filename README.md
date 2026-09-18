# Hospital Management System (HMS) — Enterprise Healthcare Platform

[![HMS CI/CD Pipeline](https://github.com/kaliadhairya/HMS-Hospital-Management-System/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/kaliadhairya/HMS-Hospital-Management-System/actions/workflows/ci-cd.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-2496ED.svg)](https://www.docker.com/)
[![Terraform](https://img.shields.io/badge/IaC-Terraform-7B42BC.svg)](https://www.terraform.io/)
[![AWS](https://img.shields.io/badge/Cloud-AWS%20EC2-FF9900.svg)](https://aws.amazon.com/)

A modular, enterprise-grade Hospital Management System supporting the full clinical lifecycle across 10 hospital domains with fine-grained 7-tier Role-Based Access Control (RBAC), atomic transactional integrity, and automated cloud infrastructure provisioning.

---

## 🏗️ Architecture & Core Modules

- **Authentication & RBAC**: JWT-based session security and role-specific permissions (Doctor, Nurse, Pharmacist, Lab Tech, Receptionist, Cashier, Admin).
- **Patient Management & OPD**: Demographics, UHID generation, token queuing, appointments, and vitals.
- **Doctor Consultation**: Clinical notes, ICD-10 diagnoses, medical history, and electronic prescriptions.
- **Pharmacy & Inventory**: Batch tracking, MRP/expiry management, stock ledger, GRN purchase orders, dispensing, and OTC sales.
- **IPD & Bed Management**: Ward allocation, bed transfers, admission charts, MAR (Medication Administration Records), and nursing progress notes.
- **Laboratory**: Test ordering, sample collection, specimen workflows, and report generation.
- **Billing & Cashier**: Consolidated invoicing, tariff schedules, itemized service billing, and patient advance receipts.

---

## 🚀 One-Script AWS Cloud Deployment (Terraform IaC)

The repository includes complete **Infrastructure as Code (IaC)** using HashiCorp Terraform to provision, bootstrap, and tear down an AWS cloud environment with zero manual configuration.

### 1. Prerequisites
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed and authenticated (`aws configure`).
- [Terraform CLI](https://developer.hashicorp.com/terraform/install) (v1.0+) installed.

### 2. Launch to AWS (1-Click)
Run the automated deployment script from your terminal:
```bash
./infra/deploy.sh
```
**What happens automatically:**
1. Terraform provisions an AWS EC2 instance (`t2.micro`, Free-Tier eligible) with configured security group boundaries (Ports 22, 4999, 5001, 80, 443).
2. EC2 bootstraps itself via cloud-init (`user_data`): configures 2GB swap space, installs Docker & Docker Compose.
3. Automatically clones the project and spins up the multi-tier container network (`docker-compose.prod.yml`).
4. Prints the live public web application URL (`http://<ec2-ip>:4999`) and backend health check endpoint.

### 3. Terminate & Zero-Cost Cloud Teardown
When you finish testing or demoing the application, tear down all AWS resources immediately to guarantee **$0.00 ongoing charges**:
```bash
./infra/destroy.sh
```

---

## 🐳 Docker Deployment Options

### Local Development (Host PostgreSQL)
Uses the local PostgreSQL socket with Docker containers for frontend and backend:
```bash
docker compose up -d --build
```
- Frontend: `http://localhost:4999`
- Backend API: `http://localhost:5001/api`

### Cloud / Standalone Deployment (Containerized PostgreSQL)
Runs the self-contained 3-tier architecture with a dedicated `postgres:16-alpine` database container:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

---

## 🔄 CI/CD Automation (GitHub Actions)

Continuous Integration and Delivery is defined in [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml):

1. **Stage 1: Test & Lint**: Installs dependencies, runs backend smoke checks, and compiles the React SPA via Vite.
2. **Stage 2: Docker Verification**: Validates Docker Compose topologies and builds production container images without cache failures.
3. **Stage 3: Automated Continuous Deployment**: Upon push to `main`, initiates remote deployment over SSH to the production AWS EC2 host with zero-downtime rolling reload.

---

## 🧪 Smoke Testing & Verification

Run the end-to-end critical path smoke tests:
```bash
cd backend
node smoke_critical_flows.js
```
The verification suite confirms:
- Multi-tier authentication & role gatekeeping
- Patient registration & UHID assignment
- OPD token and encounter workflows
- Electronic prescription generation & item persistence
- Pharmacy GRN intake & stock deduction consistency
- Receptionist visitor tracking & cash flow integration
