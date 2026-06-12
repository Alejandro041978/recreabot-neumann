// Supabase helper — usado por todos los endpoints
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

export async function query(table, method = 'GET', body = null, params = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const r = await fetch(url, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Supabase error ${r.status}: ${err}`);
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

export function limaTime(isoStr) {
  try {
    return new Date(isoStr || new Date().toISOString()).toLocaleString('es-PE', {
      timeZone: 'America/Lima',
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: true
    });
  } catch(e) { return isoStr; }
}
