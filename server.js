const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

let ffmpegPath = null;
try {
    const staticPath = require('ffmpeg-static');
    if (staticPath && fs.existsSync(staticPath)) {
        ffmpegPath = staticPath;
    }
} catch (e) {
    console.warn('ffmpeg-static module load warning:', e.message);
}

if (!ffmpegPath) {
    const localFfmpeg = path.join(__dirname, 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe');
    if (fs.existsSync(localFfmpeg)) {
        ffmpegPath = localFfmpeg;
    }
}

const progressMap = new Map();

// Automatic cleanup for progressMap entries older than 10 minutes
function cleanStaleProgress() {
    const now = Date.now();
    for (const [id, data] of progressMap.entries()) {
        if (data.updatedAt && (now - data.updatedAt > 10 * 60 * 1000)) {
            progressMap.delete(id);
        }
    }
}
setInterval(cleanStaleProgress, 5 * 60 * 1000).unref();

function setProgress(id, data) {
    if (!id || typeof id !== 'string') return;
    progressMap.set(id, { ...data, updatedAt: Date.now() });
}

function getProgress(id) {
    if (!id || typeof id !== 'string') return null;
    return progressMap.get(id) || null;
}

function deleteProgress(id) {
    if (!id || typeof id !== 'string') return;
    progressMap.delete(id);
}

const app = express();
const PORT = process.env.PORT || 3000;
const isWin = process.platform === 'win32';
const winBinary = path.join(__dirname, 'downloader.exe');
const linuxBinary = path.join(__dirname, 'yt-dlp');

let ytDlpPath = process.env.YTDLP_PATH;
if (!ytDlpPath) {
    if (isWin && fs.existsSync(winBinary)) {
        ytDlpPath = winBinary;
    } else if (!isWin && fs.existsSync(linuxBinary)) {
        ytDlpPath = linuxBinary;
        try { fs.chmodSync(linuxBinary, '755'); } catch (e) {}
    } else {
        ytDlpPath = isWin ? winBinary : linuxBinary;
    }
}

let ytdlCore = null;
try {
    ytdlCore = require('@distube/ytdl-core');
} catch (e) {
    console.warn('@distube/ytdl-core load warning:', e.message);
}

let binaryAvailabilityCache = null;
function isBinaryAvailable() {
    if (binaryAvailabilityCache !== null) return binaryAvailabilityCache;
    try {
        if (typeof ytDlpPath === 'string' && fs.existsSync(ytDlpPath)) {
            if (!isWin) {
                try { fs.chmodSync(ytDlpPath, '755'); } catch (e) {}
            }
            binaryAvailabilityCache = true;
            return true;
        }
        if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
            binaryAvailabilityCache = true;
            return true;
        }
        if (ytDlpPath === 'yt-dlp' || (typeof ytDlpPath === 'string' && ytDlpPath.endsWith('yt-dlp'))) {
            const whichCmd = isWin ? 'where yt-dlp' : 'which yt-dlp';
            const { execSync } = require('child_process');
            execSync(whichCmd, { stdio: 'ignore' });
            binaryAvailabilityCache = true;
            return true;
        }
    } catch (e) {
        binaryAvailabilityCache = false;
        return false;
    }
    binaryAvailabilityCache = false;
    return false;
}

