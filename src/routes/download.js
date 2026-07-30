const { normalizeYouTubeUrl, extractYouTubeId, extractUrlFromQuery, expandRedirectUrl } = require('../utils/url');
const { isValidPublicUrl } = require('../utils/validate');
const { sanitizeFilename } = require('../utils/filename');
const { setProgress, deleteProgress } = require('../utils/progress');
const ytdlp = require('../services/ytdlp');
const { getCobaltDirectStream } = require('../services/cobalt');
const { getPipedDirectStreamUrl } = require('../services/piped');
const { getInvidiousDirectStreamUrl } = require('../services/invidious');
const { getTikTokStreamUrl } = require('../services/tiktok');
const { getInstagramStreamUrl } = require('../services/instagram');
const { getTwitterStreamUrl } = require('../services/twitter');
const { getFacebookStreamUrl } = require('../services/facebook');
const log = require('../utils/logger');

function createDownloadRouter(projectRoot) {
    const express = require('express');
    const router = express.Router();

    router.get(['/download', '/api/download'], async (req, res) => {
        const startTime = Date.now();
        let url = extractUrlFromQuery(req);
        let id = req.query.id;

        if (!url || !url.trim() || !isValidPublicUrl(url.trim())) {
            log.warn('Download request rejected: Invalid URL');
            return res.status(400).json({ success: false, error: 'INVALID_URL', message: 'Invalid URL provided' });
        }

        let rawUrl = url.trim();
        rawUrl = normalizeYouTubeUrl(rawUrl);
        url = await expandRedirectUrl(rawUrl);
        const downloadId = (id && typeof id === 'string') ? id : Math.random().toString(36).substring(2, 10);

        log.info(`[Download Request Received] ID: ${downloadId}`, {
            url: url.substring(0, 70),
            ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1'
        });

        setProgress(downloadId, {
            percent: 15,
            size: 'Fetching...',
            speed: 'Connecting...',
            eta: 'Calculating...',
            status: 'Downloading...'
        });

        let isAborted = false;
        let spawnedChildProc = null;
        const layerLog = [];

        const onClientClose = () => {
            if (isAborted) return;
            isAborted = true;
            log.info(`[Download Request Aborted] Client closed connection for ID: ${downloadId}`);
            if (spawnedChildProc) {
                try { spawnedChildProc.kill('SIGKILL'); } catch (e) {}
            }
            setProgress(downloadId, { percent: 0, status: 'Cancelled', message: 'The download was cancelled.' });
            setTimeout(() => deleteProgress(downloadId), 2000).unref();
        };

        req.once('close', () => {
            if (!res.writableEnded && !res.headersSent) {
                onClientClose();
            }
        });

        const videoId = extractYouTubeId(url);
        const ffmpegPath = ytdlp.getFfmpegPath && ytdlp.getFfmpegPath();

        // Overall Download Timeout Guard (120 seconds for Render)
        let isTimedOut = false;
        const requestTimeoutTimer = setTimeout(() => {
            if (!res.headersSent && !isAborted) {
                isTimedOut = true;
                isAborted = true;
                log.error(`[Download Request Timeout] Exceeded 120000ms for ID: ${downloadId}`);
                if (spawnedChildProc) {
                    try { spawnedChildProc.kill('SIGKILL'); } catch (e) {}
                }
                setProgress(downloadId, { percent: 100, status: 'Failed', message: 'Download request timed out.' });
                setTimeout(() => deleteProgress(downloadId), 3000).unref();
                res.status(504).json({
                    success: false,
                    error: 'REQUEST_TIMEOUT',
                    message: 'Download request timed out.',
                    layerLog
                });
            }
        }, 120000);

        try {
            // Layer 1: yt-dlp Binary
            if (!isAborted && !isTimedOut) {
                let hasBinary = ytdlp.isBinaryAvailable(projectRoot);
                if (!hasBinary) {
                    await ytdlp.downloadBinaryIfNeeded(projectRoot);
                    hasBinary = ytdlp.isBinaryAvailable(projectRoot);
                }

                if (hasBinary) {
                    log.info(`[Layer 1: yt-dlp binary] Extraction started for ID: ${downloadId}`);
                    try {
                        const binaryResult = await ytdlp.extractWithBinary(url, projectRoot, ffmpegPath, {
                            onSpawn: (proc) => { spawnedChildProc = proc; }
                        });

                        if (binaryResult && binaryResult.url && !isAborted) {
                            log.info(`[Layer 1: yt-dlp binary] Stream URL extracted, starting proxy for ID: ${downloadId}`);
                            const piped = await ytdlp.proxyVideoStream(binaryResult.url, sanitizeFilename(binaryResult.title), res, downloadId, ffmpegPath, 0, req);
                            if (piped) {
                                clearTimeout(requestTimeoutTimer);
                                log.info(`[Download Success] Layer 1 succeeded in ${Date.now() - startTime}ms for ID: ${downloadId}`);
                                return;
                            }
                            layerLog.push({ layer: 1, name: 'yt-dlp binary', error: 'proxyVideoStream failed' });
                            log.warn(`[Layer 1: yt-dlp binary] proxyVideoStream failed for ID: ${downloadId}`);
                        } else {
                            const errMsg = (binaryResult && binaryResult.error) ? binaryResult.error : 'No stream URL extracted';
                            layerLog.push({ layer: 1, name: 'yt-dlp binary', error: errMsg });
                            log.warn(`[Layer 1: yt-dlp binary] ${errMsg} for ID: ${downloadId}`);
                        }
                    } catch (binErr) {
                        layerLog.push({ layer: 1, name: 'yt-dlp binary', error: binErr.message });
                        log.warn(`[Layer 1: yt-dlp binary] Exception: ${binErr.message}`);
                    }
                }
            }

            // Dedicated Platform API Layer (TikTok, Instagram, Twitter/X, Facebook)
            if (!isAborted && !isTimedOut) {
                let platformStream = null;
                const lowerUrl = url.toLowerCase();
                if (lowerUrl.includes('tiktok.com')) {
                    platformStream = await getTikTokStreamUrl(url);
                } else if (lowerUrl.includes('instagram.com')) {
                    platformStream = await getInstagramStreamUrl(url);
                } else if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) {
                    platformStream = await getTwitterStreamUrl(url);
                } else if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.watch')) {
                    platformStream = await getFacebookStreamUrl(url, projectRoot, ffmpegPath);
                }

                if (platformStream && platformStream.url && isValidPublicUrl(platformStream.url) && !isAborted) {
                    log.info(`[Platform API] Extracted stream URL for ID: ${downloadId}`);
                    const piped = await ytdlp.proxyVideoStream(platformStream.url, sanitizeFilename(platformStream.title), res, downloadId, ffmpegPath, 0, req);
                    if (piped) {
                        clearTimeout(requestTimeoutTimer);
                        log.info(`[Download Success] Platform API layer succeeded in ${Date.now() - startTime}ms for ID: ${downloadId}`);
                        return;
                    }
                }
            }

            // Layer 2: @distube/ytdl-core
            if (!isAborted && !isTimedOut) {
                log.info(`[Layer 2: ytdl-core] Extraction started for ID: ${downloadId}`);
                try {
                    const ytdlResult = await ytdlp.getYtdlCoreStreamUrl(url, projectRoot);
                    if (ytdlResult && ytdlResult.url && isValidPublicUrl(ytdlResult.url) && !isAborted) {
                        log.info(`[Layer 2: ytdl-core] Stream URL extracted, starting proxy for ID: ${downloadId}`);
                        const piped = await ytdlp.proxyVideoStream(ytdlResult.url, sanitizeFilename(ytdlResult.title), res, downloadId, ffmpegPath, 0, req);
                        if (piped) {
                            clearTimeout(requestTimeoutTimer);
                            log.info(`[Download Success] Layer 2 succeeded in ${Date.now() - startTime}ms for ID: ${downloadId}`);
                            return;
                        }
                        log.warn(`[Layer 2: ytdl-core] proxyVideoStream failed for ID: ${downloadId}`);
                    } else {
                        log.warn(`[Layer 2: ytdl-core] No stream URL extracted for ID: ${downloadId}`);
                    }
                } catch (ytdlErr) {
                    layerLog.push({ layer: 2, name: 'ytdl-core', error: ytdlErr.message });
                    log.warn(`[Layer 2: ytdl-core] Exception: ${ytdlErr.message}`);
                }
            }

            // Layer 3: Cobalt API
            if (!isAborted && !isTimedOut) {
                log.info(`[Layer 3: Cobalt] Extraction started for ID: ${downloadId}`);
                try {
                    const cobaltUrl = await getCobaltDirectStream(url);
                    if (cobaltUrl && isValidPublicUrl(cobaltUrl) && !isAborted) {
                        log.info(`[Layer 3: Cobalt] Stream URL extracted, starting proxy for ID: ${downloadId}`);
                        const piped = await ytdlp.proxyVideoStream(cobaltUrl, 'Tanzeel_Video', res, downloadId, ffmpegPath, 0, req);
                        if (piped) {
                            clearTimeout(requestTimeoutTimer);
                            log.info(`[Download Success] Layer 3 succeeded in ${Date.now() - startTime}ms for ID: ${downloadId}`);
                            return;
                        }
                        log.warn(`[Layer 3: Cobalt] proxyVideoStream failed for ID: ${downloadId}`);
                    } else {
                        log.warn(`[Layer 3: Cobalt] No stream URL extracted for ID: ${downloadId}`);
                    }
                } catch (cobaltErr) {
                    layerLog.push({ layer: 3, name: 'Cobalt', error: cobaltErr.message });
                    log.warn(`[Layer 3: Cobalt] Exception: ${cobaltErr.message}`);
                }
            }

            // Layer 4: Piped API
            if (!isAborted && !isTimedOut && videoId) {
                log.info(`[Layer 4: Piped] Extraction started for ID: ${downloadId}`);
                try {
                    const pipedStream = await getPipedDirectStreamUrl(videoId);
                    if (pipedStream && pipedStream.url && isValidPublicUrl(pipedStream.url) && !isAborted) {
                        log.info(`[Layer 4: Piped] Stream URL extracted, starting proxy for ID: ${downloadId}`);
                        const piped = await ytdlp.proxyVideoStream(pipedStream.url, sanitizeFilename(pipedStream.title), res, downloadId, ffmpegPath, 0, req);
                        if (piped) {
                            clearTimeout(requestTimeoutTimer);
                            log.info(`[Download Success] Layer 4 succeeded in ${Date.now() - startTime}ms for ID: ${downloadId}`);
                            return;
                        }
                        log.warn(`[Layer 4: Piped] proxyVideoStream failed for ID: ${downloadId}`);
                    } else {
                        log.warn(`[Layer 4: Piped] No stream URL extracted for ID: ${downloadId}`);
                    }
                } catch (pipedErr) {
                    layerLog.push({ layer: 4, name: 'Piped', error: pipedErr.message });
                    log.warn(`[Layer 4: Piped] Exception: ${pipedErr.message}`);
                }
            }

            // Layer 5: Invidious API
            if (!isAborted && !isTimedOut && videoId) {
                log.info(`[Layer 5: Invidious] Extraction started for ID: ${downloadId}`);
                try {
                    const invidiousStream = await getInvidiousDirectStreamUrl(videoId);
                    if (invidiousStream && invidiousStream.url && isValidPublicUrl(invidiousStream.url) && !isAborted) {
                        log.info(`[Layer 5: Invidious] Stream URL extracted, starting proxy for ID: ${downloadId}`);
                        const piped = await ytdlp.proxyVideoStream(invidiousStream.url, sanitizeFilename(invidiousStream.title), res, downloadId, ffmpegPath, 0, req);
                        if (piped) {
                            clearTimeout(requestTimeoutTimer);
                            log.info(`[Download Success] Layer 5 succeeded in ${Date.now() - startTime}ms for ID: ${downloadId}`);
                            return;
                        }
                        log.warn(`[Layer 5: Invidious] proxyVideoStream failed for ID: ${downloadId}`);
                    } else {
                        log.warn(`[Layer 5: Invidious] No stream URL extracted for ID: ${downloadId}`);
                    }
                } catch (invErr) {
                    layerLog.push({ layer: 5, name: 'Invidious', error: invErr.message });
                    log.warn(`[Layer 5: Invidious] Exception: ${invErr.message}`);
                }
            }

            clearTimeout(requestTimeoutTimer);

            if (isAborted || isTimedOut || res.headersSent) {
                return;
            }

            // All extraction layers failed
            log.error(`[Download Failed] All 5 extraction layers failed in ${Date.now() - startTime}ms for ID: ${downloadId}`);

            setProgress(downloadId, {
                percent: 100,
                status: 'Failed',
                message: 'The source did not provide a downloadable media stream.'
            });
            setTimeout(() => deleteProgress(downloadId), 3000).unref();

            res.status(400).json({
                success: false,
                error: 'EXTRACTION_FAILED',
                message: 'The source did not provide a downloadable media stream.',
                layerLog
            });
        } catch (globalErr) {
            clearTimeout(requestTimeoutTimer);
            log.error(`[Download Critical Error] ID: ${downloadId}`, { error: globalErr.message });
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: 'SERVER_ERROR',
                    message: 'An internal server error occurred while processing download.'
                });
            }
        }
    });

    return router;
}

module.exports = createDownloadRouter;
