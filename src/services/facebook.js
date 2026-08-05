const { getCobaltDirectStream } = require('./cobalt');
const ytdlp = require('./ytdlp');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const insecureSslAgent = new https.Agent({ rejectUnauthorized: false });

async function scrapeFacebookDirectStream(videoUrl, redirectCount = 0) {
    if (redirectCount > 5) return null;
    return new Promise((resolve) => {
        try {
            const parsed = new URL(videoUrl);
            const httpLib = parsed.protocol === 'http:' ? http : https;
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
                path: parsed.pathname + parsed.search,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            };
            if (parsed.protocol === 'https:') {
                options.agent = insecureSslAgent;
            }

            const req = httpLib.get(options, (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                    let loc = res.headers.location;
                    if (loc.startsWith('/')) {
                        loc = `${parsed.protocol}//${parsed.hostname}${loc}`;
                    }
                    res.resume();
                    return resolve(scrapeFacebookDirectStream(loc, redirectCount + 1));
                }

                let html = '';
                res.on('data', chunk => html += chunk);
                res.on('end', () => {
                    const hdMatch = html.match(/hd_src:"([^"]+)"/) ||
                                    html.match(/"playable_url_quality_hd":"([^"]+)"/) ||
                                    html.match(/"browser_native_hd_url":"([^"]+)"/) ||
                                    html.match(/hd_src_no_ratelimit:"([^"]+)"/);
                    const sdMatch = html.match(/sd_src:"([^"]+)"/) ||
                                    html.match(/"playable_url":"([^"]+)"/) ||
                                    html.match(/"browser_native_sd_url":"([^"]+)"/) ||
                                    html.match(/sd_src_no_ratelimit:"([^"]+)"/) ||
                                    html.match(/"base_url":"([^"]+fbcdn\.net[^"]+)"/);
                    let rawUrl = (hdMatch && hdMatch[1]) || (sdMatch && sdMatch[1]);
                    if (rawUrl) {
                        try {
                            rawUrl = JSON.parse(`"${rawUrl}"`);
                        } catch (e) {
                            rawUrl = rawUrl.replace(/\\/g, '').replace(/&amp;/g, '&');
                        }
                        if (rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
                            return resolve(rawUrl);
                        }
                    }
                    resolve(null);
                });
            });
            req.on('error', () => resolve(null));
            req.setTimeout(5000, () => { req.destroy(); resolve(null); });
        } catch (e) {
            resolve(null);
        }
    });
}

async function getFacebookStreamUrl(url, projectRoot, ffmpegPath) {
    // 1. Try yt-dlp binary extraction if available (Handles facebook.com/share/v/... 100% reliably)
    if (projectRoot && ytdlp.isBinaryAvailable && ytdlp.isBinaryAvailable(projectRoot)) {
        try {
            const res = await ytdlp.extractWithBinary(url, projectRoot, ffmpegPath);
            if (res && res.url) {
                return {
                    url: res.url,
                    title: res.title || 'Facebook_Video'
                };
            }
        } catch (e) {}
    }

    // 2. Try Direct Facebook Scraper Engine
    try {
        const directUrl = await scrapeFacebookDirectStream(url);
        if (directUrl) {
            return {
                url: directUrl,
                title: 'Facebook_Video'
            };
        }
    } catch (e) {}

    // 3. Try Cobalt Engine
    try {
        const cobaltUrl = await getCobaltDirectStream(url);
        if (cobaltUrl) {
            return {
                url: cobaltUrl,
                title: 'Facebook_Video'
            };
        }
    } catch (e) {}

    return null;
}

module.exports = { getFacebookStreamUrl };
