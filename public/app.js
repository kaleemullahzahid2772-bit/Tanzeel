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

    const updateStatus = (text, color = "var(--text-muted)") => {
        appStatus.textContent = text;
        appStatus.style.color = color;
    };

    // Real API Call with safe JSON parsing
    const analyzeLink = async (url) => {
        try {
            const response = await fetch("/analyze", {
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
            if (fakeProgress < 100) {
                fakeProgress += Math.floor(Math.random() * 5) + 1;
                if (fakeProgress > 100) fakeProgress = 100;
                fakeProgressText.textContent = `${fakeProgress}%`;
            }
        }, 150);
        
        // Start analysis in the background while fake progress is showing
        const isSuccess = await performAnalysis(manualText);
        if (!isSuccess) {
            clearInterval(fakeProgressInterval);
            fakeProgressText.style.display = 'none';
            if (btnIcon) btnIcon.style.display = 'block';
            actionBtn.classList.remove('downloading');
            return;
        }
        
        currentUrl = manualText;

        // Ensure fake progress reaches 100 before switching
        while(fakeProgress < 100) {
            await new Promise(r => setTimeout(r, 100));
        }

        let hasRealProgressStarted = false;
        
        const downloadId = Math.random().toString(36).substring(2, 10);
        const downloadUrl = `/download?url=${encodeURIComponent(currentUrl)}&id=${downloadId}`;
        
        // Use window.location.href to trigger the download safely after async operations
        window.location.href = downloadUrl;

        let pollCount = 0;
        const maxPolls = 40; // 20 seconds total (500ms * 40)

        const pollInterval = setInterval(async () => {
            try {
                pollCount++;
                const res = await fetch(`/progress?id=${downloadId}`);
                const data = await res.json();
                
                if (!data.success && pollCount >= maxPolls && !hasRealProgressStarted) {
                    clearInterval(pollInterval);
                    clearInterval(fakeProgressInterval);
                    updateStatus("Download failed (Timeout). Please try again.", "red");
                    actionBtn.classList.remove('downloading');
                    progressContainer.style.display = 'none';
                    fakeProgressText.style.display = 'none';
                    spinner.style.display = 'none';
                    const btnIcon = actionBtn.querySelector('.btn-icon');
                    if (btnIcon) btnIcon.style.display = 'block';
                    return;
                }
                
                if (data.success && data.data) {
                    const info = data.data;
                    if (info.status === 'Downloading...') {
                        if (!hasRealProgressStarted) {
                            hasRealProgressStarted = true;
                            clearInterval(fakeProgressInterval);
                            fakeProgressText.style.display = 'none';
                            spinner.style.display = 'block';
                            progressContainer.style.display = 'block';
                        }
                        
                        statPercent.textContent = `${info.percent}%`;
                        progressBarBg.style.width = `${info.percent}%`;
                        
                        // Parse values
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
                        if (!hasRealProgressStarted) {
                            hasRealProgressStarted = true;
                            clearInterval(fakeProgressInterval);
                        }
                        clearInterval(pollInterval);
                        
                        statPercent.textContent = `100%`;
                        progressBarBg.style.width = `100%`;
                        downloadStats.textContent = "Download complete!";
                        updateStatus("Video saved to gallery.", "#059669");
                        
                        actionBtn.classList.remove('downloading');
                        
                        // Wait a bit to let user see 100% and complete status
                        setTimeout(() => {
                            progressContainer.style.display = 'none';
                            fakeProgressText.style.display = 'none';
                            spinner.style.display = 'none';
                            if (btnIcon) btnIcon.style.display = 'block';
                            downloadStats.textContent = '';
                        }, 3000);
                    }
                }
            } catch (e) {
                console.error(e);
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
            navigator.clipboard.writeText('kaleemullahzahid2772@gmail.com').then(() => {
                const originalText = copyEmailBtn.textContent;
                copyEmailBtn.textContent = 'COPIED!';
                setTimeout(() => copyEmailBtn.textContent = originalText, 2000);
            });
        });

        copyRaastBtn.addEventListener('click', () => {
            navigator.clipboard.writeText('03274816872').then(() => {
                const originalText = copyRaastBtn.textContent;
                copyRaastBtn.textContent = 'COPIED!';
                setTimeout(() => copyRaastBtn.textContent = originalText, 2000);
            });
        });
    }
});
