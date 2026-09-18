const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const { sequelize } = require('./db');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    field: 'ID',
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    field: 'USERNAME',
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'PASSWORD',
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'NAME',
  },
  first_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'FIRST_NAME',
  },
  last_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'LAST_NAME',
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'PHONE',
  },
  role: {
    type: DataTypes.STRING(20),
    defaultValue: 'lab_technician',
    validate: {
      isIn: [['super_admin', 'admin', 'doctor', 'lab_technician', 'receptionist', 'pharmacist', 'nurse']]
    },
    field: 'ROLE',
  },
  department_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'DEPARTMENT_ID',
  },
  isActive: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    field: 'IS_ACTIVE',
  },
  first_login: {
    type: DataTypes.CHAR(1),
    defaultValue: 'Y',
    field: 'FIRST_LOGIN',
  },
  failed_attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'FAILED_ATTEMPTS',
  },
  locked_until: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'LOCKED_UNTIL',
  },
  last_login: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'LAST_LOGIN',
  },
  otp_code: {
    type: DataTypes.STRING(10),
    allowNull: true,
    field: 'OTP_CODE',
  },
  otp_expires: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'OTP_EXPIRES',
  },
}, {
  tableName: 'HMS_USERS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  hooks: {
    beforeCreate: async (user) => {
      user.password = await bcrypt.hash(user.password, 12);
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        user.password = await bcrypt.hash(user.password, 12);
      }
    },
  },
});

// Instance method to compare passwords
User.prototype.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = User;