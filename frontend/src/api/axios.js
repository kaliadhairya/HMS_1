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

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);
const MAX_NETWORK_RETRIES = 2;

// RFC 4122 v4 from getRandomValues, which (unlike randomUUID) also works on plain HTTP.
function newIdempotencyKey() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Every change carries an Idempotency-Key. If the network drops before an
// answer arrives, the request is retried with the same key, so the server
// either replays the original result or runs it once; it never runs twice.
api.interceptors.request.use((config) => {
  if (MUTATING.has(String(config.method).toLowerCase()) && !config.headers['Idempotency-Key']) {
    config.headers['Idempotency-Key'] = newIdempotencyKey();
  }
  return config;
});

// Handle 401 globally — redirect to login
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config;
    const uncertainCommit = err.response?.status === 503 && err.response?.data?.code === 'RESPONSE_NOT_DURABLE';
    if ((!err.response || uncertainCommit) && err.code !== 'ERR_CANCELED' && !config?.url?.includes('/auth/') && config?.headers?.['Idempotency-Key'] && (config.networkRetries || 0) < MAX_NETWORK_RETRIES) {
      config.networkRetries = (config.networkRetries || 0) + 1;
      await new Promise((resolve) => setTimeout(resolve, 500 * config.networkRetries));
      return api.request(config);
    }
    if (err.response?.status === 401 && !err.config.url.includes('/auth/login') && !err.config.url.includes('/auth/logout')) {
      localStorage.removeItem('lab_user');
      window.location.href = '/login';
    } else if (err.response?.status === 403) {
      // One message per screen instead of silently empty tables
      toast.error(err.response.data?.message || 'You do not have permission to view some of this information.', { id: 'forbidden' });
    } else if (err.response?.status === 503) {
      toast.error(err.response.data?.message || 'The service is temporarily unavailable. Your current work is preserved.', { id: 'service-unavailable', duration: 6000 });
    }

    return Promise.reject(err);
  }
);

export default api;
