# Hospital Management System (HMS)

[![HMS CI/CD Pipeline](https://github.com/kaliadhairya/HMS_1/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/kaliadhairya/HMS_1/actions/workflows/ci-cd.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-2496ED.svg)](https://www.docker.com/)
[![Terraform](https://img.shields.io/badge/IaC-Terraform-7B42BC.svg)](https://www.terraform.io/)
[![AWS](https://img.shields.io/badge/Cloud-AWS%20EC2-FF9900.svg)](https://aws.amazon.com/)

A clinical and administrative hospital platform covering the end-to-end patient care lifecycle: registration, outpatient consultations, electronic prescriptions, pharmacy inventory, inpatient bed management, laboratory reporting, and itemized billing.

Built with Node.js, Express, React, PostgreSQL, Docker, and Terraform.

---

## System Architecture & Functional Modules

The system provides 7 role-specific dashboards with server-enforced permissions (`super_admin`, `admin`, `doctor`, `nurse`, `receptionist`, `lab_technician`, `pharmacist`):

- **Front Office & Registration:** Demographic intake, unique health identification (UHID) issuance, token scheduling, appointment management, and departmental routing.
- **Clinical Consultations (OPD):** Doctor encounter logs, ICD-10 diagnosis recording, medical history review, and electronic prescription generation.
- **Pharmacy & Inventory:** Drug master registry, batch/expiry monitoring, stock ledger tracking, Good Receipt Notes (GRN), dispensing, and over-the-counter (OTC) sales.
- **Inpatient Department (IPD):** Admission orders, ward/bed occupancy, medication administration records (MAR), vital sign tracking, and nursing progress charts.
- **Diagnostics & Laboratory:** Order processing, specimen status tracking, clinical value entry, and diagnostic report release.
- **Billing & Revenue:** Tariff schedules, itemized service invoicing, tax accounting, advance deposits, and settlement tracking.

---

## Technology Stack

| Layer | Component | Description |
| :--- | :--- | :--- |
| **Backend Runtime** | Node.js 20 LTS | Express 4.18 REST API layer |
| **Data Layer** | PostgreSQL 16 | Relational schema with Sequelize ORM |
| **Frontend** | React 18 & Vite 5 | SPA with React Router, Tailwind CSS, and TanStack Query |
| **Reverse Proxy** | Nginx Alpine | Serves production build and proxies `/api` endpoints |
| **Containerization** | Docker & Docker Compose | Multi-tier container topology with health checks |
| **Infrastructure as Code** | HashiCorp Terraform | Automated AWS EC2, Security Group, and Cloud-Init provisioning |
| **CI/CD** | GitHub Actions | Automated lint, build, Docker verification, and SSH deployment |

---

## Deployment

### 1. Cloud Deployment on AWS (Terraform)

The `infra/` directory defines the complete cloud infrastructure using Terraform.

**Prerequisites:**
- AWS CLI configured with active credentials (`aws configure`)
- Terraform CLI installed (v1.0+)

**Deploy:**
```bash
./infra/deploy.sh
```
This provisions:
1. An AWS EC2 instance (`t3.small` / `t2.micro`) within a configured Security Group (ports 22, 80, 443, 4999, 5001).
2. Cloud-init bootstrap configuring swap memory, Docker Engine, and Docker Compose.
3. Automated clone and startup of the multi-container stack.
4. Outputs the public IP address for web access (`http://<ec2-ip>:4999`).

**Teardown:**
To terminate all AWS resources and stop ongoing charges:
```bash
./infra/destroy.sh
```

---

### 2. Local Docker Deployment

#### Development Environment (Host PostgreSQL)
Runs the application containers connected to a local PostgreSQL instance:
```bash
docker compose up -d --build
```
- Web Application: `http://localhost:4999`
- REST API: `http://localhost:5001/api`

#### Standalone Production Stack (Self-Contained)
Runs the complete 3-tier architecture including a dedicated PostgreSQL container:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Continuous Integration & Delivery

The automated pipeline is defined in `.github/workflows/ci-cd.yml`:

1. **Lint & Test:** Runs dependency audits, route verification, and compiles the React production bundle.
2. **Container Verification:** Validates Docker Compose topology and runs Buildx image checks.
3. **Continuous Deployment:** On commits to `main`, executes an automated rolling update on the target AWS host via SSH.

---

## Verification & Testing

Run the end-to-end integration test suite:
```bash
cd backend
node smoke_critical_flows.js
```
The test suite validates:
- Role-based authentication and session token verification
- Patient registration and sequential UHID assignment
- OPD consultation workflows and prescription item persistence
- Pharmacy inventory deductions and stock ledger consistency
- Cashier advance transactions and billing settlement
