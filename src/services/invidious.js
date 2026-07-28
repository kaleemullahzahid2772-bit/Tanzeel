const { httpsGetJson, isValidPublicUrl } = require('../utils/validate');

async function getInvidiousDirectStreamUrl(videoId) {
    const instances = [
        `https://inv.tux.pizza/api/v1/videos/${videoId}`,
        `https://invidious.nerdvpn.de/api/v1/videos/${videoId}`,
        `https://invidious.drgns.space/api/v1/videos/${videoId}`,
        `https://invidious.projectsegfau.lt/api/v1/videos/${videoId}`
    ];
    for (const instUrl of instances) {
        const data = await httpsGetJson(instUrl, 6000);
        if (data && data.formatStreams && data.formatStreams.length > 0) {
            const combinedMp4 = data.formatStreams.find(s => String(s.itag) === '22') ||
                                data.formatStreams.find(s => String(s.itag) === '18') ||
                                data.formatStreams.find(s => s.container === 'mp4' && s.encoding === 'h264') ||
                                data.formatStreams.find(s => s.container === 'mp4') ||
                                data.formatStreams[0];
            if (combinedMp4 && combinedMp4.url && isValidPublicUrl(combinedMp4.url)) {
                return { url: combinedMp4.url, title: data.title || 'Tanzeel_Video' };
            }
        }
    }
    return null;
}

module.exports = { getInvidiousDirectStreamUrl };
