const { httpsGetJson } = require('../utils/validate');
const { getCobaltDirectStream } = require('./cobalt');

async function getInstagramStreamUrl(url) {
    // 1. Try Cobalt API
    try {
        const cobaltUrl = await getCobaltDirectStream(url);
        if (cobaltUrl) {
            return {
                url: cobaltUrl,
                title: 'Instagram_Reel'
            };
        }
    } catch (e) {}

    // 2. Try DDInstagram / oEmbed json fallback
    try {
        const cleanUrl = url.split('?')[0];
        const ddUrl = cleanUrl.replace('instagram.com', 'ddinstagram.com') + '/embed.json';
        const data = await httpsGetJson(ddUrl, 4000);
        if (data && data.video_url) {
            return {
                url: data.video_url,
                title: data.title || 'Instagram_Video'
            };
        }
    } catch (e) {}

    return null;
}

module.exports = { getInstagramStreamUrl };
