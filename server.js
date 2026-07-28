process.env.YTDL_NO_UPDATE = 'true';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Determine cookie path safely without requiring committed cookies.txt
function getCookiesPath() {
    if (process.env.YOUTUBE_COOKIES) {
        const tmpCookies = path.join(os.tmpdir(), 'tanzeel_env_cookies.txt');
        try {
            fs.writeFileSync(tmpCookies, process.env.YOUTUBE_COOKIES, 'utf-8');
            return tmpCookies;
        } catch (e) {}
    }
    const localCookies = path.join(__dirname, 'cookies.txt');
    if (fs.existsSync(localCookies)) {
        return localCookies;
    }
    const tmpCookies = path.join(os.tmpdir(), 'cookies.txt');
    if (fs.existsSync(tmpCookies)) {
        return tmpCookies;
    }
    return null;
}

let ffmpegPath = null;
try {
    const staticPath = require('ffmpeg-static');
    if (staticPath && fs.existsSync(staticPath)) {
        ffmpegPath = staticPath;
    }
} catch (e) {
    // Optional dependency warning handled gracefully
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
app.disable('x-powered-by');

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
    // Optional dependency fallback
}

let binaryAvailabilityCache = null;
function isBinaryAvailable() {
    const targetName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
    const tmpPath = path.join(os.tmpdir(), targetName);

    if (fs.existsSync(tmpPath)) {
        try {
            const stats = fs.statSync(tmpPath);
            if (stats.size > 1000000) {
                if (!isWin) {
                    try { fs.chmodSync(tmpPath, '755'); } catch (e) {}
                }
                ytDlpPath = tmpPath;
                return true;
            }
        } catch (e) {}
    }

    const localBinary = path.join(__dirname, targetName);
    if (fs.existsSync(localBinary)) {
        try {
            if (!isWin) {
                try { fs.chmodSync(localBinary, '755'); } catch (e) {}
            }
            ytDlpPath = localBinary;
            return true;
        } catch (chmodErr) {
            try {
                fs.copyFileSync(localBinary, tmpPath);
                if (!isWin) fs.chmodSync(tmpPath, '755');
                ytDlpPath = tmpPath;
                return true;
            } catch (copyErr) {}
        }
    }

    if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
        ytDlpPath = process.env.YTDLP_PATH;
        return true;
    }

    return false;
}

async function getYtdlCoreStreamUrl(videoUrl) {
    if (!ytdlCore) return null;
    try {
        let options = {
            requestOptions: {
                rejectUnauthorized: false,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        };

        const cookiesFile = getCookiesPath();
        if (cookiesFile && fs.existsSync(cookiesFile)) {
            try {
                const cookieContent = fs.readFileSync(cookiesFile, 'utf-8');
                const lines = cookieContent.split('\n');
                const parsedCookies = lines.map(line => {
                    if (!line || line.startsWith('#')) return null;
                    const parts = line.split('\t');
                    if (parts.length < 7) return null;
                    const domain = parts[0];
                    if (!domain.includes('youtube.com')) return null;
                    return {
                        domain,
                        expirationDate: parseInt(parts[4]),
                        path: parts[2],
                        secure: parts[3] === 'TRUE',
                        value: parts[6].trim(),
                        name: parts[5].trim()
                    };
                }).filter(Boolean);

                if (parsedCookies.length > 0 && typeof ytdlCore.createAgent === 'function') {
                    options.agent = ytdlCore.createAgent(parsedCookies);
                }
            } catch (cookieErr) {
                // Ignore invalid cookie format safely
            }
        }

        const info = await ytdlCore.getInfo(videoUrl, options);
        if (info && info.formats && info.formats.length > 0) {
            const format = (typeof ytdlCore.chooseFormat === 'function' ? ytdlCore.chooseFormat(info.formats, { filter: 'audioandvideo' }) : null) ||
                           info.formats.find(f => f.hasVideo && f.hasAudio && f.url) ||
                           info.formats.find(f => f.hasVideo && f.url);
            if (format && format.url) {
                return {
                    url: format.url,
                    title: (info.videoDetails && info.videoDetails.title) ? info.videoDetails.title : 'Tanzeel_Video'
                };
            }
        }
    } catch (e) {
        // ytdl-core extraction error handled silently for fallback
    }
    return null;
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
            : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

        function fetchFile(url, dest, attempts = 0) {
            if (attempts > 5) {
                isDownloadingBinary = false;
                return resolve(null);
            }
            const parsedUrl = new URL(url);
            const reqOpts = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 443,
                path: parsedUrl.pathname + parsedUrl.search,
                rejectUnauthorized: false,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                }
            };
            https.get(reqOpts, (res) => {
                if ([301, 302, 307, 308].includes(res.statusCode)) {
                    if (res.headers.location) {
                        return fetchFile(res.headers.location, dest, attempts + 1);
                    }
                }
                if (res.statusCode !== 200) {
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
                            isDownloadingBinary = false;
                            resolve(null);
                        }
                    });
                });
                fileStream.on('error', (err) => {
                    fs.unlink(dest, () => {});
                    isDownloadingBinary = false;
                    resolve(null);
                });
            }).on('error', (err) => {
                isDownloadingBinary = false;
                resolve(null);
            });
        }
        fetchFile(downloadUrl, tmpPath);
    });
}

