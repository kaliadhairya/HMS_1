require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { sequelize, Supplier } = require('./models');

async function run() {
  try {
    await sequelize.authenticate();
    const suppliers = await Supplier.findAll({ where: { supplierNumber: null } });
    for (const sup of suppliers) {
      const supplierNumber = `SUP-${sup.id.toString().padStart(3, '0')}-${Math.floor(Math.random() * 1000)}`;
      await sup.update({ supplierNumber });
      console.log(`Updated supplier ${sup.id} with ${supplierNumber}`);
    }
    console.log('Done fixing suppliers.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
