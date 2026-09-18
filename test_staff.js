const axios = require('axios');

async function testStaff() {
  try {
    const loginRes = await axios.post('http://localhost:5001/api/auth/login', {
      username: 'admin',
      password: 'Pass#admin123'
    });
    const token = loginRes.data.token;
    
    try {
      const staffRes = await axios.get('http://localhost:5001/api/admin/staff', {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('Success:', staffRes.data);
    } catch (e) {
      console.error('Staff error:', e.response?.data || e.message);
    }
  } catch (e) {
    console.error('Login error:', e.response?.data || e.message);
  }
}
testStaff();
