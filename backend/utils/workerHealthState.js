// Shared in-process status for background jobs. No patient or job payloads are stored.
const jobs = {};
function success(name) {
  const prior = jobs[name] || { failures: 0, consecutiveFailures: 0 };
  jobs[name] = { ...prior, consecutiveFailures: 0, lastSuccess: new Date().toISOString(), lastError: null };
}
function failure(name, error) {
  const prior = jobs[name] || { failures: 0, consecutiveFailures: 0 };
  jobs[name] = { ...prior, failures: prior.failures + 1, consecutiveFailures: prior.consecutiveFailures + 1, lastError: String(error?.code || error?.name || 'ERROR') };
}
module.exports = { jobs, success, failure };
