const path = require('path');
const fs = require('fs');
const os = require('os');

const isWin = os.platform() === 'win32';
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

const projectRoot = path.join(__dirname, '..');
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
    const envPath = process.env.YTDLP_PATH;
    try {
        const testExec = require('child_process');
        if (isWin) {
            testExec.spawnSync('cmd', ['/c', envPath], { stdio: 'pipe' });
        } else {
            testExec.spawnSync('./' + path.basename(envPath), ['--version'], { stdio: 'pipe' });
        }
        ytDlpPath = envPath;
        return true;
    } catch (e) {
        console.log('YTDLP_PATH from env is not valid:', envPath);
    }
}

console.error('yt-dlp binary not available for', os.platform());
return false;
