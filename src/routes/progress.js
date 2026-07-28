const { getProgress } = require('../utils/progress');

const progressRouter = require('express').Router();

progressRouter.get(['/progress', '/api/progress'], (req, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id : null;
    const data = getProgress(id);
    if (data) {
        res.json({ success: true, data });
    } else {
        res.json({ success: false });
    }
});

module.exports = progressRouter;