let isDownloadingBinary = false;
function downloadBinaryIfNeeded() {
    return new Promise((resolve) => {
        if (isBinaryAvailable()) {
            return resolve(ytDlpPath);
        }
        const targetName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
        const tmpPath = path.join(os.tmpdir(), targetName);

        if (fs.existsSync(tmpPath)) {
            try {
                const stats = fs.statSync(tmpPath);
                if (stats.size > 1000000) {
                    ytDlpPath = tmpPath;
                    binaryAvailabilityCache = true;
                    return resolve(ytDlpPath);
                }
            } catch (e) {}
        }

        if (isDownloadingBinary) {
            return resolve(null);
        }
        isDownloadingBinary = true;

        console.log('yt-dlp binary missing on server. Auto-downloading standalone binary to:', tmpPath);
        const downloadUrl = isWin 
            ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
            : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

        function fetchFile(url, dest, attempts = 0) {
            if (attempts > 5) {
                isDownloadingBinary = false;
                return resolve(null);
            }
            https.get(url, { agent: sslAgent }, (res) => {
                if ([301, 302, 307, 308].includes(res.statusCode)) {
                    if (res.headers.location) {
                        return fetchFile(res.headers.location, dest, attempts + 1);
                    }
                }
                if (res.statusCode !== 200) {
                    console.warn('Failed to download yt-dlp binary. HTTP status:', res.statusCode);
                    isDownloadingBinary = false;
                    return resolve(null);
                }
                const fileStream = fs.createWriteStream(dest);
                res.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close(() => {
                        try {
                            if (!isWin) {
                                fs.chmodSync(dest, '755');
                            }
                            ytDlpPath = dest;
                            binaryAvailabilityCache = true;
                            isDownloadingBinary = false;
                            console.log('yt-dlp binary successfully downloaded & cached at:', dest);
                            resolve(dest);
                        } catch (e) {
                            console.error('Error setting permissions on downloaded binary:', e);
                            isDownloadingBinary = false;
                            resolve(null);
                        }
                    });
                });
                fileStream.on('error', (err) => {
                    fs.unlink(dest, () => {});
                    console.error('File stream error while downloading yt-dlp:', err);
                    isDownloadingBinary = false;
                    resolve(null);
                });
            }).on('error', (err) => {
                console.error('Network error downloading yt-dlp:', err);
                isDownloadingBinary = false;
                resolve(null);
            });
        }
        fetchFile(downloadUrl, tmpPath);
    });
}
// Trigger background download on server boot if binary is not present
downloadBinaryIfNeeded().catch(() => {});

let cookiesPath = path.join(__dirname, 'cookies.txt');
if (!fs.existsSync(cookiesPath)) {
    const tmpCookies = path.join(os.tmpdir(), 'cookies.txt');
    if (process.env.YOUTUBE_COOKIES) {
        try {
            fs.writeFileSync(tmpCookies, process.env.YOUTUBE_COOKIES, 'utf-8');
            cookiesPath = tmpCookies;
        } catch (e) {}
    } else if (fs.existsSync(tmpCookies)) {
        cookiesPath = tmpCookies;
    }
}
const downloadsDir = path.join(os.tmpdir(), 'tanzeel_downloads');
try {
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
    }
} catch (e) {
    console.warn('Failed to create tmp downloads directory:', e.message);
}

// Disk cleanup for stale downloads older than 30 minutes
function cleanStaleDownloads() {
    try {
        if (!fs.existsSync(downloadsDir)) return;
        const files = fs.readdirSync(downloadsDir);
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(downloadsDir, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > 30 * 60 * 1000) {
                    fs.unlinkSync(filePath);
                }
            } catch (e) {}
        });
    } catch (e) {
        console.warn('Stale downloads cleanup warning:', e.message);
    }
}
cleanStaleDownloads();
setInterval(cleanStaleDownloads, 15 * 60 * 1000).unref();

function sanitizeFilename(title) {
    if (!title || typeof title !== 'string') return 'Tanzeel_Video';
    const cleaned = title.trim().replace(/[\/\\:\*\?"<>\|\x00-\x1F]/g, '').replace(/\s+/g, '_');
    return cleaned || 'Tanzeel_Video';
}

function setContentDispositionHeader(res, title, ext = 'mp4') {
    const safeTitle = sanitizeFilename(title);
    const asciiTitle = safeTitle.replace(/[^\x20-\x7E]/g, '_');
    const encodedTitle = encodeURIComponent(safeTitle);
    res.header('Content-Disposition', `attachment; filename="${asciiTitle}.${ext}"; filename*=UTF-8''${encodedTitle}.${ext}`);
}

app.use(cors());
app.use(express.json());

// Express Body Parser Error Handler middleware to prevent 500 errors on invalid JSON body
app.use((err, req, res, next) => {
    if (err && (err instanceof SyntaxError || err.status === 400)) {
        return res.status(400).json({ success: false, message: 'Invalid JSON request payload' });
    }
    next(err);
});

// Handle favicon.ico cleanly to avoid any browser 404 errors
app.get('/favicon.ico', (req, res) => {
    const iconPath = path.join(__dirname, 'public', 'favicon.ico');
    if (fs.existsSync(iconPath)) {
        res.setHeader('Content-Type', 'image/x-icon');
        return res.sendFile(iconPath, (err) => {
            if (err && !res.headersSent) {
                res.status(204).end();
            }
        });
    }
    return res.status(204).end();
});

// Serve static files exclusively from public/ directory for security with strict anti-caching headers
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

// Explicit root route handler for Vercel and serverless deployments
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath, (err) => {
            if (err && !res.headersSent) {
                res.status(404).send('Index file not found');
            }
        });
    }
    res.status(404).send('Index file not found');
});

