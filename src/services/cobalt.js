const http = require('http');
const https = require('https');
const { URL } = require('url');
const { isValidPublicUrl } = require('../utils/validate');

async function getCobaltDirectStream(videoUrl) {
    const instances = [
        'https://api.cobalt.tools/',
        'https://cobalt.host/',
        'https://cobalt.v0.pw/'
    ];

    for (const endpoint of instances) {
        try {
            const parsed = new URL(endpoint);
            const postData = JSON.stringify({
                url: videoUrl,
                videoQuality: '720',
                youtubeVideoCodec: 'h264'
            });

            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
                path: parsed.pathname,
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const directUrl = await new Promise((resolve) => {
                const req = (parsed.protocol === 'http:' ? http : https).request(options, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(body);
                            if (json) {
                                if (json.url) return resolve(json.url);
                                if (json.picker && Array.isArray(json.picker) && json.picker[0] && json.picker[0].url) {
                                    return resolve(json.picker[0].url);
                                }
                                if (json.tunnel) return resolve(json.tunnel);
                            }
                            resolve(null);
                        } catch (e) {
                            resolve(null);
                        }
                    });
                });
                req.on('error', () => resolve(null));
                req.setTimeout(3000, () => { req.destroy(); resolve(null); });
                req.write(postData);
                req.end();
            });

            if (directUrl && isValidPublicUrl(directUrl)) return directUrl;
        } catch (e) {}
    }
    return null;
}

module.exports = { getCobaltDirectStream };
