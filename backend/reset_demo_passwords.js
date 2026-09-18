require('dotenv').config();
const { User } = require('./models');

const resetMap = {
  superadmin: 'Superadmin@123',
  super_admin: 'Superadmin@123',
  super_admin_user: 'Superadmin@123',
  admin: 'Admin@123',
  doctor: 'Doctor@123',
  labtech: 'Labtech@123',
  receptionist: 'Receptionist@123',
  pharmacist: 'Pharmacist@123',
  nurse: 'Nurse@123',
};

async function resetDemoPasswords() {
  try {
    const usernames = Object.keys(resetMap);
    const users = await User.findAll({ where: { username: usernames } });

    for (const user of users) {
      user.password = resetMap[user.username];
      user.failed_attempts = 0;
      user.locked_until = null;
      user.first_login = 'N';
      await user.save();
      console.log(`RESET ${user.username}`);
    }

    const found = new Set(users.map((user) => user.username));
    for (const username of usernames) {
      if (!found.has(username)) {
        console.log(`MISSING ${username}`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Password reset failed:', err);
    process.exit(1);
  }
}

resetDemoPasswords();
