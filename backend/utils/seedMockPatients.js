const { sequelize } = require('../models/db');

const FIRST_NAMES_MALE = [
  "Rajesh", "Amit", "Sunil", "Vikas", "Raman", "Pankaj", "Deepak", "Sanjay", 
  "Gurpreet", "Manpreet", "Harpreet", "Surinder", "Tarun", "Nikhil", "Ashok", 
  "Vijay", "Rohit", "Gaurav", "Manish", "Dinesh", "Karan", "Rahul", "Varun", 
  "Arun", "Bikram", "Jaswinder", "Kuldeep", "Baldev", "Mohan", "Rakesh"
];

const FIRST_NAMES_FEMALE = [
  "Priya", "Sunita", "Anita", "Pooja", "Aarti", "Simran", "Harleen", "Jaspreet", 
  "Ritu", "Neha", "Kavita", "Suman", "Meena", "Reena", "Jyoti", "Shweta", 
  "Anju", "Monika", "Rekha", "Divya", "Anjali", "Surbhi", "Sapna", "Geeta", "Kiran"
];

const LAST_NAMES = [
  "Sharma", "Verma", "Singh", "Kaur", "Gupta", "Kumar", "Saini", "Thakur", 
  "Chaudhary", "Rana", "Bhasin", "Garg", "Bansal", "Mehta", "Khosla", 
  "Kapoor", "Arora", "Bhatt", "Joshi", "Suri", "Dhiman", "Sodhi", "Gill", "Kamboj"
];

const DIAGNOSES = [
  "Acute Gastroenteritis", "Essential Hypertension", "Type 2 Diabetes Mellitus",
  "Upper Respiratory Tract Infection", "Viral Fever with Body Ache", "Bronchial Asthma",
  "Lumbar Spondylosis", "Allergic Rhinitis", "Migraine Headache", "Hypothyroidism",
  "Osteoarthritis Knee", "Urinary Tract Infection", "Acid Peptic Disease",
  "Allergic Dermatitis", "Iron Deficiency Anemia", "Typhoid Fever", "Acute Tonsillitis",
  "Benign Prostatic Hyperplasia", "Dyspepsia", "Renal Calculus"
];

const BLOOD_GROUPS = ['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-'];
const WARDS = ['Medical', 'Surgical', 'Gynaecology', 'Private'];
const RELATIONSHIPS = ['Self', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother'];
const CITIES = ['Metro City', 'Central District', 'North Zone', 'South City', 'West Suburb', 'East Valley'];

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomPhone() {
  const prefix = ['98', '97', '94', '81', '82', '70', '95'][Math.floor(Math.random() * 7)];
  const rest = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  return prefix + rest;
}

function getRandomDateInPastDays(daysBack) {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * daysBack));
  return date.toISOString().split('T')[0];
}