downloadBinaryIfNeeded().catch(() => {});

const downloadsDir = path.join(os.tmpdir(), 'tanzeel_downloads');
try {
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
    }
} catch (e) {}

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
    } catch (e) {}
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

// Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' blob: https:; connect-src 'self' https:;");
    next();
});

// Lightweight Rate Limiting Middleware (30 requests / min per IP)
const rateLimitMap = new Map();
function rateLimiter(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 40;

    let record = rateLimitMap.get(ip);
    if (!record || now - record.startTime > windowMs) {
        record = { count: 1, startTime: now };
    } else {
        record.count++;
    }
    rateLimitMap.set(ip, record);

    if (record.count > maxRequests) {
        return res.status(429).json({
            success: false,
            error: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please wait a minute before trying again.'
        });
    }
    next();
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimitMap.entries()) {
        if (now - record.startTime > 60 * 1000) {
            rateLimitMap.delete(ip);
        }
    }
}, 5 * 60 * 1000).unref();

app.use(cors());
app.use(express.json());

// Express Body Parser Error Handler middleware to prevent 500 errors on invalid JSON body
app.use((err, req, res, next) => {
    if (err && (err instanceof SyntaxError || err.status === 400)) {
        return res.status(400).json({ success: false, message: 'Invalid JSON request payload' });
    }
    next(err);
});

// Handle favicon.ico cleanly
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

// Serve static files exclusively from public/ directory
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

// Root route handler
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

// SSRF & URL Validation Guard
function isValidPublicUrl(inputUrl) {
    if (!inputUrl || typeof inputUrl !== 'string') return false;
    const trimmed = inputUrl.trim();
    if (!trimmed) return false;

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch (e) {
        return false;
    }

    // Only allow http: and https: protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Reject localhost / loopback / empty hostnames
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0' || hostname === '') {
        return false;
    }

    // Reject cloud metadata / link-local addresses
    if (hostname === '169.254.169.254' || hostname.startsWith('169.254.')) {
        return false;
    }

    // Reject IPv4 private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;

    // Reject IPv6 private/link-local ranges (fc00::, fd00::, fe80::)
    if (hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80')) return false;

    return true;
}

function httpsGetJson(url, timeoutMs = 5000) {
    return new Promise((resolve) => {
        if (!isValidPublicUrl(url)) return resolve(null);
        try {
            const parsed = new URL(url);
            const httpLib = parsed.protocol === 'http:' ? http : https;
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
                path: parsed.pathname + parsed.search,
                rejectUnauthorized: false,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                }
            };
            const req = httpLib.get(options, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    return resolve(null);
                }
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve(null);
                    }
                });
            });
            req.on('error', () => resolve(null));
            req.setTimeout(timeoutMs, () => {
                req.destroy();
                resolve(null);
            });
        } catch (e) {
            resolve(null);
        }
    });
}

