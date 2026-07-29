process.env.YTDL_NO_UPDATE = 'true';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const securityHeaders = require('./middleware/security');
const { rateLimiter, progressRateLimiter } = require('./middleware/rateLimit');
const { jsonErrorHandler, globalErrorHandler } = require('./middleware/errorHandler');
const ytdlp = require('./services/ytdlp');
const log = require('./utils/logger');

const createAnalyzeRouter = require('./routes/analyze');
const createDownloadRouter = require('./routes/download');
const progressRouter = require('./routes/progress');

const PROJECT_ROOT = path.join(__dirname, '..');

// Initialize services
ytdlp.init(PROJECT_ROOT);
ytdlp.downloadBinaryIfNeeded(PROJECT_ROOT).catch(() => {});

// Startup validation
const publicDir = path.join(PROJECT_ROOT, 'public');
const requiredFiles = ['index.html', 'app.js', 'style.css', 'manifest.json', 'sw.js'];
for (const f of requiredFiles) {
    if (!fs.existsSync(path.join(publicDir, f))) {
        log.warn(`Missing public file: ${f}`);
    }
}

// Create Express app
const app = express();
app.disable('x-powered-by');

const PORT = process.env.PORT || 3000;

// CORS
const allowedOrigins = [
    'https://tanzeel.vercel.app',
    'https://tanzeel.pro',
    'https://tanzeel.onrender.com',
    'https://tanzeel-api.up.railway.app',
    'http://localhost:3000',
    'http://localhost:5173'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

// Body parser
app.use(express.json());

// Middleware
app.use(securityHeaders);
app.use(jsonErrorHandler);

// Health check
app.get(['/health', '/api/health'], (req, res) => {
        let version = '1.2.0';
    try {
        const pkg = require(path.join(PROJECT_ROOT, 'package.json'));
        version = pkg.version || version;
    } catch (e) {}
    res.json({
        status: 'ok',
        version,
        uptime: Math.floor(process.uptime()),
        memory: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        timestamp: new Date().toISOString()
    });
});

// Favicon
app.get('/favicon.ico', (req, res) => {
    const iconPath = path.join(PROJECT_ROOT, 'public', 'favicon.ico');
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

// Static files
app.use(express.static(path.join(PROJECT_ROOT, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

// Root route
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const indexPath = path.join(PROJECT_ROOT, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath, (err) => {
            if (err && !res.headersSent) {
                res.status(404).send('Index file not found');
            }
        });
    }
    res.status(404).send('Index file not found');
});

// API Routes
app.use(rateLimiter);
app.use(createAnalyzeRouter(PROJECT_ROOT));
app.use(progressRateLimiter);
app.use(progressRouter);
app.use(createDownloadRouter(PROJECT_ROOT));

// Global error handler
app.use(globalErrorHandler);

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        log.info(`Tanzeel server running on http://localhost:${PORT}`);
        log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        log.info(`Node: ${process.version}`);
    });
}

module.exports = app;