const https = require('https');

function httpsGetJson(url) {
    return new Promise((resolve) => {
        try {
            https.get(url, { agent: sslAgent }, (res) => {
                if (res.statusCode !== 200) return resolve(null);
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve(null);
                    }
                });
            }).on('error', () => resolve(null));
        } catch (e) {
            resolve(null);
        }
    });
}

async function fallbackAnalyze(url) {
    if (url && typeof url === 'string' && (url.includes('youtube.com') || url.includes('youtu.be'))) {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const data = await httpsGetJson(oembedUrl);
        if (data && data.title) {
            return {
                success: true,
                platform: 'YouTube',
                title: data.title,
                qualities: [{ quality: 'Auto (Best available)' }]
            };
        }
    }
    return {
        success: true,
        platform: 'Video Platform',
        title: 'Video Stream',
        qualities: [{ quality: 'Auto (Best available)' }]
    };
}

app.post('/analyze', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
        const body = (req.body && typeof req.body === 'object') ? req.body : {};
        const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
        const url = normalizeYouTubeUrl(rawUrl);
        
        if (!url) {
            return res.status(400).json({ success: false, message: 'Invalid URL provided' });
        }

        // On cloud/serverless environment where binary is missing, attempt auto-download or use fallback
        let hasBinary = isBinaryAvailable();
        if (!hasBinary) {
            await downloadBinaryIfNeeded();
            hasBinary = isBinaryAvailable();
        }

        if (!hasBinary) {
            const fallbackResult = await fallbackAnalyze(url);
            return res.status(200).json(fallbackResult);
        }

        const args = ['--no-playlist', '--no-check-certificates', '--dump-json', '--js-runtimes', 'node'];
        if (fs.existsSync(cookiesPath)) {
            args.push('--cookies', cookiesPath);
        }
        args.push(url);
        
        try {
            execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout, stderr) => {
                if (error || !stdout) {
                    console.warn('yt-dlp execFile warning, using lightweight fallback:', error ? error.message : 'no stdout');
                    if (stderr && stderr.includes('Please sign in')) {
                        return res.status(400).json({ success: false, message: 'This video is age-restricted or private.' });
                    }
                    const fallbackResult = await fallbackAnalyze(url);
                    return res.status(200).json(fallbackResult);
                }
                try {
                    const info = JSON.parse(stdout);
                    return res.status(200).json({
                        success: true,
                        platform: info.extractor ? (info.extractor.charAt(0).toUpperCase() + info.extractor.slice(1)) : 'Video Platform',
                        title: info.title || 'Video',
                        qualities: [{ quality: 'Auto (Best available)' }]
                    });
                } catch (e) {
                    const fallbackResult = await fallbackAnalyze(url);
                    return res.status(200).json(fallbackResult);
                }
            });
        } catch (execErr) {
            console.warn('execFile synchronous exception:', execErr);
            const fallbackResult = await fallbackAnalyze(url);
            return res.status(200).json(fallbackResult);
        }
    } catch (err) {
        console.error('Analyze route exception:', err);
        return res.status(200).json({
            success: true,
            platform: 'Video Platform',
            title: 'Video Stream',
            qualities: [{ quality: 'Auto (Best available)' }]
        });
    }
});

app.get('/progress', (req, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id : null;
    const data = getProgress(id);
    if (data) {
        res.json({ success: true, data });
    } else {
        res.json({ success: false });
    }
});

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

const sslAgent = new https.Agent({ rejectUnauthorized: false });

