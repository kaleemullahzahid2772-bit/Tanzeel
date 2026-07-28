const progressMap = new Map();

function cleanStaleProgress() {
    const now = Date.now();
    for (const [id, data] of progressMap.entries()) {
        if (data.updatedAt && (now - data.updatedAt > 10 * 60 * 1000)) {
            progressMap.delete(id);
        }
    }
}

setInterval(cleanStaleProgress, 5 * 60 * 1000).unref();

function setProgress(id, data) {
    if (!id || typeof id !== 'string') return;
    progressMap.set(id, { ...data, updatedAt: Date.now() });
}

function getProgress(id) {
    if (!id || typeof id !== 'string') return null;
    return progressMap.get(id) || null;
}

function deleteProgress(id) {
    if (!id || typeof id !== 'string') return;
    progressMap.delete(id);
}

module.exports = { setProgress, getProgress, deleteProgress };
