const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = __dirname;
const host = process.env.HOST || '0.0.0.0';
let port = Number(process.env.PORT) || 3000;
const logsDir = path.join(root, 'logs');
const accessLogPath = path.join(logsDir, 'access.log');

const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png'
};

function send(res, status, body, headers = {}) {
    res.writeHead(status, headers);
    res.end(body);
}

function serveFile(res, requestPath) {
    const cleanPath = requestPath === '/' ? '/index.html' : requestPath;
    const filePath = path.resolve(root, `.${decodeURIComponent(cleanPath)}`);

    if (!filePath.startsWith(root)) {
        send(res, 403, 'Forbidden');
        return;
    }

    fs.readFile(filePath, (error, body) => {
        if (error) {
            send(res, 404, 'Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const headers = {
            'Content-Type': contentTypes[ext] || 'application/octet-stream'
        };

        if (['.html', '.css', '.js', '.json'].includes(ext)) {
            headers['Cache-Control'] = 'no-store';
        }

        send(res, 200, body, headers);
    });
}

function readJsonBody(req) {
    return new Promise((resolve) => {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 10000) {
                req.destroy();
            }
        });

        req.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch {
                resolve({});
            }
        });
    });
}

function getClientIp(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : (forwardedFor || req.socket.remoteAddress || '');

    return rawIp.split(',')[0].trim().replace(/^::ffff:/, '');
}

function appendAccessLog(entry) {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(accessLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function localNetworkUrls() {
    const urls = [];
    const interfaces = os.networkInterfaces();

    for (const details of Object.values(interfaces)) {
        for (const item of details || []) {
            if (item.family === 'IPv4' && !item.internal) {
                urls.push(`http://${item.address}:${port}/`);
            }
        }
    }

    return urls;
}

async function handleAccessLog(req, res) {
    const body = await readJsonBody(req);
    const entry = {
        timestamp: new Date().toISOString(),
        ip: getClientIp(req),
        success: Boolean(body.success),
        path: typeof body.path === 'string' ? body.path.slice(0, 200) : '',
        userAgent: typeof body.userAgent === 'string'
            ? body.userAgent.slice(0, 500)
            : (req.headers['user-agent'] || '').slice(0, 500)
    };

    appendAccessLog(entry);
    send(res, 204, '', { 'Cache-Control': 'no-store' });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/access-log' && req.method === 'POST') {
        await handleAccessLog(req, res);
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        send(res, 404, 'Not found');
        return;
    }

    serveFile(res, url.pathname);
});

function startServer() {
    server.listen(port, host, () => {
        console.log(`Map app running at http://localhost:${port}/`);
        for (const url of localNetworkUrls()) {
            console.log(`Network URL: ${url}`);
        }
        console.log(`Access attempts will be logged to ${accessLogPath}`);
    });
}

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT) {
        port += 1;
        startServer();
        return;
    }

    throw error;
});

startServer();