function proxyVideoStream(streamUrl, safeTitle, res, downloadId, onFail) {
    try {
        const parsedUrl = new URL(streamUrl);
        const httpLib = parsedUrl.protocol === 'http:' ? http : https;
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
            path: parsedUrl.pathname + parsedUrl.search,
            agent: parsedUrl.protocol === 'http:' ? undefined : sslAgent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Referer': 'https://www.youtube.com/',
                'Origin': 'https://www.youtube.com'
            }
        };

        const clientReq = httpLib.get(options, (videoRes) => {
            if ([301, 302, 307, 308].includes(videoRes.statusCode)) {
                const redirectUrl = videoRes.headers.location;
                if (redirectUrl) return proxyVideoStream(redirectUrl, safeTitle, res, downloadId, onFail);
            }
            if (videoRes.statusCode !== 200 && videoRes.statusCode !== 206) {
                console.error('Stream proxy HTTP status error:', videoRes.statusCode);
                if (typeof onFail === 'function') {
                    return onFail();
                }
                if (!res.headersSent) {
                    res.status(400).json({ success: false, message: 'Unable to stream video from source.' });
                }
                if (downloadId) setProgress(downloadId, { percent: 100, status: 'Failed', message: 'Unable to stream video from source.' });
                return;
            }

            const upstreamType = videoRes.headers['content-type'] || 'video/mp4';
            let ext = 'mp4';
            if (upstreamType.includes('webm')) ext = 'webm';
            if (upstreamType.includes('mkv')) ext = 'mkv';

            res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.header('Content-Type', upstreamType);
            setContentDispositionHeader(res, safeTitle, ext);

            if (videoRes.headers['content-length']) {
                res.header('Content-Length', videoRes.headers['content-length']);
            }
            
            if (downloadId) {
                setProgress(downloadId, { percent: 100, size: 'Done', speed: 'Fast', eta: '0s', status: 'Complete' });
                deleteProgress(downloadId);
            }
            
            videoRes.pipe(res);
        });

        clientReq.on('error', (err) => {
            console.error('Stream proxy network error:', err);
            if (typeof onFail === 'function') {
                return onFail();
            }
            if (!res.headersSent) res.status(400).json({ success: false, message: 'Stream connection error.' });
            if (downloadId) setProgress(downloadId, { percent: 100, status: 'Failed', message: 'Stream connection error.' });
        });

        clientReq.setTimeout(15000, () => {
            clientReq.destroy();
            if (typeof onFail === 'function') {
                return onFail();
            }
            if (!res.headersSent) res.status(504).json({ success: false, message: 'Stream request timeout.' });
            if (downloadId) setProgress(downloadId, { percent: 100, status: 'Failed', message: 'Stream request timeout.' });
        });
    } catch (err) {
        console.error('Proxy exception:', err);
        if (typeof onFail === 'function') {
            return onFail();
        }
        if (!res.headersSent) res.status(400).json({ success: false, message: 'Stream exception.' });
        if (downloadId) setProgress(downloadId, { percent: 100, status: 'Failed', message: 'Stream exception.' });
    }
}

async function getCobaltDirectStream(videoUrl) {
    const instances = [
        { hostname: 'api.cobalt.tools', path: '/' },
        { hostname: 'cobalt.q1.l5.ca', path: '/' },
        { hostname: 'co.wuk.sh', path: '/' }
    ];

    for (const inst of instances) {
        try {
            const postData = JSON.stringify({ url: videoUrl });
            const options = {
                hostname: inst.hostname,
                port: 443,
                path: inst.path,
                method: 'POST',
                agent: sslAgent,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const directUrl = await new Promise((resolve) => {
                const req = https.request(options, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(body);
                            if (json) {
                                if (json.url) return resolve(json.url);
                                if (json.picker && Array.isArray(json.picker) && json.picker[0] && json.picker[0].url) {
                                    return resolve(json.picker[0].url);
                                }
                            }
                            resolve(null);
                        } catch (e) {
                            resolve(null);
                        }
                    });
                });
                req.on('error', () => resolve(null));
                req.setTimeout(2000, () => { req.destroy(); resolve(null); });
                req.write(postData);
                req.end();
            });

            if (directUrl) return directUrl;
        } catch (e) {}
    }
    return null;
}

async function getPipedDirectStreamUrl(videoId) {
    const pipedInstances = [
        `https://api.piped.video/streams/${videoId}`,
        `https://pipedapi.kavin.rocks/streams/${videoId}`,
        `https://pipedapi.mha.fi/streams/${videoId}`,
        `https://pipedapi.privacydev.net/streams/${videoId}`
    ];
    for (const instUrl of pipedInstances) {
        const data = await httpsGetJson(instUrl, 2000);
        if (data && data.videoStreams && data.videoStreams.length > 0) {
            const combinedMp4 = data.videoStreams.find(s => s.mimeType && s.mimeType.includes('video/mp4') && s.hasAudio) ||
                                data.videoStreams.find(s => s.quality === '720p' && s.hasAudio) ||
                                data.videoStreams.find(s => s.mimeType && s.mimeType.includes('video/mp4'));
            if (combinedMp4 && combinedMp4.url) {
                return { url: combinedMp4.url, title: data.title };
            }
        }
    }
    return null;
}

