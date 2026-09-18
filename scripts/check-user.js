// Diagnostic: prints a profile's current status.
// Usage: SUPABASE_DATABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-user.js <username>

async function main() {
    const [, , username] = process.argv;
    const base = process.env.SUPABASE_DATABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!username) {
        console.error('Usage: node scripts/check-user.js <username>');
        process.exit(1);
    }
    if (!base || !serviceKey) {
        console.error('Set SUPABASE_DATABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
        process.exit(1);
    }

    const restBase = base.replace(/\/+$/, '');
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    const res = await fetch(`${restBase}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id,username,role,active,must_change_password,created_at`, { headers });
    const rows = await res.json();
    if (!res.ok) {
        console.error('Query failed:', rows);
        process.exit(1);
    }
    if (!rows.length) {
        console.log(`No profile found for username "${username}".`);
        return;
    }
    console.log(rows[0]);
}

main();
