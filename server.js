process.env.YTDL_NO_UPDATE = 'true';

const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');

let cookiesPath = path.join(__dirname, 'cookies.txt');
if (process.env.YOUTUBE_COOKIES) {
    const tmpCookies = path.join(os.tmpdir(), 'cookies.txt');
    try {
        fs.writeFileSync(tmpCookies, process.env.YOUTUBE_COOKIES, 'utf-8');
        cookiesPath = tmpCookies;
    } catch (e) {}
} else if (!fs.existsSync(cookiesPath)) {
    const tmpCookies = path.join(os.tmpdir(), 'cookies.txt');
    if (fs.existsSync(tmpCookies)) {
        cookiesPath = tmpCookies;
    }
}

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
            const { execFileSync } = require('child_process');
            execFileSync(ytDlpPath, ['--version'], { stdio: 'ignore', timeout: 3000 });
            binaryAvailabilityCache = true;
            return true;
        }
        if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
            const { execFileSync } = require('child_process');
            execFileSync(process.env.YTDLP_PATH, ['--version'], { stdio: 'ignore', timeout: 3000 });
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

async function getYtdlCoreStreamUrl(videoUrl) {
    if (!ytdlCore) return null;
    try {
        let options = {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        };

        if (fs.existsSync(cookiesPath)) {
            try {
                const cookieContent = fs.readFileSync(cookiesPath, 'utf-8');
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
                console.warn('ytdl-core cookie parsing warning:', cookieErr.message);
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
        console.warn('ytdl-core extraction error:', e.message);
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

const sslAgent = new https.Agent({ rejectUnauthorized: false });

function httpsGetJson(url, timeoutMs = 5000) {
    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const httpLib = parsed.protocol === 'http:' ? http : https;
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
                path: parsed.pathname + parsed.search,
                agent: parsed.protocol === 'http:' ? undefined : sslAgent,
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

app.post(['/analyze', '/api/analyze'], async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
        const body = (req.body && typeof req.body === 'object') ? req.body : {};
        let rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
        if (rawUrl.includes('%3A') || rawUrl.includes('%2F')) {
            try { rawUrl = decodeURIComponent(rawUrl); } catch (e) {}
        }
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
        if (redirectCount > 5) {
            console.warn('Too many redirects in stream proxy');
            return resolve(false);
        }
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
                    if (redirectUrl) {
                        videoRes.resume();
                        return resolve(proxyVideoStream(redirectUrl, safeTitle, res, downloadId, redirectCount + 1));
                    }
                }

                if (videoRes.statusCode !== 200 && videoRes.statusCode !== 206) {
                    console.warn(`Stream proxy HTTP status error: ${videoRes.statusCode}`);
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
                    console.warn(`Stream proxy non-media Content-Type: ${upstreamType}`);
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

                videoRes.pipe(res);
                return resolve(true);
            });

            clientReq.on('error', (err) => {
                console.warn('Stream proxy network error:', err.message);
                return resolve(false);
            });

            clientReq.setTimeout(15000, () => {
                clientReq.destroy();
                console.warn('Stream proxy timeout');
                return resolve(false);
            });
        } catch (err) {
            console.warn('Stream proxy exception:', err.message);
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
                agent: parsed.protocol === 'http:' ? undefined : sslAgent,
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

            if (directUrl) return directUrl;
        } catch (e) {}
    }
    return null;
}

async function getPipedDirectStreamUrl(videoId) {
    const pipedInstances = [
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
            if (combinedMp4 && combinedMp4.url) {
                return { url: combinedMp4.url, title: data.title || 'Tanzeel_Video' };
            }
        }
    }
    return null;
}

async function getInvidiousDirectStreamUrl(videoId) {
    const instances = [
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
            if (combinedMp4 && combinedMp4.url) {
                return { url: combinedMp4.url, title: data.title || 'Tanzeel_Video' };
            }
        }
    }
    return null;
}