async function getInvidiousDirectStreamUrl(videoId) {
    const instances = [
        `https://inv.tux.pizza/api/v1/videos/${videoId}`,
        `https://yewtu.be/api/v1/videos/${videoId}`,
        `https://vid.puffyan.us/api/v1/videos/${videoId}`,
        `https://invidious.nerdvpn.de/api/v1/videos/${videoId}`,
        `https://invidious.flokinet.to/api/v1/videos/${videoId}`
    ];
    for (const instUrl of instances) {
        const data = await httpsGetJson(instUrl, 2000);
        if (data && data.formatStreams && data.formatStreams.length > 0) {
            const combinedMp4 = data.formatStreams.find(s => String(s.itag) === '22') ||
                                data.formatStreams.find(s => String(s.itag) === '18') ||
                                data.formatStreams.find(s => s.container === 'mp4' && s.encoding === 'h264') ||
                                data.formatStreams.find(s => s.container === 'mp4');
            if (combinedMp4 && combinedMp4.url) {
                return { url: combinedMp4.url, title: data.title };
            }
        }
    }
    return null;
}

app.get('/download', async (req, res) => {
    let { url, id } = req.query;
    
    if (!url || typeof url !== 'string') {
        return res.status(400).send('Invalid URL provided');
    }

    url = normalizeYouTubeUrl(url);

    const downloadId = (id && typeof id === 'string') ? id : Math.random().toString(36).substring(2, 10);
    
    // Register progress immediately so frontend polling never times out!
    setProgress(downloadId, { 
        percent: 15, 
        size: 'Fetching...', 
        speed: 'Connecting...', 
        eta: 'Calculating...', 
        status: 'Downloading...' 
    });

    let hasBinary = isBinaryAvailable();
    if (!hasBinary) {
        await downloadBinaryIfNeeded();
        hasBinary = isBinaryAvailable();
    }

    // Fallback if binary is not present on environment (e.g. cloud serverless)
    if (!hasBinary) {
        let streamUrl = null;

        // 1. Try Cobalt stream engine
        try {
            streamUrl = await getCobaltDirectStream(url);
        } catch (e) {}
        
        // 2. Try Piped API stream engine if Cobalt stream is null
        const videoId = extractYouTubeId(url);
        if (!streamUrl && videoId) {
            try {
                const pipedStream = await getPipedDirectStreamUrl(videoId);
                if (pipedStream && pipedStream.url) {
                    streamUrl = pipedStream.url;
                }
            } catch (e) {}
        }

        // 3. Try Invidious API stream engine
        if (!streamUrl && videoId) {
            try {
                const invidiousStream = await getInvidiousDirectStreamUrl(videoId);
                if (invidiousStream && invidiousStream.url) {
                    streamUrl = invidiousStream.url;
                }
            } catch (e) {}
        }

        if (streamUrl) {
            return proxyVideoStream(streamUrl, 'Tanzeel_Video', res, downloadId);
        }

        setProgress(downloadId, { percent: 100, status: 'Failed', message: 'Unable to extract video stream from source.' });
        setTimeout(() => deleteProgress(downloadId), 5000).unref();
        if (!res.headersSent) {
            res.status(400).setHeader('Content-Type', 'application/json');
            return res.json({ success: false, message: 'Unable to extract video stream from source.' });
        }
    }

    // Instant Direct Stream Extraction via yt-dlp -g --get-title
    const extractArgs = [
        '--no-check-certificates',
        '--no-playlist',
        '--js-runtimes', 'node',
        '-g',
        '--get-title',
        '-f', '18/22/best[ext=mp4]/b/best'
    ];
    if (ffmpegPath) {
        const ffmpegDir = fs.statSync(ffmpegPath).isDirectory() ? ffmpegPath : path.dirname(ffmpegPath);
        extractArgs.push('--ffmpeg-location', ffmpegDir);
    }
    if (fs.existsSync(cookiesPath)) {
        extractArgs.push('--cookies', cookiesPath);
    }
    extractArgs.push(url);

    execFile(ytDlpPath, extractArgs, { timeout: 30000, maxBuffer: 1024 * 1024 * 10 }, async (error, stdout) => {
        let rawTitle = 'Tanzeel_Video';
        let directUrl = null;

        if (stdout) {
            const lines = stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
            const titleLine = lines.find(l => !l.startsWith('http') && !l.startsWith('WARNING:'));
            if (titleLine) rawTitle = titleLine;

            const httpLines = lines.filter(l => l.startsWith('http'));
            if (httpLines.length > 0) {
                // Prefer non-m3u8 progressive links if available
                const progressive = httpLines.find(l => !l.includes('.m3u8')) || httpLines[httpLines.length - 1];
                if (progressive) directUrl = progressive;
            }
        }
        const safeTitle = sanitizeFilename(rawTitle);

        const runSpawnFallback = () => {
            const dlArgs = [
                '--no-check-certificates',
                '--no-playlist', 
                '--js-runtimes', 'node',
                '-f', '18/22/best[ext=mp4]/b/best', 
                '-o', '-'
            ];
            if (ffmpegPath) {
                const ffmpegDir = fs.statSync(ffmpegPath).isDirectory() ? ffmpegPath : path.dirname(ffmpegPath);
                dlArgs.push('--ffmpeg-location', ffmpegDir);
            }
            if (fs.existsSync(cookiesPath)) {
                dlArgs.push('--cookies', cookiesPath);
            }
            dlArgs.push(url);

            const subprocess = spawn(ytDlpPath, dlArgs);

            let inactivityTimer = setTimeout(() => {
                try { subprocess.kill('SIGTERM'); } catch (e) {}
            }, 60000);

            const resetInactivity = () => {
                if (inactivityTimer) clearTimeout(inactivityTimer);
                inactivityTimer = setTimeout(() => {
                    try { subprocess.kill('SIGTERM'); } catch (e) {}
                }, 60000);
            };

            req.on('close', () => {
                if (inactivityTimer) clearTimeout(inactivityTimer);
                try { subprocess.kill('SIGTERM'); } catch (e) {}
            });
            
            let hasStartedStreaming = false;
            subprocess.stdout.on('data', (chunk) => {
                resetInactivity();
                if (!hasStartedStreaming) {
                    hasStartedStreaming = true;
                    if (!res.headersSent) {
                        res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                        res.header('Content-Type', 'video/mp4');
                        setContentDispositionHeader(res, safeTitle, 'mp4');
                    }
                }
                res.write(chunk);
            });

            subprocess.stdout.on('end', () => {
                if (inactivityTimer) clearTimeout(inactivityTimer);
                if (!hasStartedStreaming) {
                    if (!res.headersSent) {
                        res.status(400).json({ success: false, message: 'Unable to stream video from source.' });
                    }
                    if (downloadId) setProgress(downloadId, { percent: 100, status: 'Failed', message: 'Unable to stream video from source.' });
                    return;
                }
                res.end();
                if (downloadId) setProgress(downloadId, { percent: 100, status: 'Complete' });
                setTimeout(() => deleteProgress(downloadId), 5000).unref();
            });

            subprocess.on('error', (err) => {
                if (inactivityTimer) clearTimeout(inactivityTimer);
                console.error('yt-dlp spawn error:', err);
                if (downloadId) setProgress(downloadId, { percent: 100, status: 'Failed', message: 'Video download error.' });
                if (!res.headersSent) {
                    res.status(400).json({ success: false, message: 'Video download error.' });
                }
                if (downloadId) setTimeout(() => deleteProgress(downloadId), 5000).unref();
            });
        };

        if (directUrl && directUrl.startsWith('http') && !directUrl.includes('.m3u8')) {
            return proxyVideoStream(directUrl, safeTitle, res, downloadId, runSpawnFallback);
        }

        // Fallback stream engines
        let streamUrl = null;
        try { streamUrl = await getCobaltDirectStream(url); } catch (e) {}
        const videoId = extractYouTubeId(url);
        if (!streamUrl && videoId) {
            try {
                const piped = await getPipedDirectStreamUrl(videoId);
                if (piped && piped.url) streamUrl = piped.url;
            } catch (e) {}
        }
        if (!streamUrl && videoId) {
            try {
                const inv = await getInvidiousDirectStreamUrl(videoId);
                if (inv && inv.url) streamUrl = inv.url;
            } catch (e) {}
        }

        if (streamUrl) {
            return proxyVideoStream(streamUrl, safeTitle, res, downloadId, runSpawnFallback);
        }

        runSpawnFallback();
    });
});

// Global catch-all error handling middleware to prevent unhandled 500 server crashes
app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    if (!res.headersSent) {
        res.status(400).json({
            success: false,
            message: err ? (err.message || 'An unexpected request error occurred.') : 'An error occurred'
        });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;