async function fallbackAnalyze(url) {
    if (url && typeof url === 'string' && (url.includes('youtube.com') || url.includes('youtu.be'))) {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const data = await httpsGetJson(oembedUrl, 3000);
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

app.post(['/analyze', '/api/analyze'], rateLimiter, async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
        const body = (req.body && typeof req.body === 'object') ? req.body : {};
        let rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
        if (rawUrl.includes('%3A') || rawUrl.includes('%2F')) {
            try { rawUrl = decodeURIComponent(rawUrl); } catch (e) {}
        }
        const url = normalizeYouTubeUrl(rawUrl);
        
        if (!isValidPublicUrl(url)) {
            return res.status(400).json({ success: false, message: 'Invalid URL provided' });
        }

        let hasBinary = isBinaryAvailable();
        if (!hasBinary) {
            await downloadBinaryIfNeeded();
            hasBinary = isBinaryAvailable();
        }

        if (!hasBinary) {
            const fallbackResult = await fallbackAnalyze(url);
            return res.status(200).json(fallbackResult);
        }

        const args = [
            '--no-playlist',
            '--no-check-certificate',
            '--extractor-args', 'youtube:player_client=ios,android,mweb',
            '--dump-json'
        ];
        const cookiesFile = getCookiesPath();
        if (cookiesFile && fs.existsSync(cookiesFile)) {
            args.push('--cookies', cookiesFile);
        }
        args.push(url);
        
        try {
            execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout, stderr) => {
                if (error || !stdout) {
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
            const fallbackResult = await fallbackAnalyze(url);
            return res.status(200).json(fallbackResult);
        }
    } catch (err) {
        return res.status(200).json({
            success: true,
            platform: 'Video Platform',
            title: 'Video Stream',
            qualities: [{ quality: 'Auto (Best available)' }]
        });
    }
});

app.get(['/progress', '/api/progress'], (req, res) => {
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

function proxyVideoStream(streamUrl, safeTitle, res, downloadId, redirectCount = 0) {
    return new Promise((resolve) => {
        if (!isValidPublicUrl(streamUrl)) {
            return resolve(false);
        }
        if (redirectCount > 5) {
            return resolve(false);
        }
        try {
            const parsedUrl = new URL(streamUrl);
            const httpLib = parsedUrl.protocol === 'http:' ? http : https;
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
                path: parsedUrl.pathname + parsedUrl.search,
                rejectUnauthorized: false,
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
                    if (redirectUrl) {
                        videoRes.resume();
                        return resolve(proxyVideoStream(redirectUrl, safeTitle, res, downloadId, redirectCount + 1));
                    }
                }

                if (videoRes.statusCode !== 200 && videoRes.statusCode !== 206) {
                    videoRes.resume();
                    return resolve(false);
                }

                const upstreamType = (videoRes.headers['content-type'] || 'video/mp4').toLowerCase();
                const isMedia = upstreamType.includes('video') || 
                                upstreamType.includes('audio') || 
                                upstreamType.includes('octet-stream') || 
                                upstreamType.includes('media');
                const isHtmlOrText = upstreamType.includes('text/html') || 
                                     upstreamType.includes('application/json') || 
                                     upstreamType.includes('text/plain');

                if (!isMedia || isHtmlOrText) {
                    videoRes.resume();
                    return resolve(false);
                }

                let ext = 'mp4';
                if (upstreamType.includes('webm')) ext = 'webm';
                if (upstreamType.includes('mkv')) ext = 'mkv';

                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Content-Type', upstreamType);
                setContentDispositionHeader(res, safeTitle, ext);

                if (videoRes.headers['content-length']) {
                    res.setHeader('Content-Length', videoRes.headers['content-length']);
                }

                if (downloadId) {
                    setProgress(downloadId, { percent: 100, size: 'Done', speed: 'Fast', eta: '0s', status: 'Complete' });
                    deleteProgress(downloadId);
                }

                // Handle client disconnect gracefully to cancel upstream request
                res.on('close', () => {
                    clientReq.destroy();
                });

                videoRes.pipe(res);
                return resolve(true);
            });

            clientReq.on('error', () => resolve(false));

            clientReq.setTimeout(15000, () => {
                clientReq.destroy();
                return resolve(false);
            });
        } catch (err) {
            return resolve(false);
        }
    });
}

async function getCobaltDirectStream(videoUrl) {
    const instances = [
        'https://api.cobalt.tools/',
        'https://cobalt.host/',
        'https://cobalt.v0.pw/'
    ];

    for (const endpoint of instances) {
        try {
            const parsed = new URL(endpoint);
            const postData = JSON.stringify({
                url: videoUrl,
                videoQuality: '720',
                youtubeVideoCodec: 'h264'
            });

            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
                path: parsed.pathname,
                method: 'POST',
                rejectUnauthorized: false,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const directUrl = await new Promise((resolve) => {
                const req = (parsed.protocol === 'http:' ? http : https).request(options, (res) => {
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
                                if (json.tunnel) return resolve(json.tunnel);
                            }
                            resolve(null);
                        } catch (e) {
                            resolve(null);
                        }
                    });
                });
                req.on('error', () => resolve(null));
                req.setTimeout(3000, () => { req.destroy(); resolve(null); });
                req.write(postData);
                req.end();
            });

            if (directUrl && isValidPublicUrl(directUrl)) return directUrl;
        } catch (e) {}
    }
    return null;
}

