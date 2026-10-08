import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT to every request & adapt original HMS-NFL payloads to HMS_1 backend
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('lab_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // 1. Transparently rewrite original NFL employee endpoint to HMS_1 corporate endpoint
  if (config.url && config.url.includes('/patients/hms/nfl/')) {
    config.url = config.url.replace('/patients/hms/nfl/', '/patients/hms/emp/');
  }

  // 2. Map patientType for backend Sequelize validation compatibility
  if (config.data && typeof config.data === 'object' && !Array.isArray(config.data)) {
    if (config.data.patientType === 'nfl_employee') {
      config.data.patientType = 'corporate_employee';
    } else if (config.data.patientType === 'cisf_employee') {
      config.data.patientType = 'other';
    }

    // 3. Mirror treatment notes in Doctor Referrals
    if (config.data.treatmentNFL && !config.data.treatmentHospital) {
      config.data.treatmentHospital = config.data.treatmentNFL;
    }
  }

  return config;
});

// Handle 401 globally — redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/login')) {
      localStorage.removeItem('lab_token');
      localStorage.removeItem('lab_user');
      window.location.href = '/login';
    } else if (err.response?.status === 503) {
      // Store the maintenance message in localStorage to display it on the maintenance page
      if (err.response.data?.message) {
        localStorage.setItem('hms_maintenance_message', err.response.data.message);
      }
      window.location.href = '/maintenance';
    }

    return Promise.reject(err);
  }
);

export default api;
