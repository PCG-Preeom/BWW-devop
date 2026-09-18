const { HttpError, json, wrap } = require('../lib/http');
const { requireSession } = require('../lib/auth');

exports.handler = wrap(async (event) => {
    if (event.httpMethod !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Use GET.');
    const { profile } = await requireSession(event, { allowPasswordChange: true });
    return json(200, {
        username: profile.username,
        role: profile.role,
        must_change_password: profile.must_change_password,
    });
});
