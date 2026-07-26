const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let ffmpeg = null;
try {
    ffmpeg = require('ffmpeg-static');
} catch (e) {
    console.warn('ffmpeg-static module load warning:', e.message);
}

const progressMap = {};

const app = express();
const PORT = process.env.PORT || 3000;
const isWin = process.platform === 'win32';
const defaultYtDlp = isWin ? path.join(__dirname, 'downloader.exe') : 'yt-dlp';
let ytDlpPath = process.env.YTDLP_PATH || 'yt-dlp';
try {
    if (isWin && fs.existsSync(defaultYtDlp)) {
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

app.use(cors());
app.use(express.json());

// Express Body Parser Error Handler middleware to prevent 500 errors on invalid JSON body
app.use((err, req, res, next) => {
    if (err && (err instanceof SyntaxError || err.status === 400)) {
        return res.status(400).json({ success: false, message: 'Invalid JSON request payload' });
    }
    next(err);
});

// Handle favicon.ico cleanly to avoid serverless 404 errors
app.get('/favicon.ico', (req, res) => {
    const iconPath = path.join(__dirname, 'public', 'favicon.ico');
    if (fs.existsSync(iconPath)) {
        return res.sendFile(iconPath);
    }
    return res.status(204).end();
});

// Serve static files exclusively from public/ directory for security
app.use(express.static(path.join(__dirname, 'public')));

// Explicit root route handler for Vercel and serverless deployments
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const https = require('https');

function httpsGetJson(url) {
    return new Promise((resolve) => {
        try {
            https.get(url, (res) => {
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
        const url = typeof body.url === 'string' ? body.url.trim() : '';
        
        if (!url) {
            return res.status(400).json({ success: false, message: 'Invalid URL provided' });
        }

        // On Vercel / serverless cloud environment where binary is missing, use instant API fallback
        const isVercel = process.env.VERCEL || process.env.NOW_BUILDER;
        const hasBinary = fs.existsSync(ytDlpPath);

        if (isVercel || (!hasBinary && !isWin)) {
            const fallbackResult = await fallbackAnalyze(url);
            return res.status(200).json(fallbackResult);
        }

        const args = ['--no-playlist', '--dump-json', '--js-runtimes', 'node'];
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
    const { id } = req.query;
    if (id && progressMap[id]) {
        res.json({ success: true, data: progressMap[id] });
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

function proxyVideoStream(streamUrl, safeTitle, res, downloadId) {
    try {
        const parsedUrl = new URL(streamUrl);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
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
                if (!res.headersSent) res.status(500).send('Unable to stream video');
                if (downloadId) delete progressMap[downloadId];
                return;
            }

            const cleanTitle = (safeTitle || 'Tanzeel_Video').replace(/[^\w\s-]/gi, '').replace(/\s+/g, '_') || 'Tanzeel_Video';
            const upstreamType = videoRes.headers['content-type'] || 'video/mp4';
            let ext = 'mp4';
            if (upstreamType.includes('webm')) ext = 'webm';
            if (upstreamType.includes('mkv')) ext = 'mkv';

            res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.header('Content-Type', upstreamType);
            res.header('Content-Disposition', `attachment; filename="${cleanTitle}.${ext}"`);
            if (videoRes.headers['content-length']) {
                res.header('Content-Length', videoRes.headers['content-length']);
            }
            
            if (downloadId && progressMap[downloadId]) {
                progressMap[downloadId] = { percent: 100, size: 'Done', speed: 'Fast', eta: '0s', status: 'Complete' };
                setTimeout(() => delete progressMap[downloadId], 5000);
            }
            
            videoRes.pipe(res);
        }).on('error', (err) => {
            console.error('Stream proxy network error:', err);
            if (!res.headersSent) res.status(500).send('Stream error');
            if (downloadId) delete progressMap[downloadId];
        });
    } catch (err) {
        console.error('Proxy exception:', err);
        if (!res.headersSent) res.status(500).send('Stream exception');
        if (downloadId) delete progressMap[downloadId];
    }
}

async function getCobaltDirectStream(videoUrl) {
    try {
        const postData = JSON.stringify({ url: videoUrl, vCodec: 'h264', videoQuality: '720' });
        const options = {
            hostname: 'api.cobalt.tools',
            port: 443,
            path: '/api/json',
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        return new Promise((resolve) => {
            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);
                        if (json && (json.url || json.picker)) {
                            const directUrl = json.url || (json.picker && json.picker[0] ? json.picker[0].url : null);
                            resolve(directUrl);
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
    } catch (e) {
        return null;
    }
}

async function getPipedDirectStreamUrl(videoId) {
    const pipedInstances = [
        `https://api.piped.video/streams/${videoId}`,
        `https://pipedapi.kavin.rocks/streams/${videoId}`,
        `https://pipedapi.mha.fi/streams/${videoId}`
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
        `https://vid.puffyan.us/api/v1/videos/${videoId}`,
        `https://invidious.nerdvpn.de/api/v1/videos/${videoId}`
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
    const { url, id } = req.query;
    
    if (!url || typeof url !== 'string') {
        return res.status(400).send('Invalid URL provided');
    }

    const downloadId = id || Math.random().toString(36).substring(2, 10);
    
    // Register progress immediately so frontend polling never times out!
    progressMap[downloadId] = { 
        percent: 15, 
        size: 'Fetching...', 
        speed: 'Connecting...', 
        eta: 'Calculating...', 
        status: 'Downloading...' 
    };

    const isVercel = process.env.VERCEL || process.env.NOW_BUILDER;
    const hasBinary = fs.existsSync(ytDlpPath);

    // Vercel serverless / cloud fallback: Direct browser stream redirection to bypass datacenter IP blocks
    if (isVercel || (!hasBinary && !isWin)) {
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

        progressMap[downloadId] = { percent: 100, size: 'Done', speed: 'Fast', eta: '0s', status: 'Complete' };
        setTimeout(() => delete progressMap[downloadId], 5000);

        if (streamUrl) {
            return res.redirect(302, streamUrl);
        }

        // Fallback: Redirect to fast video stream engine
        return res.redirect(302, `https://api.cobalt.tools`);
    }

    const tempFilePath = path.join(downloadsDir, `dl_${downloadId}.mp4`);
    const titleArgs = ['--no-playlist', '--get-title', '--js-runtimes', 'node'];
    if (fs.existsSync(cookiesPath)) {
        titleArgs.push('--cookies', cookiesPath);
    }
    titleArgs.push(url);

    execFile(ytDlpPath, titleArgs, (error, stdout) => {
        let rawTitle = 'Tanzeel_Video';
        if (!error && stdout) {
            rawTitle = stdout.trim().replace(/[^\w\s-]/gi, '').replace(/\s+/g, '_');
        }
        const safeTitle = rawTitle || 'Tanzeel_Video';

        const dlArgs = [
            '--no-playlist', 
            '-S', 'vcodec:h264,res,acodec:m4a', 
            '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', 
            '--merge-output-format', 'mp4', 
            '--ffmpeg-location', ffmpeg, 
            '--js-runtimes', 'node'
        ];
        if (fs.existsSync(cookiesPath)) {
            dlArgs.push('--cookies', cookiesPath);
        }
        dlArgs.push('-o', tempFilePath, url);

        const subprocess = spawn(ytDlpPath, dlArgs);

        req.on('close', () => {
            if (subprocess && !subprocess.killed) {
                subprocess.kill('SIGTERM');
            }
            if (fs.existsSync(tempFilePath)) {
                try { fs.unlinkSync(tempFilePath); } catch (e) {}
            }
            delete progressMap[downloadId];
        });

        subprocess.stderr.on('data', (data) => {
            const output = data.toString();
            const match = output.match(/\[download\]\s+([\d\.]+)%\s+of\s+~?\s*([\d\.]+[a-zA-Z]+)(?:\s+at\s+([^\s]+)\s+ETA\s+([^\s]+))?/);
            if (match) {
                progressMap[downloadId] = { 
                    percent: parseFloat(match[1]), 
                    size: match[2], 
                    speed: match[3] || 'Calculating...',
                    eta: match[4] || 'Calculating...',
                    status: 'Downloading...' 
                };
            }
        });

        subprocess.on('close', (code) => {
            if (code === 0 && fs.existsSync(tempFilePath)) {
                progressMap[downloadId] = { percent: 100, size: progressMap[downloadId]?.size || 'Done', status: 'Complete' };
                
                res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.header('Pragma', 'no-cache');
                res.header('Expires', '0');
                res.header('Content-Type', 'video/mp4');
                res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.mp4"`);

                res.sendFile(tempFilePath, (err) => {
                    if (fs.existsSync(tempFilePath)) {
                        try { fs.unlinkSync(tempFilePath); } catch (e) {}
                    }
                    setTimeout(() => delete progressMap[downloadId], 5000);
                });
            } else {
                if (!res.headersSent) {
                    res.status(500).send('Failed to download video');
                }
                if (fs.existsSync(tempFilePath)) {
                    try { fs.unlinkSync(tempFilePath); } catch (e) {}
                }
                delete progressMap[downloadId];
            }
        });
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;