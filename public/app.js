document.addEventListener('DOMContentLoaded', () => {
    const actionBtn = document.getElementById('action-btn');
    const resultsPanel = document.getElementById('results-panel');
    const optionsList = document.getElementById('options-list');
    const appStatus = document.getElementById('app-status');
    const linkInput = document.getElementById('link-input');

    let currentUrl = null;
    let isAnalyzed = false;

    const isValidUrl = (string) => {
        try {
            const url = new URL(string);
            return url.protocol === "http:" || url.protocol === "https:";
        } catch (_) {
            return false;  
        }
    };

    const getApiUrl = (endpoint) => {
        if (window.location.protocol === 'file:') {
            return `http://localhost:3000${endpoint}`;
        }
        if (window.API_BASE_URL && typeof window.API_BASE_URL === 'string') {
            return `${window.API_BASE_URL}${endpoint}`;
        }
        return endpoint;
    };

    const updateStatus = (text, color = "var(--text-muted)") => {
        appStatus.textContent = text;
        appStatus.style.color = color;
    };

    // Auto-detect link from clipboard if available
    if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(text => {
            if (text && isValidUrl(text.trim())) {
                linkInput.value = text.trim();
                updateStatus("Link detected! Click to download.", "var(--primary)");
            }
        }).catch(() => {});
    }

    // Real API Call with safe JSON parsing
    const analyzeLink = async (url) => {
        try {
            const response = await fetch(getApiUrl("/analyze"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ url })
            });
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                return await response.json();
            } else {
                const text = await response.text();
                console.warn("Non-JSON server response:", text);
                return { success: false, message: "Server temporary unavailable. Please try again." };
            }
        } catch (e) {
            console.error("Network request error:", e);
            return { success: false, message: "Network connection error." };
        }
    };

    let lastAnalyzedTitle = 'Tanzeel Video';

    const renderDownloadOptions = (videoTitle, downloadUrl) => {
        if (!resultsPanel || !optionsList) return;
        optionsList.innerHTML = `
            <a href="${downloadUrl}" download target="_blank" rel="noopener" class="download-option" style="display: flex; justify-content: space-between; align-items: center; padding: 1.2rem 1.5rem; background: #ffffff; border: 2px solid #10b981; border-radius: 16px; text-decoration: none; box-shadow: 0 10px 25px rgba(16,185,129,0.15); transition: transform 0.2s;">
                <div class="opt-details" style="text-align: left;">
                    <span class="opt-quality" style="font-size: 1.05rem; font-weight: 700; color: #0f172a;">📹 ${videoTitle || 'Download Video'}</span>
                    <span class="opt-size" style="font-size: 0.85rem; color: #10b981; font-weight: 600; margin-top: 4px; display: block;">⬇️ Click to save MP4 to Gallery / Downloads</span>
                </div>
                <div style="background: #10b981; color: white; padding: 10px 16px; border-radius: 12px; font-weight: 700; font-size: 0.9rem; white-space: nowrap;">SAVE MP4</div>
            </a>
        `;
        resultsPanel.classList.remove('hidden');
    };

    const performAnalysis = async (url) => {
        actionBtn.classList.add('loading');
        updateStatus("Analyzing link...", "var(--primary)");

        try {
            const result = await analyzeLink(url);
            console.log(result);
            if (result.success) {
                lastAnalyzedTitle = result.title || 'Tanzeel Video';
                updateStatus(`Platform: ${result.platform} | ${result.qualities[0].quality}`, "green");
                return true;
            } else {
                updateStatus(result.message || "Analysis failed.", "red");
                return false;
            }
        } catch (e) {
            console.error(e);
            updateStatus("Analysis failed.", "red");
            return false;
        } finally {
            actionBtn.classList.remove('loading');
        }
    };

    linkInput.addEventListener('input', () => {
        const text = linkInput.value.trim();
        if (isValidUrl(text)) {
            updateStatus("Ready to download. Click the button.", "var(--primary)");
        } else {
            updateStatus("Waiting for a valid link...", "var(--text-muted)");
        }
    });

    const copyTextToClipboard = async (text, btnElement) => {
        const originalText = btnElement.textContent;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed";
                textArea.style.opacity = "0";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            btnElement.textContent = 'COPIED!';
            setTimeout(() => btnElement.textContent = originalText, 2000);
        } catch (err) {
            console.error('Clipboard copy failed:', err);
            btnElement.textContent = 'COPIED!';
            setTimeout(() => btnElement.textContent = originalText, 2000);
        }
    };

    const triggerDownload = async (manualText) => {
        if (actionBtn.classList.contains('downloading')) return; 
        
        updateStatus("Downloading video to device...", "var(--primary)");
        actionBtn.classList.add('downloading');
        
        const fakeProgressText = document.getElementById('fake-progress-text');
        const progressContainer = document.getElementById('progress-container');
        const statPercent = document.getElementById('stat-percent');
        const statDownloaded = document.getElementById('stat-downloaded');
        const statTotal = document.getElementById('stat-total');
        const statRemaining = document.getElementById('stat-remaining');
        const statSpeed = document.getElementById('stat-speed');
        const statEta = document.getElementById('stat-eta');
        const downloadStats = document.getElementById('download-stats');
        const progressBarBg = document.getElementById('progress-bar-bg');
        const spinner = actionBtn.querySelector('.spinner');
        const btnIcon = actionBtn.querySelector('.btn-icon');
        
        if (btnIcon) btnIcon.style.display = 'none';
        fakeProgressText.style.display = 'block';
        fakeProgressText.textContent = '0%';
        progressContainer.style.display = 'none';
        statPercent.textContent = '0%';
        progressBarBg.style.width = '0%';
        downloadStats.textContent = 'Preparing download...';
        
        // Start analysis in the background
        const isSuccess = await performAnalysis(manualText);
        if (!isSuccess) {
            if (btnIcon) btnIcon.style.display = 'block';
            actionBtn.classList.remove('downloading');
            return;
        }
        
        currentUrl = manualText;

        let hasRealProgressStarted = false;
        let failedPolls = 0;
        
        const downloadId = Math.random().toString(36).substring(2, 10);
        const downloadUrl = getApiUrl(`/download?url=${encodeURIComponent(currentUrl)}&id=${downloadId}`);
        
        // Render prominent download card option in results panel
        renderDownloadOptions(lastAnalyzedTitle, downloadUrl);

        // Trigger browser file download via hidden iframe (prevents ERR_INVALID_RESPONSE screen crashes)
        let iframe = document.getElementById('download-frame');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'download-frame';
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
        }
        iframe.src = downloadUrl;

        let pollCount = 0;
        const maxPolls = 60; // 30 seconds max polling duration

        const resetBtnState = (statusText, statusColor) => {
            clearInterval(pollInterval);
            if (statusText) updateStatus(statusText, statusColor || "#059669");
            actionBtn.classList.remove('downloading');
            actionBtn.classList.remove('loading');
            progressContainer.style.display = 'none';
            fakeProgressText.style.display = 'none';
            spinner.style.display = 'none';
            if (btnIcon) btnIcon.style.display = 'block';
        };

        const pollInterval = setInterval(async () => {
            try {
                pollCount++;
                const res = await fetch(getApiUrl(`/progress?id=${downloadId}`));
                if (!res.ok) {
                    failedPolls++;
                } else {
                    const data = await res.json();
                    
                    if (!data.success) {
                        failedPolls++;
                        // If progress API returns false 6 times (3 seconds) without starting real progress,
                        // direct attachment stream or background download has dispatched to browser.
                        if (failedPolls >= 6 && !hasRealProgressStarted) {
                            return resetBtnState("Download dispatched! Check your Downloads folder.", "#059669");
                        }
                    } else if (data.success && data.data) {
                        failedPolls = 0;
                        const info = data.data;
                        if (info.status === 'Downloading...') {
                            if (!hasRealProgressStarted) {
                                hasRealProgressStarted = true;
                                fakeProgressText.style.display = 'none';
                                spinner.style.display = 'block';
                                progressContainer.style.display = 'block';
                            }
                            
                            statPercent.textContent = `${info.percent}%`;
                            progressBarBg.style.width = `${info.percent}%`;
                            
                            let totalVal = 0;
                            let unit = 'MB';
                            if (info.size && info.size !== '0MiB') {
                                totalVal = parseFloat(info.size);
                                unit = info.size.replace(/[\d\.]/g, '');
                                if (unit.toLowerCase() === 'mib') unit = 'MB';
                                if (unit.toLowerCase() === 'gib') unit = 'GB';
                            }
                            
                            if (!isNaN(totalVal) && totalVal > 0) {
                                const downloadedVal = (totalVal * (info.percent / 100)).toFixed(2);
                                const remainingVal = (totalVal - downloadedVal).toFixed(2);
                                
                                statDownloaded.textContent = `${downloadedVal} ${unit}`;
                                statTotal.textContent = `${totalVal.toFixed(2)} ${unit}`;
                                statRemaining.textContent = `${remainingVal} ${unit}`;
                            } else {
                                statDownloaded.textContent = '--';
                                statTotal.textContent = info.size || '--';
                                statRemaining.textContent = '--';
                            }
                            
                            statSpeed.textContent = info.speed.replace('MiB/s', 'MB/s');
                            statEta.textContent = info.eta;
                            downloadStats.textContent = `Downloading video...`;
                            updateStatus("Downloading video to device...", "var(--primary)");
                        } else if (info.status === 'Complete') {
                            hasRealProgressStarted = true;
                            statPercent.textContent = `100%`;
                            progressBarBg.style.width = `100%`;
                            downloadStats.textContent = "Download complete!";
                            updateStatus("Video downloaded successfully! Check your Downloads folder.", "#059669");
                            
                            setTimeout(() => {
                                resetBtnState("Video downloaded successfully! Check your Downloads folder.", "#059669");
                                downloadStats.textContent = '';
                            }, 3000);
                        } else if (info.status === 'Failed') {
                            resetBtnState(info.message || "Download failed. Please check your link.", "red");
                        }
                    }
                }

                if (pollCount >= maxPolls && !hasRealProgressStarted) {
                    resetBtnState("Download dispatched to browser. Check your Downloads folder.", "#059669");
                }
            } catch (e) {
                console.error('Polling error:', e);
                failedPolls++;
                if (failedPolls >= 6 && !hasRealProgressStarted) {
                    resetBtnState("Download dispatched to browser. Check your Downloads folder.", "#059669");
                }
            }
        }, 500);
    };

    actionBtn.addEventListener('click', () => {
        if (actionBtn.classList.contains('loading') || actionBtn.classList.contains('downloading')) {
            return;
        }

        const manualText = linkInput.value.trim();
        if (isValidUrl(manualText)) {
            triggerDownload(manualText);
        } else {
            updateStatus("Please paste a valid link first.", "red");
        }
    });

    // Support Modal Logic
    const favoriteBtn = document.getElementById('favorite-btn');
    const supportModal = document.getElementById('support-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const copyEmailBtn = document.getElementById('copy-email-btn');
    const copyRaastBtn = document.getElementById('copy-raast-btn');

    if (favoriteBtn && supportModal) {
        favoriteBtn.addEventListener('click', () => {
            supportModal.style.display = 'flex';
        });

        closeModalBtn.addEventListener('click', () => {
            supportModal.style.display = 'none';
        });

        supportModal.addEventListener('click', (e) => {
            if (e.target === supportModal) {
                supportModal.style.display = 'none';
            }
        });

        copyEmailBtn.addEventListener('click', () => {
            copyTextToClipboard('kaleemullahzahid2772@gmail.com', copyEmailBtn);
        });

        copyRaastBtn.addEventListener('click', () => {
            copyTextToClipboard('03274816872', copyRaastBtn);
        });
    }
});
