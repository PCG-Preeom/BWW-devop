function setEnv() {
    process.env.SUPABASE_DATABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
}

function event({ method = 'GET', headers = {}, body, query = {} } = {}) {
    return {
        httpMethod: method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        queryStringParameters: query,
    };
}

// Replaces global fetch. `handler(url, opts)` returns {status, body} (or undefined => 404).
// Returns the array of recorded calls.
function mockFetch(handler) {
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => {
        calls.push({
            url: String(url),
            method: opts.method || 'GET',
            headers: opts.headers || {},
            body: opts.body ? JSON.parse(opts.body) : undefined,
        });
        const r = handler(String(url), opts) || { status: 404, body: { message: 'no route' } };
        return {
            ok: r.status >= 200 && r.status < 300,
            status: r.status,
            text: async () => (r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
        };
    };
    return calls;
}

// routes: [[method, urlSubstring, response | (url, opts) => response], ...]. First match wins.
function router(routes) {
    return (url, opts = {}) => {
        const method = opts.method || 'GET';
        for (const [m, part, resp] of routes) {
            if (m === method && url.includes(part)) {
                return typeof resp === 'function' ? resp(url, opts) : resp;
            }
        }
        return { status: 404, body: { message: `no route ${method} ${url}` } };
    };
}

module.exports = { setEnv, event, mockFetch, router };
