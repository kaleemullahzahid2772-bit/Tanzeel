const { httpsGetJson, isValidPublicUrl } = require('../utils/validate');

async function getPipedDirectStreamUrl(videoId) {
    const pipedInstances = [
        `https://api.piped.privacydev.net/streams/${videoId}`,
        `https://pipedapi.kavin.rocks/streams/${videoId}`,
        `https://pipedapi.drgns.space/streams/${videoId}`
    ];
    for (const instUrl of pipedInstances) {
        const data = await httpsGetJson(instUrl, 6000);
        if (data && data.videoStreams && data.videoStreams.length > 0) {
            const combinedMp4 = data.videoStreams.find(s => s.mimeType && s.mimeType.includes('video/mp4') && s.hasAudio) ||
                                data.videoStreams.find(s => s.quality === '720p' && s.hasAudio) ||
                                data.videoStreams.find(s => s.mimeType && s.mimeType.includes('video/mp4')) ||
                                data.videoStreams[0];
            if (combinedMp4 && combinedMp4.url && isValidPublicUrl(combinedMp4.url)) {
                return { url: combinedMp4.url, title: data.title || 'Tanzeel_Video' };
            }
        }
    }
    return null;
}

module.exports = { getPipedDirectStreamUrl };
