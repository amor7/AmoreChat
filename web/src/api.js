export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch('/api' + url, {
      method,
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'amorechat', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('ارتباط با سرور برقرار نشد', 0);
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(data.error || 'خطا در ارتباط با سرور', res.status);
  return data;
}

export const fileUrl = (id, download = false) => `/api/files/${id}${download ? '?download=1' : ''}`;

// XHR instead of fetch so we get upload progress.
export function upload(blob, { name, meta = {}, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(Object.entries(meta).filter(([, v]) => v != null)).toString();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload' + (qs ? '?' + qs : ''));
    xhr.setRequestHeader('x-requested-with', 'amorechat');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.file);
      else reject(new ApiError(data.error || 'آپلود ناموفق بود', xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('ارتباط با سرور قطع شد', 0));
    const form = new FormData();
    form.append('file', blob, name || blob.name || 'file');
    xhr.send(form);
  });
}
