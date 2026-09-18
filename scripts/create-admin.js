// One-time bootstrap: creates the first admin account.
// Usage: SUPABASE_DATABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-admin.js <username> <temp_password>

const { cleanUsername, USERNAME_RE, toEmail } = require('../netlify/lib/validate');

async function main() {
    const [, , rawUsername, password] = process.argv;
    const base = process.env.SUPABASE_DATABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!rawUsername || !password) {
        console.error('Usage: node scripts/create-admin.js <username> <temp_password>');
        process.exit(1);
    }
    if (!base || !serviceKey) {
        console.error('Set SUPABASE_DATABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
        process.exit(1);
    }

    const username = cleanUsername(rawUsername);
    if (!USERNAME_RE.test(username)) {
        console.error('Username must be 3-32 characters: letters, numbers, dot, dash or underscore.');
        process.exit(1);
    }
    if (password.length < 8 || password.length > 72) {
        console.error('Password must be 8-72 characters.');
        process.exit(1);
    }

    const authBase = base.replace(/\/+$/, '');
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

    const createRes = await fetch(`${authBase}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: toEmail(username), password, email_confirm: true }),
    });
    const created = await createRes.json();
    if (!createRes.ok || !created.id) {
        console.error('Failed to create Auth user:', created);
        process.exit(1);
    }

    const profileRes = await fetch(`${authBase}/rest/v1/profiles`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ id: created.id, username, role: 'admin', must_change_password: true, active: true }),
    });
    if (!profileRes.ok) {
        const err = await profileRes.text();
        console.error('Failed to insert profile row, rolling back Auth user:', err);
        await fetch(`${authBase}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers });
        process.exit(1);
    }

    console.log(`Admin account "${username}" created. Log in with this temporary password, then set a new one.`);
}

main();
