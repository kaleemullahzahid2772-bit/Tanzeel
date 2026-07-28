const { normalizeYouTubeUrl, extractYouTubeId, extractUrlFromQuery } = require('../utils/url');
const { isValidPublicUrl } = require('../utils/validate');
const { sanitizeFilename } = require('../utils/filename');
const { setProgress, deleteProgress } = require('../utils/progress');
const ytdlp = require('../services/ytdlp');
const { getCobaltDirectStream } = require('../services/cobalt');
const { getPipedDirectStreamUrl } = require('../services/piped');
const { getInvidiousDirectStreamUrl } = require('../services/invidious');

function createDownloadRouter(projectRoot) {
    const express = require('express');
    const router = express.Router();

    router.get(['/download', '/api/download'], async (req, res) => {
        let url = extractUrlFromQuery(req);
        let id = req.query.id;

        if (!url || !url.trim() || !isValidPublicUrl(url.trim())) {
            return res.status(400).json({ success: false, message: 'Invalid URL provided' });
        }

        const rawUrl = url.trim();
        url = normalizeYouTubeUrl(rawUrl);

        const downloadId = (id && typeof id === 'string') ? id : Math.random().toString(36).substring(2, 10);

        setProgress(downloadId, {
            percent: 15,
            size: 'Fetching...',
            speed: 'Connecting...',
            eta: 'Calculating...',
            status: 'Downloading...'
        });

        const videoId = extractYouTubeId(url);

        let hasBinary = ytdlp.isBinaryAvailable(projectRoot);
        if (!hasBinary) {
            await ytdlp.downloadBinaryIfNeeded(projectRoot);
            hasBinary = ytdlp.isBinaryAvailable(projectRoot);
        }

        const ffmpegPath = ytdlp.getFfmpegPath && ytdlp.getFfmpegPath();

        const layerLog = [];

        // Layer 1: yt-dlp Binary (YouTube URLs only - args are YouTube-specific)
        if (videoId) {
            if (hasBinary) {
                try {
                    const binaryResult = await ytdlp.extractWithBinary(url, projectRoot, ffmpegPath, layerLog);
                    if (binaryResult && binaryResult.url) {
                        const piped = await ytdlp.proxyVideoStream(binaryResult.url, sanitizeFilename(binaryResult.title), res, downloadId, ffmpegPath);
                        if (piped) return;
                        layerLog.push('Layer 1: proxyVideoStream returned false');
                    } else {
                        layerLog.push('Layer 1: no stream URL extracted');
                    }
                } catch (binErr) {
                    layerLog.push('Layer 1 failed: ' + binErr.message);
                }
            } else {
                layerLog.push('Layer 1: binary not available');
            }
        } else {
            layerLog.push('Layer 1: skipped (not a YouTube URL)');
        }

        // Layer 2: @distube/ytdl-core
        try {
            const ytdlResult = await ytdlp.getYtdlCoreStreamUrl(url, projectRoot);
            if (ytdlResult && ytdlResult.url && isValidPublicUrl(ytdlResult.url)) {
                const piped = await ytdlp.proxyVideoStream(ytdlResult.url, sanitizeFilename(ytdlResult.title), res, downloadId, ffmpegPath);
                if (piped) return;
                layerLog.push('Layer 2: proxyVideoStream returned false');
            } else {
                layerLog.push('Layer 2: no valid stream URL' + (ytdlResult ? ' (url=' + (ytdlResult.url || '').substring(0, 50) + ')' : ''));
            }
        } catch (ytdlErr) {
            layerLog.push('Layer 2 failed: ' + ytdlErr.message);
        }

        // Layer 3: Cobalt API
        try {
            const cobaltUrl = await getCobaltDirectStream(url);
            if (cobaltUrl && isValidPublicUrl(cobaltUrl)) {
                const piped = await ytdlp.proxyVideoStream(cobaltUrl, 'Tanzeel_Video', res, downloadId, ffmpegPath);
                if (piped) return;
                layerLog.push('Layer 3: proxyVideoStream returned false');
            } else {
                layerLog.push('Layer 3: no stream URL');
            }
        } catch (cobaltErr) {
            layerLog.push('Layer 3 failed: ' + cobaltErr.message);
        }

        // Layer 4: Piped API
        if (videoId) {
            try {
                const pipedStream = await getPipedDirectStreamUrl(videoId);
                if (pipedStream && pipedStream.url && isValidPublicUrl(pipedStream.url)) {
                    const piped = await ytdlp.proxyVideoStream(pipedStream.url, sanitizeFilename(pipedStream.title), res, downloadId, ffmpegPath);
                    if (piped) return;
                    layerLog.push('Layer 4: proxyVideoStream returned false');
                } else {
                    layerLog.push('Layer 4: no valid stream URL');
                }
            } catch (pipedErr) {
                layerLog.push('Layer 4 failed: ' + pipedErr.message);
            }
        }

        // Layer 5: Invidious API
        if (videoId) {
            try {
                const invidiousStream = await getInvidiousDirectStreamUrl(videoId);
                if (invidiousStream && invidiousStream.url && isValidPublicUrl(invidiousStream.url)) {
                    const piped = await ytdlp.proxyVideoStream(invidiousStream.url, sanitizeFilename(invidiousStream.title), res, downloadId, ffmpegPath);
                    if (piped) return;
                    layerLog.push('Layer 5: proxyVideoStream returned false');
                } else {
                    layerLog.push('Layer 5: no valid stream URL');
                }
            } catch (invErr) {
                layerLog.push('Layer 5 failed: ' + invErr.message);
            }
        }

        // All layers exhausted
        setProgress(downloadId, { percent: 100, status: 'Failed', message: 'Unable to extract video stream from source.' });
        setTimeout(() => deleteProgress(downloadId), 5000).unref();

        console.error('All extraction layers failed for URL:', url);
        console.error('Layer log:', layerLog.join(' | '));

        if (!res.headersSent) {
            res.status(400).setHeader('Content-Type', 'application/json');
            return res.json({
                success: false,
                error: 'EXTRACTION_FAILED',
                message: 'Unable to extract video stream from source.'
            });
        }
    });

    return router;
}

module.exports = createDownloadRouter;
