const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { authCall, rest } = require('../lib/supabase');
const { cleanUsername, USERNAME_RE, toEmail } = require('../lib/validate');

const invalid = () => new HttpError(401, 'invalid_credentials', 'Invalid username or password.');

exports.handler = wrap(async (event) => {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');

    const { username, password } = parseBody(event);
    const name = cleanUsername(username);
    if (!USERNAME_RE.test(name) || typeof password !== 'string' || !password) throw invalid();

    const auth = await authCall('/token?grant_type=password', {
        method: 'POST',
        body: { email: toEmail(name), password },
    });
    if (!auth.ok || !auth.data || !auth.data.access_token || !auth.data.user) throw invalid();

    const p = await rest(`/profiles?id=eq.${encodeURIComponent(auth.data.user.id)}&select=username,role,active,must_change_password&limit=1`);
    const profile = p.ok && Array.isArray(p.data) ? p.data[0] : null;
    if (!profile || !profile.active) throw invalid();

    return json(200, {
        access_token: auth.data.access_token,
        refresh_token: auth.data.refresh_token,
        expires_at: auth.data.expires_at,
        username: profile.username,
        role: profile.role,
        must_change_password: profile.must_change_password,
    });
});
