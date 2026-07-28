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

module.exports = { extractYouTubeId, normalizeYouTubeUrl, extractUrlFromQuery };