async function getPipedDirectStreamUrl(videoId) {
    const pipedInstances = [
        `https://api.piped.privacydev.net/streams/${videoId}`,
        `https://pipedapi.kavin.rocks/streams/${videoId}`,
        `https://pipedapi.drgns.space/streams/${videoId}`
    ];
    for (const instUrl of pipedInstances) {
        const data = await httpsGetJson(instUrl, 2500);
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

async function getInvidiousDirectStreamUrl(videoId) {
    const instances = [
        `https://inv.tux.pizza/api/v1/videos/${videoId}`,
        `https://invidious.nerdvpn.de/api/v1/videos/${videoId}`,
        `https://invidious.drgns.space/api/v1/videos/${videoId}`,
        `https://invidious.projectsegfau.lt/api/v1/videos/${videoId}`
    ];
    for (const instUrl of instances) {
        const data = await httpsGetJson(instUrl, 2500);
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

app.get(['/download', '/api/download'], rateLimiter, async (req, res) => {
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

    // Layer 1: Executable Binary Extractor (yt-dlp)
    let hasBinary = isBinaryAvailable();
    if (!hasBinary) {
        await downloadBinaryIfNeeded();
        hasBinary = isBinaryAvailable();
    }

    if (hasBinary) {
        const extractArgs = [
            '--no-playlist',
            '--no-warnings',
            '--ignore-errors',
            '--no-check-certificate',
            '--extractor-args', 'youtube:player_client=ios,android,mweb',
            '-g',
            '--get-title',
            '-f', '18/22/b/best[ext=mp4]/best/bestvideo+bestaudio'
        ];
        if (ffmpegPath) {
            const ffmpegDir = fs.statSync(ffmpegPath).isDirectory() ? ffmpegPath : path.dirname(ffmpegPath);
            extractArgs.push('--ffmpeg-location', ffmpegDir);
        }
        const cookiesFile = getCookiesPath();
        if (cookiesFile && fs.existsSync(cookiesFile)) {
            extractArgs.push('--cookies', cookiesFile);
        }
        extractArgs.push(url);

        try {
            const binaryResult = await new Promise((resolve) => {
                execFile(ytDlpPath, extractArgs, { timeout: 30000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
                    if (!stdout || !stdout.trim()) return resolve(null);
                    const lines = stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
                    const titleLine = lines.find(l => !l.startsWith('http') && !l.startsWith('WARNING:') && !l.startsWith('ERROR:'));
                    const httpLines = lines.filter(l => l.startsWith('http'));
                    const progressive = httpLines.find(l => !l.includes('.m3u8')) || httpLines[httpLines.length - 1];
                    if (progressive && isValidPublicUrl(progressive)) {
                        return resolve({ url: progressive, title: titleLine || 'Tanzeel_Video' });
                    }
                    resolve(null);
                });
            });

            if (binaryResult && binaryResult.url) {
                const piped = await proxyVideoStream(binaryResult.url, sanitizeFilename(binaryResult.title), res, downloadId);
                if (piped) return;
            }
        } catch (binErr) {}
    }

    // Layer 2: @distube/ytdl-core JS Extractor
    try {
        const ytdlResult = await getYtdlCoreStreamUrl(url);
        if (ytdlResult && ytdlResult.url && isValidPublicUrl(ytdlResult.url)) {
            const piped = await proxyVideoStream(ytdlResult.url, sanitizeFilename(ytdlResult.title), res, downloadId);
            if (piped) return;
        }
    } catch (ytdlErr) {}

    // Layer 3: Cobalt API Stream
    try {
        const cobaltUrl = await getCobaltDirectStream(url);
        if (cobaltUrl && isValidPublicUrl(cobaltUrl)) {
            const piped = await proxyVideoStream(cobaltUrl, 'Tanzeel_Video', res, downloadId);
            if (piped) return;
        }
    } catch (cobaltErr) {}

    // Layer 4: Piped API Stream
    if (videoId) {
        try {
            const pipedStream = await getPipedDirectStreamUrl(videoId);
            if (pipedStream && pipedStream.url && isValidPublicUrl(pipedStream.url)) {
                const piped = await proxyVideoStream(pipedStream.url, sanitizeFilename(pipedStream.title), res, downloadId);
                if (piped) return;
            }
        } catch (pipedErr) {}
    }

    // Layer 5: Invidious API Stream
    if (videoId) {
        try {
            const invidiousStream = await getInvidiousDirectStreamUrl(videoId);
            if (invidiousStream && invidiousStream.url && isValidPublicUrl(invidiousStream.url)) {
                const piped = await proxyVideoStream(invidiousStream.url, sanitizeFilename(invidiousStream.title), res, downloadId);
                if (piped) return;
            }
        } catch (invErr) {}
    }

    // All extraction layers exhausted: return clean HTTP 400 JSON error
    setProgress(downloadId, { percent: 100, status: 'Failed', message: 'Unable to extract video stream from source.' });
    setTimeout(() => deleteProgress(downloadId), 5000).unref();

    if (!res.headersSent) {
        res.status(400).setHeader('Content-Type', 'application/json');
        return res.json({
            success: false,
            error: 'EXTRACTION_FAILED',
            message: 'Unable to extract video stream from source.'
        });
    }
});

// Global catch-all error handling middleware to prevent unhandled 500 server crashes
app.use((err, req, res, next) => {
    if (!res.headersSent) {
        res.status(400).json({
            success: false,
            message: 'An unexpected request error occurred.'
        });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;