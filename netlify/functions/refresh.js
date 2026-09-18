const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { authCall, rest } = require('../lib/supabase');

const expired = () => new HttpError(401, 'unauthorized', 'Please log in.');

exports.handler = wrap(async (event) => {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');

    const { refresh_token } = parseBody(event);
    if (typeof refresh_token !== 'string' || !refresh_token) throw expired();

    const auth = await authCall('/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token },
    });
    if (!auth.ok || !auth.data || !auth.data.access_token || !auth.data.user) throw expired();

    const p = await rest(`/profiles?id=eq.${encodeURIComponent(auth.data.user.id)}&select=active&limit=1`);
    const profile = p.ok && Array.isArray(p.data) ? p.data[0] : null;
    if (!profile || !profile.active) throw expired();

    return json(200, {
        access_token: auth.data.access_token,
        refresh_token: auth.data.refresh_token,
        expires_at: auth.data.expires_at,
    });
});