async function seedMockPatients(count = 100) {
  console.log(`🚀 Starting to seed ${count} mock patients...`);

  // Verify registeredby user exists (receptionist or admin)
  const [[userRow]] = await sequelize.query(`SELECT ID FROM HMS_USERS WHERE ROLE = 'receptionist' LIMIT 1`);
  const registeredBy = userRow ? userRow.id || userRow.ID : 100;

  let insertedCount = 0;

  for (let i = 0; i < count; i++) {
    const isMale = Math.random() > 0.45;
    const gender = isMale ? 'Male' : 'Female';
    const firstName = getRandomItem(isMale ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE);
    const lastName = getRandomItem(LAST_NAMES);
    const fullName = `${firstName} ${lastName}`;
    const age = getRandomInt(4, 82);

    // Patient type distribution: 40% Corporate, 20% CISF, 40% Other
    const rType = Math.random();
    let patientType = 'other';
    let empNumber = null;
    let relationship = null;
    let phoneNumber = getRandomPhone();

    if (rType < 0.40) {
      patientType = 'corporate_employee';
      empNumber = `EMP-${getRandomInt(1000, 3999)}`;
      relationship = getRandomItem(RELATIONSHIPS);
    } else if (rType < 0.60) {
      patientType = 'cisf_employee';
      empNumber = `CISF-${getRandomInt(5000, 7999)}`;
      relationship = 'Self';
    }

    const opdIndoor = Math.random() > 0.85 ? 'Indoor' : 'OPD';
    const ward = opdIndoor === 'Indoor' ? getRandomItem(WARDS) : 'N/A';
    const testDate = getRandomDateInPastDays(90);
    const provDiagnosis = getRandomItem(DIAGNOSES);
    const bloodGroup = getRandomItem(BLOOD_GROUPS);
    const city = getRandomItem(CITIES);

    // DOB calculation from age
    const dobYear = new Date().getFullYear() - age;
    const dob = `${dobYear}-0${getRandomInt(1, 9)}-${String(getRandomInt(1, 28)).padStart(2, '0')}`;

    try {
      await sequelize.transaction(async (t) => {
        // Fetch sequence IDs
        const [[{ NEXTVAL: nextId }]] = await sequelize.query("SELECT nextval('hms_patients_seq') AS \"NEXTVAL\"", { transaction: t });
        const [[{ NEXTVAL: reportId }]] = await sequelize.query("SELECT nextval('hms_test_reports_seq') AS \"NEXTVAL\"", { transaction: t });

        const year = new Date().getFullYear();
        const paddedId = String(nextId).padStart(6, '0');
        const uhid = `HOSP-${year}-${paddedId}`;

        // Insert patient
        await sequelize.query(`
          INSERT INTO HMS_PATIENTS (
            ID, UHID, NAME, FIRST_NAME, LAST_NAME, AGE, GENDER, PATIENTTYPE, OPDINDOOR, WARD,
            TESTDATE, PROVDIAGNOSIS, EMPNUMBER, RELATIONSHIP, PHONENUMBER,
            DOB, BLOOD_GROUP, HOUSE_NO, STREET, CITY, STATE, PIN, COUNTRY,
            EMERGENCY_CONTACT_NAME, EMERGENCY_CONTACT_RELATION, EMERGENCY_CONTACT_PHONE,
            REGISTEREDBY, IS_ACTIVE, CREATED_AT, UPDATED_AT
          ) VALUES (
            :id, :uhid, :name, :firstName, :lastName, :age, :gender, :patientType, :opdIndoor, :ward,
            TO_DATE(:testDate, 'YYYY-MM-DD'), :provDiagnosis, :empNumber, :relationship, :phoneNumber,
            TO_DATE(:dob, 'YYYY-MM-DD'), :bloodGroup, :houseNo, :street, :city, 'Punjab', '140126', 'India',
            :emergencyName, :emergencyRel, :emergencyPhone,
            :registeredBy, 1, CURRENT_TIMESTAMP - (INTERVAL '1 day' * :daysAgo), CURRENT_TIMESTAMP
          )
        `, {
          replacements: {
            id: nextId,
            uhid: uhid,
            name: fullName,
            firstName,
            lastName,
            age,
            gender,
            patientType,
            opdIndoor,
            ward,
            testDate,
            provDiagnosis,
            empNumber,
            relationship,
            phoneNumber,
            dob,
            bloodGroup,
            houseNo: `Qtr No. ${getRandomInt(10, 450)}`,
            street: `Sector ${getRandomInt(1, 5)}`,
            city,
            emergencyName: `${getRandomItem(FIRST_NAMES_MALE)} ${lastName}`,
            emergencyRel: 'Relative',
            emergencyPhone: getRandomPhone(),
            registeredBy,
            daysAgo: getRandomInt(0, 90)
          },
          transaction: t
        });

        // Insert default draft test report
        await sequelize.query(`
          INSERT INTO HMS_TEST_REPORTS (
            ID, PATIENT_ID, REPORTED_BY, STATUS, CREATED_AT, UPDATED_AT
          ) VALUES (
            :id, :patientId, :reportedBy, 'Draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `, {
          replacements: {
            id: reportId,
            patientId: nextId,
            reportedBy: registeredBy
          },
          transaction: t
        });
      });

      insertedCount++;
      if (insertedCount % 20 === 0) {
        console.log(` progress: ${insertedCount}/${count} patients seeded.`);
      }
    } catch (err) {
      console.error(` Error inserting mock patient #${i + 1}:`, err.message);
    }
  }

  console.log(`✅ Successfully seeded ${insertedCount} mock patients into HMS_PATIENTS!`);
  process.exit(0);
}

seedMockPatients(100).catch((err) => {
  console.error("Fatal seed error:", err);
  process.exit(1);
});
