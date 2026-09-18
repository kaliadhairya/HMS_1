const fs = require('fs');
const path = require('path');

const files = [
  'pages/hms/billing/OPDBillingPage.jsx',
  'pages/hms/billing/BillingHistoryPage.jsx',
  'pages/hms/ipd/BedManagementPage.jsx',
  'pages/hms/ipd/IPDPatientListPage.jsx',
  'pages/hms/ipd/IPDPatientChartPage.jsx',
  'components/AdmissionModal.jsx',
  'components/dashboards/NurseDashboard.jsx'
];

files.forEach(f => {
  const p = path.join(__dirname, 'src', f);
  if (fs.existsSync(p)) {
    let content = fs.readFileSync(p, 'utf8');
    content = content.replace(/\\`/g, '`').replace(/\\\$/g, '$');
    fs.writeFileSync(p, content);
    console.log('Fixed', f);
  }
});
