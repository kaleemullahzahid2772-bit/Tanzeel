const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { URL } = require('url');
const { getCookiesPath } = require('../utils/cookies');
const { isValidPublicUrl } = require('../utils/validate');
const { setProgress, deleteProgress } = require('../utils/progress');
const { sanitizeFilename, setContentDispositionHeader } = require('../utils/filename');

let ytDlpPath = null;
let ytdlCore = null;
let downloadPromise = null;

function init(projectRoot) {
    const isWin = process.platform === 'win32';
    const winBinary = path.join(projectRoot, 'downloader.exe');
    const linuxBinary = path.join(projectRoot, 'yt-dlp');

    ytDlpPath = process.env.YTDLP_PATH;
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

    try {
        ytdlCore = require('@distube/ytdl-core');
    } catch (e) {}
}

function getBinaryPath() {
    return ytDlpPath;
}

function isBinaryAvailable(projectRoot) {
    const isWin = process.platform === 'win32';
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

    const localBinary = path.join(projectRoot, targetName);
    if (fs.existsSync(localBinary)) {
        if (!isWin) {
            try {
                fs.chmodSync(localBinary, '755');
                ytDlpPath = localBinary;
                return true;
            } catch (chmodErr) {
                try {
                    fs.copyFileSync(localBinary, tmpPath);
                    fs.chmodSync(tmpPath, '755');
                    ytDlpPath = tmpPath;
                    return true;
                } catch (copyErr) {}
            }
        } else {
            ytDlpPath = localBinary;
            return true;
        }
    }

    if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
        ytDlpPath = process.env.YTDLP_PATH;
        return true;
    }

    return false;
}

function downloadBinaryIfNeeded(projectRoot) {
    if (isBinaryAvailable(projectRoot)) {
        return Promise.resolve(ytDlpPath);
    }
    if (downloadPromise) {
        return downloadPromise;
    }

    const isWin = process.platform === 'win32';

    downloadPromise = new Promise((resolve) => {
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
                    return resolve(ytDlpPath);
                }
            } catch (e) {}
        }

        const localBinary = path.join(projectRoot, targetName);
        if (fs.existsSync(localBinary)) {
            try {
                fs.copyFileSync(localBinary, tmpPath);
                if (!isWin) fs.chmodSync(tmpPath, '755');
                ytDlpPath = tmpPath;
                return resolve(ytDlpPath);
            } catch (e) {}
        }

        console.log('yt-dlp binary missing on server. Auto-downloading standalone binary to:', tmpPath);
        const downloadUrl = isWin
            ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
            : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

        function fetchFile(url, dest, attempts = 0) {
            if (attempts > 5) {
                downloadPromise = null;
                return resolve(null);
            }
            const parsedUrl = new URL(url);
            const reqOpts = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 443,
                path: parsedUrl.pathname + parsedUrl.search,
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
                    downloadPromise = null;
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
                            resolve(ytDlpPath);
                        } catch (err) {
                            resolve(null);
                        } finally {
                            downloadPromise = null;
                        }
                    });
                });
                fileStream.on('error', () => {
                    downloadPromise = null;
                    resolve(null);
                });
            }).on('error', () => {
                downloadPromise = null;
                resolve(null);
            });
        }

        fetchFile(downloadUrl, tmpPath);
    });

    return downloadPromise;
}

async function getYtdlCoreStreamUrl(videoUrl, projectRoot) {
    if (!ytdlCore) return null;
    try {
        let options = {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        };

        const cookiesFile = getCookiesPath(projectRoot);
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
            } catch (cookieErr) {}
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
    } catch (e) {}
    return null;
}

function proxyVideoStream(streamUrl, safeTitle, res, downloadId, ffmpegPath, redirectCount = 0) {
    const http = require('http');
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
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*'
            };
            if (!parsedUrl.hostname.includes('googlevideo.com')) {
                headers['Referer'] = 'https://www.youtube.com/';
            }

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
                path: parsedUrl.pathname + parsedUrl.search,
                headers: headers
            };

            const clientReq = httpLib.get(options, (videoRes) => {
                if ([301, 302, 307, 308].includes(videoRes.statusCode)) {
                    const redirectUrl = videoRes.headers.location;
                    if (redirectUrl) {
                        videoRes.resume();
                        return resolve(proxyVideoStream(redirectUrl, safeTitle, res, downloadId, ffmpegPath, redirectCount + 1));
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

async function extractWithBinary(url, projectRoot, ffmpegPath) {
    const isWin = process.platform === 'win32';
    const { execFile } = require('child_process');

    const extractArgs = [
        '--no-playlist',
        '--no-warnings',
        '--ignore-errors',
        '--extractor-args', 'youtube:player_client=tv_embedded;player_skip=web,mweb,ios,android',
        '-g',
        '--get-title',
        '-f', '18/22/b/best[ext=mp4]/best'
    ];
    if (ffmpegPath) {
        try {
            const ffmpegDir = fs.statSync(ffmpegPath).isDirectory() ? ffmpegPath : path.dirname(ffmpegPath);
            extractArgs.push('--ffmpeg-location', ffmpegDir);
        } catch (e) {}
    }
    const cookiesFile = getCookiesPath(projectRoot);
    if (cookiesFile && fs.existsSync(cookiesFile)) {
        extractArgs.push('--cookies', cookiesFile);
    }
    extractArgs.push(url);

    return new Promise((resolve) => {
        execFile(ytDlpPath, extractArgs, { timeout: 30000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
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
}

async function extractWithAnalyze(url, projectRoot) {
    const args = [
        '--no-playlist',
        '--extractor-args', 'youtube:player_client=tv_embedded;player_skip=web,mweb,ios,android',
        '--dump-json'
    ];
    const cookiesFile = getCookiesPath(projectRoot);
    if (cookiesFile && fs.existsSync(cookiesFile)) {
        args.push('--cookies', cookiesFile);
    }
    args.push(url);

    return new Promise((resolve) => {
        execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error || !stdout) return resolve(null);
            try {
                const info = JSON.parse(stdout);
                return resolve({
                    success: true,
                    platform: info.extractor ? (info.extractor.charAt(0).toUpperCase() + info.extractor.slice(1)) : 'Video Platform',
                    title: info.title || 'Video',
                    qualities: [{ quality: 'Auto (Best available)' }]
                });
            } catch (e) {
                return resolve(null);
            }
        });
    });
}

module.exports = {
    init,
    getBinaryPath,
    isBinaryAvailable,
    downloadBinaryIfNeeded,
    getYtdlCoreStreamUrl,
    proxyVideoStream,
    extractWithBinary,
    extractWithAnalyze
};
