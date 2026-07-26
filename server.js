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

app.use(cors());
app.use(express.json());

// Serve static files exclusively from public/ directory for security
app.use(express.static(path.join(__dirname, 'public')));

app.post('/analyze', (req, res) => {
    const { url } = req.body;
    
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ success: false, message: 'Invalid URL provided' });
    }

    const args = ['--no-playlist', '--dump-json', '--js-runtimes', 'node'];
    if (fs.existsSync(cookiesPath)) {
        args.push('--cookies', cookiesPath);
    }
    args.push(url);
    
    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
            console.error('Analyze error:', stderr || error.message);
            if (stderr && stderr.includes('Please sign in')) {
                return res.status(400).json({ success: false, message: 'This video is age-restricted or private. Please update cookies.txt with a logged-in account.' });
            }
            return res.status(500).json({ success: false, message: 'Failed to analyze video' });
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
            res.status(500).json({ success: false, message: 'Failed to parse video data' });
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

        res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.header('Pragma', 'no-cache');
        res.header('Expires', '0');
        res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.mkv"`);
        
        const dlArgs = [
            '--no-playlist', 
            '-S', 'vcodec:h264,res,acodec:m4a', 
            '-f', 'bestvideo+bestaudio/best', 
            '--merge-output-format', 'mkv', 
            '--ffmpeg-location', ffmpeg, 
            '--js-runtimes', 'node'
        ];
        if (fs.existsSync(cookiesPath)) {
            dlArgs.push('--cookies', cookiesPath);
        }
        dlArgs.push('-o', '-', url);

        const subprocess = spawn(ytDlpPath, dlArgs);
        
        subprocess.stdout.pipe(res);
        
        if (id) {
            progressMap[id] = { percent: 0, size: '0MiB', status: 'Starting...' };
        }
        
        // Clean up process if user cancels HTTP request mid-way
        req.on('close', () => {
            if (subprocess && !subprocess.killed) {
                subprocess.kill('SIGTERM');
            }
            if (id) {
                delete progressMap[id];
            }
        });

        subprocess.stderr.on('data', (data) => {
            const output = data.toString();
            if (id) {
                const match = output.match(/\[download\]\s+([\d\.]+)%\s+of\s+~?\s*([\d\.]+[a-zA-Z]+)(?:\s+at\s+([^\s]+)\s+ETA\s+([^\s]+))?/);
                if (match) {
                    progressMap[id] = { 
                        percent: parseFloat(match[1]), 
                        size: match[2], 
                        speed: match[3] || 'Calculating...',
                        eta: match[4] || 'Calculating...',
                        status: 'Downloading...' 
                    };
                }
            }
        });

        subprocess.on('close', (code) => {
            if (id) {
                progressMap[id] = { percent: 100, size: progressMap[id]?.size || 'Done', status: 'Complete' };
                setTimeout(() => delete progressMap[id], 10000); // clear after 10s
            }
            if (code !== 0 && !res.headersSent) {
                res.status(500).send('Failed to download video');
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