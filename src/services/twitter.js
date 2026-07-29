const { httpsGetJson } = require('../utils/validate');
const { getCobaltDirectStream } = require('./cobalt');

async function getTwitterStreamUrl(url) {
    // 1. Try Cobalt API
    try {
        const cobaltUrl = await getCobaltDirectStream(url);
        if (cobaltUrl) {
            return {
                url: cobaltUrl,
                title: 'Twitter_Video'
            };
        }
    } catch (e) {}

    // 2. Try FxTwitter API fallback
    try {
        const parsedUrl = url.replace('twitter.com', 'api.fxtwitter.com').replace('x.com', 'api.fxtwitter.com');
        const data = await httpsGetJson(parsedUrl, 4000);
        if (data && data.tweet && data.tweet.media && data.tweet.media.videos && data.tweet.media.videos.length > 0) {
            const bestVideo = data.tweet.media.videos[0];
            if (bestVideo && bestVideo.url) {
                return {
                    url: bestVideo.url,
                    title: data.tweet.text ? data.tweet.text.slice(0, 30) : 'Twitter_Video'
                };
            }
        }
    } catch (e) {}

    return null;
}

module.exports = { getTwitterStreamUrl };
