const generalMap = new Map();
const progressMap = new Map();

function createLimiter(map, maxRequests, windowMs = 60 * 1000) {
    return (req, res, next) => {
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const now = Date.now();

        let record = map.get(ip);
        if (!record || now - record.startTime > windowMs) {
            record = { count: 1, startTime: now };
        } else {
            record.count++;
        }
        map.set(ip, record);

        if (record.count > maxRequests) {
            return res.status(429).json({
                success: false,
                error: 'RATE_LIMIT_EXCEEDED',
                message: 'Too many requests. Please wait a minute before trying again.'
            });
        }
        next();
    };
}

function cleanup(map) {
    const now = Date.now();
    for (const [ip, record] of map.entries()) {
        if (now - record.startTime > 60 * 1000) {
            map.delete(ip);
        }
    }
}

const rateLimiter = createLimiter(generalMap, 40);
const progressRateLimiter = createLimiter(progressMap, 600);

setInterval(() => {
    cleanup(generalMap);
    cleanup(progressMap);
}, 5 * 60 * 1000).unref();

module.exports = { rateLimiter, progressRateLimiter };