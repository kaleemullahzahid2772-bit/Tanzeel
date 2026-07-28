const path = require('path');
const fs = require('fs');
const os = require('os');

function getCookiesPath(projectRoot) {
    if (process.env.YOUTUBE_COOKIES) {
        const tmpCookies = path.join(os.tmpdir(), 'tanzeel_env_cookies.txt');
        try {
            fs.writeFileSync(tmpCookies, process.env.YOUTUBE_COOKIES, 'utf-8');
            return tmpCookies;
        } catch (e) {}
    }
    const localCookies = path.join(projectRoot, 'cookies.txt');
    if (fs.existsSync(localCookies)) {
        return localCookies;
    }
    const tmpCookies = path.join(os.tmpdir(), 'cookies.txt');
    if (fs.existsSync(tmpCookies)) {
        return tmpCookies;
    }
    return null;
}

module.exports = { getCookiesPath };
