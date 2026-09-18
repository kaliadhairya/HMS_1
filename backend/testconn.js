require('dotenv').config();
const { sequelize } = require('./models/db');

async function testConnection() {
  console.log(`🔍 Testing database connection to PostgreSQL at ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}...`);
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to PostgreSQL database successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  }
}

testConnection();
