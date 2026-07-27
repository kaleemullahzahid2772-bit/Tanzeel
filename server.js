const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
const defaultYtDlp = isWin ? path.join(__dirname, 'downloader.exe') : 'yt-dlp';
let ytDlpPath = process.env.YTDLP_PATH || defaultYtDlp;
try {
    if (fs.existsSync(defaultYtDlp)) {
        ytDlpPath = defaultYtDlp;
    }
} catch (e) {}

const cookiesPath = path.join(__dirname, 'cookies.txt');
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
                res.redirect(302, '/index.html');
            }
        });
    }
    res.redirect(302, '/index.html');
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

        // On Vercel / serverless cloud environment where binary is missing, use instant API fallback
        const hasBinary = fs.existsSync(ytDlpPath) || ytDlpPath === 'yt-dlp' || Boolean(process.env.YTDLP_PATH);

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

function proxyVideoStream(streamUrl, safeTitle, res, downloadId) {
    try {
        const parsedUrl = new URL(streamUrl);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            agent: sslAgent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*'
            }
        };

        https.get(options, (videoRes) => {
            if (videoRes.statusCode === 301 || videoRes.statusCode === 302 || videoRes.statusCode === 307) {
                const redirectUrl = videoRes.headers.location;
                if (redirectUrl) return proxyVideoStream(redirectUrl, safeTitle, res, downloadId);
            }
            if (videoRes.statusCode !== 200 && videoRes.statusCode !== 206) {
                console.error('Stream proxy HTTP status error:', videoRes.statusCode);
                if (!res.headersSent) {
                    res.status(400).json({ success: false, message: 'Unable to stream video from source.' });
                }
                if (downloadId) deleteProgress(downloadId);
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
                setTimeout(() => deleteProgress(downloadId), 5000);
            }
            
            videoRes.pipe(res);
        }).on('error', (err) => {
            console.error('Stream proxy network error:', err);
            if (!res.headersSent) res.status(500).json({ success: false, message: 'Stream connection error.' });
            if (downloadId) deleteProgress(downloadId);
        });
    } catch (err) {
        console.error('Proxy exception:', err);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Stream exception.' });
        if (downloadId) deleteProgress(downloadId);
    }
}

async function getCobaltDirectStream(videoUrl) {
    const instances = [
        { hostname: 'co.wuk.sh', path: '/api/json' },
        { hostname: 'api.cobalt.tools', path: '/api/json' },
        { hostname: 'cobalt.q1.l5.ca', path: '/api/json' }
    ];

    for (const inst of instances) {
        try {
            const postData = JSON.stringify({ url: videoUrl, vCodec: 'h264', videoQuality: '720' });
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
                            if (json && (json.url || json.picker)) {
                                resolve(json.url || (json.picker && json.picker[0] ? json.picker[0].url : null));
                            } else {
                                resolve(null);
                            }
                        } catch (e) {
                            resolve(null);
                        }
                    });
                });
                req.on('error', () => resolve(null));
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
        const data = await httpsGetJson(instUrl);
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
        const data = await httpsGetJson(instUrl);
        if (data && data.formatStreams && data.formatStreams.length > 0) {
            // Prioritize itag 22 (720p combined MP4 H264/AAC) or itag 18 (360p combined MP4 H264/AAC)
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

    const hasBinary = fs.existsSync(ytDlpPath) || ytDlpPath === 'yt-dlp' || Boolean(process.env.YTDLP_PATH);

    // Fallback if binary is not present on environment
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

        setProgress(downloadId, { percent: 0, status: 'Failed', message: 'Unable to extract video stream.' });
        setTimeout(() => deleteProgress(downloadId), 5000);
        if (!res.headersSent) {
            return res.status(400).json({ success: false, message: 'Unable to extract video stream from link.' });
        }
    }

    // Instant Direct Stream Extraction via yt-dlp -g --get-title
    const extractArgs = [
        '--no-playlist',
        '--no-check-certificates',
        '-g',
        '--get-title',
        '-f', 'b/best',
        '--js-runtimes', 'node'
    ];
    if (ffmpegPath) {
        const ffmpegDir = fs.statSync(ffmpegPath).isDirectory() ? ffmpegPath : path.dirname(ffmpegPath);
        extractArgs.push('--ffmpeg-location', ffmpegDir);
    }
    if (fs.existsSync(cookiesPath)) {
        extractArgs.push('--cookies', cookiesPath);
    }
    extractArgs.push(url);

    execFile(ytDlpPath, extractArgs, async (error, stdout) => {
        let rawTitle = 'Tanzeel_Video';
        let directUrl = null;

        if (stdout) {
            const lines = stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
            const titleLine = lines.find(l => !l.startsWith('http') && !l.startsWith('WARNING:'));
            if (titleLine) rawTitle = titleLine;

            const httpLines = lines.filter(l => l.startsWith('http') && !l.includes('.m3u8'));
            if (httpLines.length > 0) {
                directUrl = httpLines[httpLines.length - 1];
            }
        }
        const safeTitle = sanitizeFilename(rawTitle);

        if (directUrl && directUrl.startsWith('http')) {
            return proxyVideoStream(directUrl, safeTitle, res, downloadId);
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
            return proxyVideoStream(streamUrl, safeTitle, res, downloadId);
        }

        // Fallback: Stream video directly from yt-dlp stdout to client response
        res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.header('Content-Type', 'video/mp4');
        setContentDispositionHeader(res, safeTitle, 'mp4');

        const dlArgs = [
            '--no-playlist', 
            '--no-check-certificates',
            '-f', '18/22/b/best', 
            '--js-runtimes', 'node',
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
        subprocess.stdout.pipe(res);

        subprocess.on('close', (code) => {
            if (downloadId) setProgress(downloadId, { percent: 100, status: 'Complete' });
            setTimeout(() => deleteProgress(downloadId), 5000);
        });

        subprocess.on('error', (err) => {
            console.error('yt-dlp spawn error:', err);
            if (!res.headersSent) res.status(500).send('Video stream error');
            if (downloadId) deleteProgress(downloadId);
        });
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;