const https = require('https');
const http = require('http');
const { URL } = require('url');

const insecureSslAgent = new https.Agent({ rejectUnauthorized: false });

function extractYouTubeId(url) {
    if (!url || typeof url !== 'string') return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function normalizeYouTubeUrl(url) {
    if (!url || typeof url !== 'string') return url;
    const videoId = extractYouTubeId(url);
    if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
    }
    return url;
}

function extractUrlFromQuery(req) {
    let urlParam = (req.query && typeof req.query.url === 'string') ? req.query.url.trim() : '';

    if (urlParam.includes('%3A') || urlParam.includes('%2F')) {
        try {
            urlParam = decodeURIComponent(urlParam);
        } catch (e) {}
    }

    if (req.originalUrl && req.originalUrl.includes('url=')) {
        try {
            const rawQueryString = req.originalUrl.substring(req.originalUrl.indexOf('url=') + 4);
            let fullUrlPart = rawQueryString;
            const idIdx = fullUrlPart.lastIndexOf('&id=');
            if (idIdx !== -1) {
                fullUrlPart = fullUrlPart.substring(0, idIdx);
            }
            if (fullUrlPart.includes('%3A') || fullUrlPart.includes('%2F')) {
                try {
                    fullUrlPart = decodeURIComponent(fullUrlPart);
                } catch (e) {}
            }
            if (fullUrlPart.startsWith('http://') || fullUrlPart.startsWith('https://')) {
                return fullUrlPart.trim();
            }
        } catch (e) {}
    }

    return urlParam;
}

async function expandRedirectUrl(targetUrl, maxRedirects = 5) {
    if (!targetUrl || typeof targetUrl !== 'string') return targetUrl;
    let currentUrl = targetUrl.trim();
    let redirects = 0;

    while (redirects < maxRedirects) {
        try {
            const parsed = new URL(currentUrl);
            const httpLib = parsed.protocol === 'http:' ? http : https;
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
                path: parsed.pathname + parsed.search,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*'
                }
            };
            if (parsed.protocol === 'https:') {
                options.agent = insecureSslAgent;
            }

            const redirectResult = await new Promise((resolve) => {
                const req = httpLib.get(options, (res) => {
                    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                        let loc = res.headers.location;
                        if (loc.startsWith('/')) {
                            loc = `${parsed.protocol}//${parsed.hostname}${loc}`;
                        }
                        res.resume();
                        return resolve({ redirected: true, location: loc });
                    }
                    res.resume();
                    resolve({ redirected: false, location: currentUrl });
                });
                req.on('error', () => resolve({ redirected: false, location: currentUrl }));
                req.setTimeout(4000, () => { req.destroy(); resolve({ redirected: false, location: currentUrl }); });
            });

            if (redirectResult.redirected && redirectResult.location) {
                currentUrl = redirectResult.location;
                redirects++;
            } else {
                break;
            }
        } catch (e) {
            break;
        }
    }
    return currentUrl;
}

module.exports = { extractYouTubeId, normalizeYouTubeUrl, extractUrlFromQuery, expandRedirectUrl };
