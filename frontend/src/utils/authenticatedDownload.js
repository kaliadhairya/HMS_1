import api from '../api/axios';

function filenameFromDisposition(disposition, fallback) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return disposition?.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

export async function openAuthenticatedBlob(url, options = {}) {
  const { download = false, filename = 'download' } = options;
  const previewWindow = download ? null : window.open('', '_blank');
  try {
    const response = await api.get(url, { responseType: 'blob' });
    const objectUrl = URL.createObjectURL(response.data);
    if (previewWindow) {
      previewWindow.location.replace(objectUrl);
    } else {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filenameFromDisposition(response.headers['content-disposition'], filename);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    if (previewWindow) previewWindow.close();
    throw error;
  }
}
