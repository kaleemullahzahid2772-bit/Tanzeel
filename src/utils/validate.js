const http = require('http');
const https = require('https');
const { URL } = require('url');

function isValidPublicUrl(inputUrl) {
    if (!inputUrl || typeof inputUrl !== 'string') return false;
    const trimmed = inputUrl.trim();
    if (!trimmed) return false;

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch (e) {
        return false;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0' || hostname === '') {
        return false;
    }

    if (hostname === '169.254.169.254' || hostname.startsWith('169.254.')) {
        return false;
    }

    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;

    if (hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80')) return false;

    return true;
}

function httpsGetJson(url, timeoutMs = 5000) {
    return new Promise((resolve) => {
        if (!isValidPublicUrl(url)) return resolve(null);
        try {
            const parsed = new URL(url);
            const httpLib = parsed.protocol === 'http:' ? http : https;
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
                path: parsed.pathname + parsed.search,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                }
            };
            const req = httpLib.get(options, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    return resolve(null);
                }
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve(null);
                    }
                });
            });
            req.on('error', () => resolve(null));
            req.setTimeout(timeoutMs, () => {
                req.destroy();
                resolve(null);
            });
        } catch (e) {
            resolve(null);
        }
    });
}

module.exports = { isValidPublicUrl, httpsGetJson };
