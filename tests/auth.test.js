const test = require('node:test');
const assert = require('node:assert/strict');
const { setEnv, event, mockFetch, router } = require('./helpers');
const { requireSession, requireAdmin } = require('../netlify/lib/auth');

const UID = '11111111-1111-1111-1111-111111111111';
const withToken = () => event({ headers: { authorization: 'Bearer good-token' } });

function backend({ profile, userOk = true }) {
    return router([
        ['GET', '/auth/v1/user', userOk ? { status: 200, body: { id: UID } } : { status: 401, body: {} }],
        ['GET', '/rest/v1/profiles', { status: 200, body: profile ? [profile] : [] }],
    ]);
}
const profile = (over = {}) => ({ id: UID, username: 'bob', role: 'user', active: true, must_change_password: false, ...over });

test.beforeEach(setEnv);

test('rejects a missing token without calling Supabase', async () => {
    const calls = mockFetch(backend({ profile: profile() }));
    await assert.rejects(requireSession(event()), (e) => e.status === 401);
    assert.equal(calls.length, 0);
});

test('rejects an invalid token', async () => {
    mockFetch(backend({ profile: profile(), userOk: false }));
    await assert.rejects(requireSession(withToken()), (e) => e.status === 401);
});

test('rejects unknown or inactive profiles', async () => {
    mockFetch(backend({ profile: null }));
    await assert.rejects(requireSession(withToken()), (e) => e.status === 401);
    mockFetch(backend({ profile: profile({ active: false }) }));
    await assert.rejects(requireSession(withToken()), (e) => e.status === 401);
});

test('blocks users who must change their password unless allowed', async () => {
    mockFetch(backend({ profile: profile({ must_change_password: true }) }));
    await assert.rejects(requireSession(withToken()), (e) => e.status === 403 && e.code === 'password_change_required');
    const ok = await requireSession(withToken(), { allowPasswordChange: true });
    assert.equal(ok.profile.username, 'bob');
});

test('returns user and profile for a valid session', async () => {
    mockFetch(backend({ profile: profile() }));
    const s = await requireSession(withToken());
    assert.equal(s.user.id, UID);
    assert.equal(s.profile.role, 'user');
});

test('requireAdmin needs the admin role', async () => {
    mockFetch(backend({ profile: profile({ role: 'user' }) }));
    await assert.rejects(requireAdmin(withToken()), (e) => e.status === 403 && e.code === 'forbidden');
    mockFetch(backend({ profile: profile({ role: 'admin' }) }));
    assert.equal((await requireAdmin(withToken())).profile.role, 'admin');
});
