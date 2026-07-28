const rateLimitMap = new Map();

function rateLimiter(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000;
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

setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimitMap.entries()) {
        if (now - record.startTime > 60 * 1000) {
            rateLimitMap.delete(ip);
        }
    }
}, 5 * 60 * 1000).unref();

module.exports = rateLimiter;
