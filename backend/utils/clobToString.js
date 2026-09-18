/**
 * Convert text stream or buffer to string.
 * Resolves stream data chunks into standard string.
 */
async function clobToString(clob) {
  if (!clob) return null;
  if (typeof clob === 'string') return clob;
  return new Promise((resolve, reject) => {
    let str = '';
    clob.setEncoding('utf8');
    clob.on('data', chunk => str += chunk);
    clob.on('end', () => resolve(str));
    clob.on('error', reject);
  });
}

module.exports = { clobToString };
