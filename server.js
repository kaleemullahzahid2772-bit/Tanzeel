const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const path = require('path');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs');

const progressMap = {};

const app = express();
const PORT = process.env.PORT || 3000;
const isWin = process.platform === 'win32';
const defaultYtDlp = isWin ? path.join(__dirname, 'downloader.exe') : 'yt-dlp';
const ytDlpPath = process.env.YTDLP_PATH || (fs.existsSync(defaultYtDlp) ? defaultYtDlp : 'yt-dlp');
const cookiesPath = path.join(__dirname, 'cookies.txt');
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
}

app.use(cors());
app.use(express.json());

// Serve static files exclusively from public/ directory for security
app.use(express.static(path.join(__dirname, 'public')));

// Explicit root route handler for Vercel and serverless deployments
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle favicon.ico to prevent 404 browser log errors
app.get('/favicon.ico', (req, res) => {
    const iconPath = path.join(__dirname, 'public', 'favicon.ico');
    if (fs.existsSync(iconPath)) {
        res.sendFile(iconPath);
    } else {
        res.status(204).end();
    }
});

async function fallbackAnalyze(url) {
    try {
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
            const response = await fetch(oembedUrl);
            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    platform: 'YouTube',
                    title: data.title || 'YouTube Video',
                    qualities: [{ quality: 'Auto (Best available)' }]
                };
            }
        }
    } catch (e) {
        console.error('Fallback analyze error:', e);
    }
    return {
        success: true,
        platform: 'Video Platform',
        title: 'Video Stream',
        qualities: [{ quality: 'Auto (Best available)' }]
    };
}

app.post('/analyze', async (req, res) => {
    const { url } = req.body;
    
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ success: false, message: 'Invalid URL provided' });
    }

    const args = ['--no-playlist', '--dump-json', '--js-runtimes', 'node'];
    if (fs.existsSync(cookiesPath)) {
        args.push('--cookies', cookiesPath);
    }
    args.push(url);
    
    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout, stderr) => {
        if (error) {
            console.warn('yt-dlp execFile failed, using lightweight fallback:', stderr || error.message);
            if (stderr && stderr.includes('Please sign in')) {
                return res.status(400).json({ success: false, message: 'This video is age-restricted or private.' });
            }
            const fallbackResult = await fallbackAnalyze(url);
            return res.json(fallbackResult);
        }
        try {
            const info = JSON.parse(stdout);
            res.json({
                success: true,
                platform: info.extractor ? (info.extractor.charAt(0).toUpperCase() + info.extractor.slice(1)) : 'Video Platform',
                title: info.title || 'Video',
                qualities: [{ quality: 'Auto (Best available)' }]
            });
        } catch (e) {
            const fallbackResult = await fallbackAnalyze(url);
            res.json(fallbackResult);
        }
    });
});

app.get('/progress', (req, res) => {
    const { id } = req.query;
    if (id && progressMap[id]) {
        res.json({ success: true, data: progressMap[id] });
    } else {
        res.json({ success: false });
    }
});

app.get('/download', (req, res) => {
    const { url, id } = req.query;
    
    if (!url || typeof url !== 'string') {
        return res.status(400).send('Invalid URL provided');
    }

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
        const downloadId = id || Math.random().toString(36).substring(2, 10);
        const tempFilePath = path.join(downloadsDir, `dl_${downloadId}.mp4`);

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

        progressMap[downloadId] = { percent: 0, size: '0MiB', status: 'Starting...' };

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