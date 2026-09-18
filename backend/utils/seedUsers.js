require('dotenv').config();
const { sequelize } = require('../models');
const User = require('../models/User');

const seedUsers = [
  {
    username: 'admin',
    password: 'Admin@123',
    name: 'Hospital IT Admin',
    role: 'admin',
    isActive: 1,
  },
];

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to PostgreSQL DB');

    // Clear existing data
    await sequelize.query('DELETE FROM "HMS_TEST_REPORTS"');
    await sequelize.query('DELETE FROM "HMS_PATIENTS"');
    await sequelize.query('DELETE FROM "HMS_USERS"');
    console.log('🗑️  Cleared existing data');

    // Create users one by one so beforeCreate hook fires (password hashing)
    for (const userData of seedUsers) {
      await User.create(userData);
      console.log(`✅ Created user: ${userData.username} (${userData.role})`);
    }

    console.log('\n🎉 Seed complete! Login credentials:');
    seedUsers.forEach(u => {
      console.log(`   ${u.role.padEnd(15)} → username: ${u.username.padEnd(12)} password: ${u.password}`);
    });

    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    // await sequelize.close();
  }
}

seed();