function sanitizeFilename(title) {
    if (!title || typeof title !== 'string') return 'Tanzeel_Video';
    const cleaned = title.trim().replace(/[\/\\:\*\?"<>\|\x00-\x1F]/g, '').replace(/\s+/g, '_');
    return cleaned || 'Tanzeel_Video';
}

function setContentDispositionHeader(res, title, ext = 'mp4') {
    const safeTitle = sanitizeFilename(title);
    const asciiTitle = safeTitle.replace(/[^\x20-\x7E]/g, '_');
    const encodedTitle = encodeURIComponent(safeTitle);
    res.header('Content-Disposition', `attachment; filename="${asciiTitle}.${ext}"; filename*=UTF-8''${encodedTitle}.${ext}`);
}

module.exports = { sanitizeFilename, setContentDispositionHeader };
