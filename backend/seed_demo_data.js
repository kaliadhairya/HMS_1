/**
 * Seeds demo data for development: departments, wards and beds, a hospital
 * profile, the seven demo accounts (published
 * passwords, see CREDENTIALS.md), a supplier and common medicines.
 * Each group is inserted only when its table is empty.
 *
 * Never run against a real hospital database. The schema itself comes from
 * migrations: run "node migrate.js up" first.
 */
require('dotenv').config();
const { sequelize } = require('./models/db');
const bcrypt = require('bcryptjs');

async function seedDemoData() {
  try {
    await sequelize.authenticate();
    // ── SEED DATA ──
    console.log('\n📦 Seeding reference data...');
    const SEL = sequelize.constructor.QueryTypes.SELECT;

    // Check if departments already seeded
    const depts = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_DEPARTMENTS', { type: SEL });
    if (parseInt(depts[0].CNT || depts[0].cnt || 0) === 0) {
      const deptData = [
        ['General Medicine','MED','Ground Floor'], ['Surgery','SUR','First Floor'],
        ['Orthopaedics','ORT','First Floor'], ['Gynaecology','GYN','Second Floor'],
        ['Paediatrics','PED','Ground Floor'], ['ENT','ENT','Second Floor'],
        ['Pathology / Lab','LAB','Ground Floor'], ['Pharmacy','PHR','Ground Floor'],
        ['Emergency','EMR','Ground Floor'],
      ];
      for (const [n,s,f] of deptData) {
        await sequelize.query(`INSERT INTO HMS_DEPARTMENTS (NAME,SHORT_CODE,FLOOR_LOCATION) VALUES (:n,:s,:f)`,
          { replacements: { n, s, f } });
      }
      console.log('  ✅ Departments seeded');
    } else {
      console.log('  ⏭️  Departments already exist');
    }

    // Wards + Beds
    const wards = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_WARDS', { type: SEL });
    if (parseInt(wards[0].CNT || wards[0].cnt || 0) === 0) {
      await sequelize.query(`INSERT INTO HMS_WARDS (NAME,TYPE,FLOOR,TOTAL_BEDS) VALUES ('General Ward','General','Ground',20)`);
      await sequelize.query(`INSERT INTO HMS_WARDS (NAME,TYPE,FLOOR,TOTAL_BEDS) VALUES ('Semi-Private','Semi-Private','First',10)`);
      await sequelize.query(`INSERT INTO HMS_WARDS (NAME,TYPE,FLOOR,TOTAL_BEDS) VALUES ('Private Ward','Private','Second',8)`);
      await sequelize.query(`INSERT INTO HMS_WARDS (NAME,TYPE,FLOOR,TOTAL_BEDS) VALUES ('ICU','ICU','Third',6)`);
      await sequelize.query(`INSERT INTO HMS_BEDS (WARD_ID,ROOM_NUMBER,BED_NUMBER,STATUS) VALUES (1,'G-01','G-01-A','Available')`);
      await sequelize.query(`INSERT INTO HMS_BEDS (WARD_ID,ROOM_NUMBER,BED_NUMBER,STATUS) VALUES (1,'G-01','G-01-B','Available')`);
      await sequelize.query(`INSERT INTO HMS_BEDS (WARD_ID,ROOM_NUMBER,BED_NUMBER,STATUS) VALUES (2,'S-01','S-01-A','Available')`);
      await sequelize.query(`INSERT INTO HMS_BEDS (WARD_ID,ROOM_NUMBER,BED_NUMBER,STATUS) VALUES (3,'P-01','P-01-A','Available')`);
      await sequelize.query(`INSERT INTO HMS_BEDS (WARD_ID,ROOM_NUMBER,BED_NUMBER,STATUS) VALUES (4,'ICU-01','ICU-01','Available')`);
      console.log('  ✅ Wards & Beds seeded');
    } else {
      console.log('  ⏭️  Wards already exist');
    }

    // Hospital Profile
    const hp = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_HOSPITAL_PROFILE', { type: SEL });
    if (parseInt(hp[0].CNT || hp[0].cnt || 0) === 0) {
      await sequelize.query(`INSERT INTO HMS_HOSPITAL_PROFILE (NAME,TAGLINE,ADDRESS,CITY,STATE,PIN,PHONE,REG_NUMBER)
        VALUES ('City General Hospital','Excellence in Healthcare','100 Medical Center Blvd','Metropolis','State','100001','011-23456789','HOSP-2024-001')`);
      console.log('  ✅ Hospital Profile seeded');
    }

    // Permissions come from migrations/0002_default_permissions.sql.

    // Seeding Users for all clinical & administrative roles
    const usersCount = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_USERS', { type: SEL });
    if (parseInt(usersCount[0].CNT || usersCount[0].cnt || 0) === 0) {
      console.log('📦 Seeding users for clinical and administrative roles...');

      const defaultUsers = [
        { username: 'superadmin', name: 'Super Administrator', role: 'super_admin', password: 'Superadmin@123' },
        { username: 'admin', name: 'System Administrator', role: 'admin', password: 'Admin@123' },
        { username: 'doctor', name: 'Dr. Ramesh Kumar', role: 'doctor', password: 'Doctor@123' },
        { username: 'receptionist', name: 'Raman Sharma', role: 'receptionist', password: 'Receptionist@123' },
        { username: 'pharmacist', name: 'Suresh Gupta', role: 'pharmacist', password: 'Pharmacist@123' },
        { username: 'nurse', name: 'Sister Mary', role: 'nurse', password: 'Nurse@123' },
        { username: 'labtech', name: 'Amit Verma', role: 'lab_technician', password: 'Labtech@123' },
      ];

      for (const u of defaultUsers) {
        const hashedPassword = await bcrypt.hash(u.password, 12);
        // Find general medicine department for doctor and others
        let departmentId = null;
        if (u.role === 'doctor') departmentId = 1; // General Medicine
        if (u.role === 'lab_technician') departmentId = 7; // Pathology / Lab
        if (u.role === 'pharmacist') departmentId = 8; // Pharmacy

        await sequelize.query(`
          INSERT INTO HMS_USERS (USERNAME, PASSWORD, NAME, ROLE, DEPARTMENT_ID, IS_ACTIVE, FIRST_LOGIN)
          VALUES (:username, :password, :name, :role, :departmentId, 1, 'N')
        `, {
          replacements: {
            username: u.username,
            password: hashedPassword,
            name: u.name,
            role: u.role,
            departmentId: departmentId
          }
        });
      }

      console.log('  ✅ Default users seeded.');

      // Link the seeded doctor to HMS_DOCTORS if not already linked
      const docCount = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_DOCTORS', { type: SEL });
      if (parseInt(docCount[0].CNT || docCount[0].cnt || 0) === 0) {
        const [[doctorUser]] = await sequelize.query(`SELECT ID FROM HMS_USERS WHERE ROLE = 'doctor' LIMIT 1`);
        if (doctorUser) {
          await sequelize.query(`
            INSERT INTO HMS_DOCTORS (USER_ID, DEPARTMENT_ID, SPECIALITY, REGISTRATION_NUMBER, QUALIFICATIONS, IS_ACTIVE)
            VALUES (:userId, 1, 'General Medicine', 'REG-12345', 'MBBS, MD', 'Y')
          `, {
            replacements: { userId: doctorUser.id || doctorUser.ID }
          });
          console.log('  ✅ Doctor linked to General Medicine department in HMS_DOCTORS.');
        }
      }
    } else {
      console.log('  ⏭️  Users already exist');
    }

    // Seed default supplier
    const supps = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_SUPPLIERS', { type: SEL });
    if (parseInt(supps[0].CNT || supps[0].cnt || 0) === 0) {
      await sequelize.query(`
        INSERT INTO HMS_SUPPLIERS (NAME, CONTACT_PERSON, PHONE, EMAIL, ADDRESS, GSTIN, IS_ACTIVE)
        VALUES ('Generic Pharma Distributors', 'Rajesh Khanna', '9876543210', 'info@genericpharma.com', 'Phase 1, Industrial Area, Central Zone', '03AAAAA1111A1Z1', 1)
      `);
      console.log('  ✅ Default supplier seeded');
    }

    // Seed standard medicines
    const meds = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_MEDICINES', { type: SEL });
    if (parseInt(meds[0].CNT || meds[0].cnt || 0) === 0) {
      const medicineData = [
        ['Paracetamol', 'Crocin, Calpol', 'Tablet', '500', 'mg', 'Strip of 10', 12.00],
        ['Ibuprofen', 'Brufen', 'Tablet', '400', 'mg', 'Strip of 15', 12.00],
        ['Amoxicillin', 'Novamox', 'Capsule', '500', 'mg', 'Strip of 10', 12.00],
        ['Metformin', 'Glycomet', 'Tablet', '500', 'mg', 'Strip of 20', 12.00],
        ['Atorvastatin', 'Lipivas', 'Tablet', '10', 'mg', 'Strip of 10', 12.00],
      ];
      for (const [gen, brand, form, str, unit, sale, gst] of medicineData) {
        await sequelize.query(`
          INSERT INTO HMS_MEDICINES (GENERIC_NAME, BRAND_NAMES, FORMULATION, STRENGTH, STRENGTH_UNIT, UNIT_OF_SALE, GST_RATE, IS_ACTIVE)
          VALUES (:gen, :brand, :form, :str, :unit, :sale, :gst, 1)
        `, {
          replacements: { gen, brand, form, str, unit, sale, gst }
        });
      }
      console.log('  ✅ Standard medicines seeded');
    }

    console.log('\n🎉 Demo data ready.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Demo data seeding failed:', err.message);
    process.exit(1);
  }
}

seedDemoData();
