function jsonErrorHandler(err, req, res, next) {
    if (err && (err instanceof SyntaxError || err.status === 400)) {
        return res.status(400).json({ success: false, message: 'Invalid JSON request payload' });
    }
    next(err);
}

function globalErrorHandler(err, req, res, next) {
    if (!res.headersSent) {
        res.status(400).json({
            success: false,
            message: 'An unexpected request error occurred.'
        });
    }
}

module.exports = { jsonErrorHandler, globalErrorHandler };
