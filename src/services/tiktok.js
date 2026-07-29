const { httpsGetJson } = require('../utils/validate');
const { getCobaltDirectStream } = require('./cobalt');

async function getTikTokStreamUrl(url) {
    // 1. Try TikWM API (No Watermark TikTok Downloader Engine)
    try {
        const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
        const data = await httpsGetJson(apiUrl, 4000);
        if (data && data.code === 0 && data.data) {
            const playUrl = data.data.play || data.data.wmplay || data.data.hdplay;
            if (playUrl) {
                return {
                    url: playUrl,
                    title: data.data.title || 'TikTok_Video'
                };
            }
        }
    } catch (e) {}

    // 2. Try Cobalt Engine
    try {
        const cobaltUrl = await getCobaltDirectStream(url);
        if (cobaltUrl) {
            return {
                url: cobaltUrl,
                title: 'TikTok_Video'
            };
        }
    } catch (e) {}

    return null;
}

module.exports = { getTikTokStreamUrl };
