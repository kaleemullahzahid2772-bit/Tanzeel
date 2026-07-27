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

    const performAnalysis = async (url) => {
        actionBtn.classList.add('loading');
        updateStatus("Analyzing link...", "var(--primary)");

        try {
            const result = await analyzeLink(url);
            console.log(result);
            if (result.success) {
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
        
        updateStatus("Downloading to gallery...", "var(--primary)");
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
        
        let fakeProgress = 0;
        const fakeProgressInterval = setInterval(() => {
            if (fakeProgress < 90) {
                fakeProgress += Math.floor(Math.random() * 10) + 5;
                if (fakeProgress > 90) fakeProgress = 90;
                fakeProgressText.textContent = `${fakeProgress}%`;
            }
        }, 100);
        
        // Start analysis in the background
        const isSuccess = await performAnalysis(manualText);
        if (!isSuccess) {
            clearInterval(fakeProgressInterval);
            fakeProgressText.style.display = 'none';
            if (btnIcon) btnIcon.style.display = 'block';
            actionBtn.classList.remove('downloading');
            return;
        }
        
        currentUrl = manualText;
        fakeProgress = 100;
        fakeProgressText.textContent = '100%';
        clearInterval(fakeProgressInterval);

        let hasRealProgressStarted = false;
        let failedPolls = 0;
        
        const downloadId = Math.random().toString(36).substring(2, 10);
        const downloadUrl = getApiUrl(`/download?url=${encodeURIComponent(currentUrl)}&id=${downloadId}`);
        
        // Trigger download using hidden iframe to prevent page navigation or reload glitches
        let downloadIframe = document.getElementById('hidden-download-iframe');
        if (!downloadIframe) {
            downloadIframe = document.createElement('iframe');
            downloadIframe.id = 'hidden-download-iframe';
            downloadIframe.style.display = 'none';
            document.body.appendChild(downloadIframe);
        }
        downloadIframe.src = downloadUrl;

        let pollCount = 0;
        const maxPolls = 60; // 30 seconds max polling duration

        const resetBtnState = (statusText, statusColor) => {
            clearInterval(pollInterval);
            clearInterval(fakeProgressInterval);
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
                        // serverless direct stream redirect or background download has dispatched.
                        if (failedPolls >= 6 && !hasRealProgressStarted) {
                            return resetBtnState("Download started!", "#059669");
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
                            updateStatus("Downloading file...", "var(--primary)");
                        } else if (info.status === 'Complete') {
                            hasRealProgressStarted = true;
                            statPercent.textContent = `100%`;
                            progressBarBg.style.width = `100%`;
                            downloadStats.textContent = "Download complete!";
                            updateStatus("Video saved to gallery.", "#059669");
                            
                            setTimeout(() => {
                                resetBtnState("Video saved to gallery.", "#059669");
                                downloadStats.textContent = '';
                            }, 2000);
                        } else if (info.status === 'Failed') {
                            resetBtnState(info.message || "Download failed. Please try another link.", "red");
                        }
                    }
                }

                if (pollCount >= maxPolls && !hasRealProgressStarted) {
                    resetBtnState("Download initiated.", "#059669");
                }
            } catch (e) {
                console.error('Polling error:', e);
                failedPolls++;
                if (failedPolls >= 6 && !hasRealProgressStarted) {
                    resetBtnState("Download initiated.", "#059669");
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
