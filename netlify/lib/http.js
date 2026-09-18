class HttpError extends Error {
    constructor(status, code, message) {
        super(message || code);
        this.status = status;
        this.code = code;
    }
}

function json(status, body) {
    return {
        statusCode: status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body),
    };
}

function parseBody(event) {
    try {
        return JSON.parse(event.body || '{}');
    } catch {
        throw new HttpError(400, 'bad_json', 'Request body must be JSON.');
    }
}

function bearer(event) {
    const headers = event.headers || {};
    const value = headers.authorization || headers.Authorization || '';
    const match = /^Bearer (.+)$/.exec(value);
    return match ? match[1] : null;
}

function wrap(fn) {
    return async (event) => {
        try {
            return await fn(event);
        } catch (err) {
            if (err instanceof HttpError) {
                return json(err.status, { error: err.code, message: err.message });
            }
            console.error(err);
            return json(500, { error: 'server_error', message: 'Something went wrong.' });
        }
    };
}

module.exports = { HttpError, json, parseBody, bearer, wrap };
