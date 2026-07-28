const app = require('./src/server');
const log = require('./src/utils/logger');

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    app.listen(PORT, () => {
        log.info(`Tanzeel server running on http://localhost:${PORT}`);
        log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        log.info(`Node: ${process.version}`);
    });
}

module.exports = app;