app.get(['/download', '/api/download'], async (req, res) => {
    let url = extractUrlFromQuery(req);
    let id = req.query.id;
    
    if (!url || !url.trim()) {
        return res.status(400).json({ success: false, message: 'Invalid URL provided' });
    }

    const rawUrl = url.trim();
    url = normalizeYouTubeUrl(rawUrl);

    console.log(`[DOWNLOAD REQ] ID: ${id || 'none'}, Raw: "${rawUrl}", Normalized: "${url}"`);

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
    const hasBinary = isBinaryAvailable();
    console.log(`[DOWNLOAD REQ] Binary executable available: ${hasBinary}`);

    if (hasBinary) {
        const extractArgs = [
            '--no-check-certificates',
            '--no-playlist',
            '--no-warnings',
            '--ignore-errors',
            '-g',
            '--get-title',
            '-f', '18/22/b/best[ext=mp4]/best'
        ];
        if (ffmpegPath) {
            const ffmpegDir = fs.statSync(ffmpegPath).isDirectory() ? ffmpegPath : path.dirname(ffmpegPath);
            extractArgs.push('--ffmpeg-location', ffmpegDir);
        }
        if (fs.existsSync(cookiesPath)) {
            extractArgs.push('--cookies', cookiesPath);
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
                    if (progressive) {
                        return resolve({ url: progressive, title: titleLine || 'Tanzeel_Video' });
                    }
                    resolve(null);
                });
            });

            if (binaryResult && binaryResult.url) {
                console.log(`[DOWNLOAD] Success via binary extractor: "${binaryResult.title}"`);
                const piped = await proxyVideoStream(binaryResult.url, sanitizeFilename(binaryResult.title), res, downloadId);
                if (piped) return;
            }
        } catch (binErr) {
            console.warn('[DOWNLOAD] Binary extraction exception:', binErr.message);
        }
    }

    // Layer 2: @distube/ytdl-core JS Extractor
    console.log('[DOWNLOAD] Trying @distube/ytdl-core JS extractor...');
    try {
        const ytdlResult = await getYtdlCoreStreamUrl(url);
        if (ytdlResult && ytdlResult.url) {
            console.log(`[DOWNLOAD] Success via @distube/ytdl-core: "${ytdlResult.title}"`);
            const piped = await proxyVideoStream(ytdlResult.url, sanitizeFilename(ytdlResult.title), res, downloadId);
            if (piped) return;
        }
    } catch (ytdlErr) {
        console.warn('[DOWNLOAD] @distube/ytdl-core extraction error:', ytdlErr.message);
    }

    // Layer 3: Cobalt API Stream
    console.log('[DOWNLOAD] Trying Cobalt API stream engine...');
    try {
        const cobaltUrl = await getCobaltDirectStream(url);
        if (cobaltUrl) {
            console.log('[DOWNLOAD] Success via Cobalt API');
            const piped = await proxyVideoStream(cobaltUrl, 'Tanzeel_Video', res, downloadId);
            if (piped) return;
        }
    } catch (cobaltErr) {
        console.warn('[DOWNLOAD] Cobalt stream error:', cobaltErr.message);
    }

    // Layer 4: Piped API Stream
    if (videoId) {
        console.log('[DOWNLOAD] Trying Piped API stream engine...');
        try {
            const pipedStream = await getPipedDirectStreamUrl(videoId);
            if (pipedStream && pipedStream.url) {
                console.log(`[DOWNLOAD] Success via Piped API: "${pipedStream.title}"`);
                const piped = await proxyVideoStream(pipedStream.url, sanitizeFilename(pipedStream.title), res, downloadId);
                if (piped) return;
            }
        } catch (pipedErr) {
            console.warn('[DOWNLOAD] Piped stream error:', pipedErr.message);
        }
    }

    // Layer 5: Invidious API Stream
    if (videoId) {
        console.log('[DOWNLOAD] Trying Invidious API stream engine...');
        try {
            const invidiousStream = await getInvidiousDirectStreamUrl(videoId);
            if (invidiousStream && invidiousStream.url) {
                console.log(`[DOWNLOAD] Success via Invidious API: "${invidiousStream.title}"`);
                const piped = await proxyVideoStream(invidiousStream.url, sanitizeFilename(invidiousStream.title), res, downloadId);
                if (piped) return;
            }
        } catch (invErr) {
            console.warn('[DOWNLOAD] Invidious stream error:', invErr.message);
        }
    }

    // All extraction layers exhausted: return clean HTTP 400 JSON error
    console.error('[DOWNLOAD FAILED] All extraction layers failed for URL:', url);
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