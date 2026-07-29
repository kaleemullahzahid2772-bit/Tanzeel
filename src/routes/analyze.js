const { httpsGetJson } = require('../utils/validate');
const { isValidPublicUrl } = require('../utils/validate');
const { normalizeYouTubeUrl } = require('../utils/url');
const ytdlp = require('../services/ytdlp');

function createAnalyzeRouter(projectRoot) {
    const express = require('express');
    const router = express.Router();

    async function fallbackAnalyze(url) {
        let platform = 'Video Platform';
        const lowerUrl = (url || '').toLowerCase();
        if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) platform = 'YouTube';
        else if (lowerUrl.includes('tiktok.com')) platform = 'TikTok';
        else if (lowerUrl.includes('instagram.com')) platform = 'Instagram';
        else if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.watch')) platform = 'Facebook';
        else if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) platform = 'Twitter / X';
        else if (lowerUrl.includes('pinterest.com')) platform = 'Pinterest';

        if (platform === 'YouTube') {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
            const data = await httpsGetJson(oembedUrl, 3000);
            if (data && data.title) {
                return {
                    success: true,
                    platform: 'YouTube',
                    title: data.title,
                    qualities: [{ quality: 'Auto (Best available)' }]
                };
            }
        }

        return {
            success: true,
            platform,
            title: `${platform} Video`,
            qualities: [{ quality: 'Auto (Best available)' }]
        };
    }

    router.post(['/analyze', '/api/analyze'], async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            let rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
            if (rawUrl.includes('%3A') || rawUrl.includes('%2F')) {
                try { rawUrl = decodeURIComponent(rawUrl); } catch (e) {}
            }
            const url = normalizeYouTubeUrl(rawUrl);

            if (!isValidPublicUrl(url)) {
                return res.status(400).json({ success: false, message: 'Invalid URL provided' });
            }

            let hasBinary = ytdlp.isBinaryAvailable(projectRoot);
            if (!hasBinary) {
                await ytdlp.downloadBinaryIfNeeded(projectRoot);
                hasBinary = ytdlp.isBinaryAvailable(projectRoot);
            }

            if (!hasBinary) {
                const fallbackResult = await fallbackAnalyze(url);
                return res.status(200).json(fallbackResult);
            }

            const result = await ytdlp.extractWithAnalyze(url, projectRoot);
            if (result) {
                return res.status(200).json(result);
            }

            const fallbackResult = await fallbackAnalyze(url);
            return res.status(200).json(fallbackResult);
        } catch (err) {
            return res.status(200).json({
                success: true,
                platform: 'Video Platform',
                title: 'Video Stream',
                qualities: [{ quality: 'Auto (Best available)' }]
            });
        }
    });

    return router;
}

module.exports = createAnalyzeRouter;
