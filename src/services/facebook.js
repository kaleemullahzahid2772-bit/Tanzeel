const { getCobaltDirectStream } = require('./cobalt');

async function getFacebookStreamUrl(url) {
    // 1. Try Cobalt API
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
