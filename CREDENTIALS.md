# Hospital Management System (HMS) — Default Credentials

This document lists the default user accounts, roles, and system credentials configured for testing and demonstration.

---

## User Accounts

| Role | Name | Username | Password | Permissions |
| :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | Super Administrator | `superadmin` | `Superadmin@123` | Full administrative and configuration access |
| **Administrator** | System Administrator | `admin` | `Admin@123` | Staff management, analytics, master data |
| **Doctor** | Dr. Ramesh Kumar | `doctor` | `Doctor@123` | OPD encounters, prescriptions, diagnostic orders, IPD |
| **Receptionist** | Raman Sharma | `receptionist` | `Receptionist@123` | Patient registration, appointments, tokens, billing |
| **Pharmacist** | Suresh Gupta | `pharmacist` | `Pharmacist@123` | Pharmacy stock, dispensing, medicine batches, OTC |
| **Nurse** | Sister Mary | `nurse` | `Nurse@123` | IPD ward care, vitals tracking, nursing notes, MAR |
| **Lab Technician**| Amit Verma | `labtech` | `Labtech@123` | Diagnostic sample testing, laboratory reports |

---

## Service Endpoints

- **Frontend Application:** `http://localhost:4999`
- **Backend REST API:** `http://localhost:5001`
- **API Health Check:** `http://localhost:5001/api/health`

---

## Database Connection Parameters (PostgreSQL)

| Parameter | Default Value |
| :--- | :--- |
| **Host** | `/var/run/postgresql` (Unix Socket) or `localhost` |
| **Port** | `5432` |
| **Database** | `hms` |
| **Username** | `postgres` |
| **Password** | `postgres` |

---

## Administrative Scripts

- Reset default passwords:
  ```bash
  cd backend && node reset_demo_passwords.js
  ```
- Initialize and seed tables:
  ```bash
  cd backend && node init_database.js
  ```
