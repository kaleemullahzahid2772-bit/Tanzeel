const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] || 1;

function log(level, msg, meta = {}) {
    if (LEVELS[level] < currentLevel) return;
    const ts = new Date().toISOString();
    const color = COLORS[level] || '';
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    console.log(`${color}[${ts}] ${level.toUpperCase()}: ${msg}${metaStr}${RESET}`);
}

module.exports = {
    debug: (msg, meta) => log('debug', msg, meta),
    info:  (msg, meta) => log('info', msg, meta),
    warn:  (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
};
