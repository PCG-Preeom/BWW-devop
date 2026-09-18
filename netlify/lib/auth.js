const { HttpError, bearer } = require('./http');
const { authCall, rest } = require('./supabase');

const NOT_LOGGED_IN = () => new HttpError(401, 'unauthorized', 'Please log in.');

async function requireSession(event, { allowPasswordChange = false } = {}) {
    const token = bearer(event);
    if (!token) throw NOT_LOGGED_IN();

    const u = await authCall('/user', { bearer: token });
    if (!u.ok || !u.data || !u.data.id) throw NOT_LOGGED_IN();

    const p = await rest(`/profiles?id=eq.${encodeURIComponent(u.data.id)}&select=id,username,role,active,must_change_password&limit=1`);
    const profile = p.ok && Array.isArray(p.data) ? p.data[0] : null;
    if (!profile || !profile.active) throw NOT_LOGGED_IN();

    if (profile.must_change_password && !allowPasswordChange) {
        throw new HttpError(403, 'password_change_required', 'You must set a new password first.');
    }
    return { user: u.data, profile };
}

async function requireAdmin(event) {
    const session = await requireSession(event);
    if (session.profile.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admins only.');
    return session;
}

module.exports = { requireSession, requireAdmin };
