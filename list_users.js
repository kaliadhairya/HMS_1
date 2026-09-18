require('dotenv').config({ path: './backend/.env' });
const { User } = require('./backend/models');

async function listUsers() {
  try {
    const users = await User.findAll();
    console.log('Current users in DB:');
    users.forEach(u => {
      console.log(`- ID: ${u.id}, Username: ${u.username}, Name: ${u.name}, Role: ${u.role}, IsActive: ${u.isActive}`);
    });
    process.exit(0);
  } catch (err) {
    console.error('Error fetching users:', err);
    process.exit(1);
  }
}

listUsers();
