const { getCobaltDirectStream } = require('./cobalt');
const https = require('https');
const http = require('http');
const { URL } = require('url');

async function scrapeFacebookDirectStream(videoUrl) {
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
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            };
            const req = httpLib.get(options, (res) => {
                let html = '';
                res.on('data', chunk => html += chunk);
                res.on('end', () => {
                    // Extract hd_src, sd_src, playable_url_quality_hd, playable_url (Green Hole Facebook Scraper Engine)
                    const hdMatch = html.match(/hd_src:"([^"]+)"/) || html.match(/"playable_url_quality_hd":"([^"]+)"/);
                    const sdMatch = html.match(/sd_src:"([^"]+)"/) || html.match(/"playable_url":"([^"]+)"/);
                    let rawUrl = (hdMatch && hdMatch[1]) || (sdMatch && sdMatch[1]);
                    if (rawUrl) {
                        try {
                            rawUrl = JSON.parse(`"${rawUrl}"`);
                        } catch (e) {
                            rawUrl = rawUrl.replace(/\\/g, '');
                        }
                        return resolve(rawUrl);
                    }
                    resolve(null);
                });
            });
            req.on('error', () => resolve(null));
            req.setTimeout(4000, () => { req.destroy(); resolve(null); });
        } catch (e) {
            resolve(null);
        }
    });
}

async function getFacebookStreamUrl(url) {
    // 1. Try Direct Facebook Regex Scraper (Green Hole Logic)
    try {
        const directUrl = await scrapeFacebookDirectStream(url);
        if (directUrl) {
            return {
                url: directUrl,
                title: 'Facebook_Video'
            };
        }
    } catch (e) {}

    // 2. Try Cobalt Engine
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
