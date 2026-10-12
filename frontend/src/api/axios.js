import axios from 'axios';
import toast from 'react-hot-toast';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

// The session is an HttpOnly cookie set at sign-in, so page scripts never see
// the token. X-Requested-With proves to the server that a state-changing
// request came from this app and not from a form on another site.
const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
});

// Handle 401 globally — redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/login') && !err.config.url.includes('/auth/logout')) {
      localStorage.removeItem('lab_user');
      window.location.href = '/login';
    } else if (err.response?.status === 403) {
      // One message per screen instead of silently empty tables
      toast.error(err.response.data?.message || 'You do not have permission to view some of this information.', { id: 'forbidden' });
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
