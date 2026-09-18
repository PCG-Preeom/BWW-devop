function need(value, name) {
    if (!value) throw new Error(`${name} is not set`);
    return value;
}

async function call(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    let data = null;
    if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
    }
    return { ok: res.ok, status: res.status, data };
}

// Supabase Auth (GoTrue). key: 'anon' (default) or 'service'.
function authCall(path, { method = 'GET', body, bearer, key = 'anon' } = {}) {
    const base = need(process.env.SUPABASE_DATABASE_URL, 'SUPABASE_DATABASE_URL').replace(/\/+$/, '');
    const apikey = key === 'service'
        ? need(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY')
        : need(process.env.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY');
    return call(`${base}/auth/v1${path}`, {
        method,
        headers: { apikey, Authorization: `Bearer ${bearer || apikey}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

// PostgREST using the service-role key (bypasses row-level security).
function rest(path, { method = 'GET', body, prefer } = {}) {
    const base = need(process.env.SUPABASE_DATABASE_URL, 'SUPABASE_DATABASE_URL').replace(/\/+$/, '');
    const key = need(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
    const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    return call(`${base}/rest/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

module.exports = { authCall, rest };
