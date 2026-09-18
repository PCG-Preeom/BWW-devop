const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { requireAdmin } = require('../lib/auth');
const { authCall, rest } = require('../lib/supabase');
const { assertUsername, assertPassword, assertRole, assertUuid, toEmail } = require('../lib/validate');

const SELECT = 'id,username,role,active,must_change_password,created_at';

async function findProfile(id) {
    const r = await rest(`/profiles?id=eq.${id}&select=${SELECT}&limit=1`);
    if (!r.ok) throw new Error(`Profile lookup failed: ${r.status}`);
    return Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
}

async function listUsers() {
    const r = await rest(`/profiles?select=${SELECT}&order=username.asc`);
    if (!r.ok) throw new Error(`Profile list failed: ${r.status}`);
    return json(200, { users: r.data });
}

async function createUser(event) {
    const body = parseBody(event);
    const username = assertUsername(body.username);
    const password = assertPassword(body.temp_password);
    const role = body.role === undefined ? 'user' : assertRole(body.role);

    const existing = await rest(`/profiles?username=eq.${encodeURIComponent(username)}&select=id&limit=1`);
    if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
        throw new HttpError(409, 'username_taken', 'That username already exists.');
    }

    const created = await authCall('/admin/users', {
        method: 'POST',
        key: 'service',
        body: { email: toEmail(username), password, email_confirm: true },
    });
    if (!created.ok || !created.data || !created.data.id) {
        if (created.status === 422) throw new HttpError(409, 'username_taken', 'That username already exists.');
        throw new Error(`Auth create failed: ${created.status}`);
    }

    const inserted = await rest('/profiles', {
        method: 'POST',
        prefer: 'return=representation',
        body: { id: created.data.id, username, role, must_change_password: true, active: true },
    });
    if (!inserted.ok || !Array.isArray(inserted.data) || !inserted.data[0]) {
        await authCall(`/admin/users/${created.data.id}`, { method: 'DELETE', key: 'service' });
        throw new Error(`Profile insert failed: ${inserted.status}`);
    }
    return json(201, { user: inserted.data[0] });
}

async function updateUser(event, session) {
    const body = parseBody(event);
    const id = assertUuid(body.id);
    const target = await findProfile(id);
    if (!target) throw new HttpError(404, 'not_found', 'User not found.');

    const updates = {};
    const authUpdates = {};
    if (body.role !== undefined) updates.role = assertRole(body.role);
    if (body.active !== undefined) {
        if (typeof body.active !== 'boolean') throw new HttpError(400, 'bad_active', 'Active must be true or false.');
        updates.active = body.active;
        authUpdates.ban_duration = body.active ? 'none' : '876000h';
    }
    if (body.temp_password !== undefined) {
        authUpdates.password = assertPassword(body.temp_password);
        updates.must_change_password = true;
    }

    const isSelf = id === session.profile.id;
    if (isSelf && ((updates.role && updates.role !== 'admin') || updates.active === false)) {
        throw new HttpError(400, 'cannot_modify_self', 'You cannot demote or disable your own account.');
    }
    if (!Object.keys(updates).length) throw new HttpError(400, 'nothing_to_update', 'Nothing to change.');

    if (Object.keys(authUpdates).length) {
        const a = await authCall(`/admin/users/${id}`, { method: 'PUT', key: 'service', body: authUpdates });
        if (!a.ok) throw new Error(`Auth update failed: ${a.status}`);
    }

    const r = await rest(`/profiles?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: updates });
    if (!r.ok || !Array.isArray(r.data) || !r.data[0]) throw new Error(`Profile update failed: ${r.status}`);
    return json(200, { user: r.data[0] });
}

async function deleteUser(event, session) {
    const id = assertUuid((event.queryStringParameters || {}).id);
    if (id === session.profile.id) {
        throw new HttpError(400, 'cannot_modify_self', 'You cannot delete your own account.');
    }
    const r = await authCall(`/admin/users/${id}`, { method: 'DELETE', key: 'service' });
    if (!r.ok && r.status !== 404) throw new Error(`Auth delete failed: ${r.status}`);
    return json(200, { ok: true });
}

exports.handler = wrap(async (event) => {
    const session = await requireAdmin(event);
    switch (event.httpMethod) {
        case 'GET': return listUsers();
        case 'POST': return createUser(event);
        case 'PATCH': return updateUser(event, session);
        case 'DELETE': return deleteUser(event, session);
        default: throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
    }
});
