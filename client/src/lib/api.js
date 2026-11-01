export async function api(path, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch { throw Object.assign(new Error('Cannot reach the server. Check your connection.'), { status: 0 }); }
  let j = null;
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw Object.assign(new Error(j?.error || `Request failed (${r.status})`), { status: r.status, code: j?.code, data: j });
  return j;
}
