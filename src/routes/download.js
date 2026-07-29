const { normalizeYouTubeUrl, extractYouTubeId, extractUrlFromQuery } = require('../utils/url');
const { isValidPublicUrl } = require('../utils/validate');
const { sanitizeFilename } = require('../utils/filename');
const { setProgress, deleteProgress } = require('../utils/progress');
const ytdlp = require('../services/ytdlp');
const { getCobaltDirectStream } = require('../services/cobalt');
const { getPipedDirectStreamUrl } = require('../services/piped');
const { getInvidiousDirectStreamUrl } = require('../services/invidious');
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

        const rawUrl = url.trim();
        url = normalizeYouTubeUrl(rawUrl);
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

<<<<<<< HEAD
        // Overall Download Timeout Guard (35 seconds)
        let isTimedOut = false;
        const requestTimeoutTimer = setTimeout(() => {
            if (!res.headersSent && !isAborted) {
                isTimedOut = true;
                isAborted = true;
                log.error(`[Download Request Timeout] Exceeded 35000ms for ID: ${downloadId}`);
                if (spawnedChildProc) {
                    try { spawnedChildProc.kill('SIGKILL'); } catch (e) {}
                }
                setProgress(downloadId, { percent: 100, status: 'Failed', message: 'Download request timed out.' });
                setTimeout(() => deleteProgress(downloadId), 3000).unref();
                res.status(504).json({
                    success: false,
                    error: 'REQUEST_TIMEOUT',
                    message: 'Download request timed out.'
                });
            }
        }, 35000);
=======
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
>>>>>>> 46e37a9320364250e467a23599b14232dcdd4d0c

        try {
<<<<<<< HEAD
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
                            log.warn(`[Layer 1: yt-dlp binary] proxyVideoStream failed for ID: ${downloadId}`);
                        } else {
                            log.warn(`[Layer 1: yt-dlp binary] No stream URL extracted for ID: ${downloadId}`);
                        }
                    } catch (binErr) {
                        log.warn(`[Layer 1: yt-dlp binary] Exception: ${binErr.message}`);
                    }
                }
=======
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
>>>>>>> 46e37a9320364250e467a23599b14232dcdd4d0c
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
                    log.warn(`[Layer 2: ytdl-core] Exception: ${ytdlErr.message}`);
                }
            }

<<<<<<< HEAD
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
                    log.warn(`[Layer 3: Cobalt] Exception: ${cobaltErr.message}`);
                }
            }
=======
        console.error('All extraction layers failed for URL:', url);
        console.error('Layer log:', layerLog.join(' | '));
>>>>>>> 46e37a9320364250e467a23599b14232dcdd4d0c

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
                message: 'The source did not provide a downloadable media stream.'
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
