const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const host = '127.0.0.1';
const port = Number(process.env.PORT) || 3000;
const password = process.env.MAP_PASSWORD || 'PCG2026!';
const sessions = new Map();

const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
};

function parseCookies(req) {
    return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(cookie => {
        const [key, ...value] = cookie.trim().split('=');
        return [key, decodeURIComponent(value.join('='))];
    }));
}

function isAuthed(req) {
    const sid = parseCookies(req).pcg_map_session;
    return Boolean(sid && sessions.has(sid));
}

function send(res, status, body, headers = {}) {
    res.writeHead(status, headers);
    res.end(body);
}

function redirect(res, location) {
    send(res, 302, '', { Location: location });
}

function serveFile(res, relativePath) {
    const filePath = path.resolve(root, relativePath);
    if (!filePath.startsWith(root)) {
        send(res, 403, 'Forbidden');
        return;
    }

    fs.readFile(filePath, (error, body) => {
        if (error) {
            send(res, 404, 'Not found');
            return;
        }

        const ext = path.extname(filePath);
        const headers = {
            'Content-Type': types[ext] || 'application/octet-stream'
        };

        if (['.html', '.css', '.js', '.json'].includes(ext)) {
            headers['Cache-Control'] = 'no-store';
        }

        send(res, 200, body, headers);
    });
}

function readBody(req) {
    return new Promise(resolve => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 10000) req.destroy();
        });
        req.on('end', () => resolve(body));
    });
}

function loginPage(error = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - MP + BWW + Dunkin Map</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <section class="login-screen server-login">
        <form class="login-panel" method="post" action="/login">
            <p class="eyebrow">Private Map</p>
            <h1>MP + BWW + Dunkin Map</h1>
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" autofocus>
            <button class="primary" type="submit">Log In</button>
            <div class="login-message">${error}</div>
        </form>
    </section>
</body>
</html>`;
}

async function handleLogin(req, res) {
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    const submitted = form.get('password') || '';

    if (submitted !== password) {
        send(res, 401, loginPage('Incorrect password.'), { 'Content-Type': 'text/html; charset=utf-8' });
        return;
    }

    const sid = crypto.randomBytes(32).toString('hex');
    sessions.set(sid, { createdAt: Date.now() });
    send(res, 302, '', {
        Location: '/',
        'Set-Cookie': `pcg_map_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
    });
}

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/login' && req.method === 'GET') {
        if (isAuthed(req)) return redirect(res, '/');
        send(res, 200, loginPage(), { 'Content-Type': 'text/html; charset=utf-8' });
        return;
    }

    if (pathname === '/login' && req.method === 'POST') {
        await handleLogin(req, res);
        return;
    }

    if (pathname === '/sw.js') {
        send(res, 204, '', { 'Cache-Control': 'no-store' });
        return;
    }

    if (pathname === '/styles.css') {
        serveFile(res, 'styles.css');
        return;
    }

    if (!isAuthed(req)) {
        if (pathname === '/api/locations') {
            send(res, 401, 'Unauthorized');
            return;
        }
        redirect(res, '/login');
        return;
    }

    if (pathname === '/' || pathname === '/index.html') {
        serveFile(res, 'index.html');
        return;
    }

    if (pathname === '/api/locations') {
        serveFile(res, 'data.json');
        return;
    }

    if (pathname === '/data.json') {
        send(res, 404, 'Not found');
        return;
    }

    serveFile(res, `.${pathname}`);
}).listen(port, host, () => {
    console.log(`Map app running at http://${host}:${port}/`);
    console.log('Default password: PCG2026!');
});
