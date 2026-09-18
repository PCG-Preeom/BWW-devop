const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { requireSession } = require('../lib/auth');
const { assertPassword } = require('../lib/validate');
const { authCall, rest } = require('../lib/supabase');

exports.handler = wrap(async (event) => {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');

    const { user, profile } = await requireSession(event, { allowPasswordChange: true });
    const password = assertPassword(parseBody(event).new_password);

    const updated = await authCall(`/admin/users/${user.id}`, {
        method: 'PUT',
        key: 'service',
        body: { password },
    });
    if (!updated.ok) throw new Error(`Auth password update failed: ${updated.status}`);

    const flag = await rest(`/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { must_change_password: false },
    });
    if (!flag.ok) throw new Error(`Profile update failed: ${flag.status}`);

    return json(200, { ok: true });
});
