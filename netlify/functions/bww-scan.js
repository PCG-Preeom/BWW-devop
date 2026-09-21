// Runs weekly (see the schedule in netlify.toml). Scheduled functions have no public URL.
const { runScan } = require('../lib/bwwscan');

exports.handler = async () => {
    try {
        const result = await runScan();
        console.log('BWW scan finished:', JSON.stringify(result));
        return { statusCode: 200, body: JSON.stringify(result) };
    } catch (err) {
        console.error('BWW scan failed:', err.message);
        return { statusCode: 500, body: JSON.stringify({ error: 'scan_failed' }) };
    }
};
