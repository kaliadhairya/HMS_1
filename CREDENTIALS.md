# 🏥 Hospital Management System (HMS) — Login Credentials

This document contains all user accounts, roles, and login credentials configured in the HMS system.

---

## 👥 System User Accounts

| Role | Name | Username | Password | Access / Permissions |
| :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | Super Administrator | `superadmin` | `Superadmin@123` | Full system access, all modules & configurations |
| **Administrator** | System Administrator | `admin` | `Admin@123` | Staff/User management, system dashboard, master data |
| **Doctor** | Dr. Ramesh Kumar | `doctor` | `Doctor@123` | OPD consultations, prescriptions, lab orders, IPD |
| **Receptionist** | Raman Sharma | `receptionist` | `Receptionist@123` | Patient registration, appointments, tokens, billing |
| **Pharmacist** | Suresh Gupta | `pharmacist` | `Pharmacist@123` | Pharmacy stock, dispensing, medicine batches, OTC |
| **Nurse** | Sister Mary | `nurse` | `Nurse@123` | IPD ward care, vitals tracking, nursing notes, MAR |
| **Lab Technician**| Amit Verma | `labtech` | `Labtech@123` | Lab investigations, sample testing, diagnostic reports |

---

## 🔐 Quick Reference List

- **Super Admin:** `superadmin` / `Superadmin@123`
- **Admin:** `admin` / `Admin@123`
- **Doctor:** `doctor` / `Doctor@123`
- **Receptionist:** `receptionist` / `Receptionist@123`
- **Pharmacist:** `pharmacist` / `Pharmacist@123`
- **Nurse:** `nurse` / `Nurse@123`
- **Lab Tech:** `labtech` / `Labtech@123`

---

## 🌐 Application URLs & Endpoints

- **Frontend Application:** [http://localhost:4999](http://localhost:4999)
- **Backend API:** [http://localhost:5001](http://localhost:5001)
- **API Health Check:** `http://localhost:5001/api/health`

---

## 🗄️ Database Credentials (PostgreSQL)

| Parameter | Value |
| :--- | :--- |
| **Database Host** | `/var/run/postgresql` (Unix Socket) or `localhost` |
| **Database Port** | `5432` |
| **Database Name** | `hms` |
| **Database User** | `postgres` |
| **Database Password** | `postgres` |

---

## 🛠️ Credential Management Scripts

- Reset all demo passwords:
  ```bash
  cd backend && node reset_demo_passwords.js
  ```
- Seed database with default users and master tables:
  ```bash
  cd backend && node init_database.js
  ```
