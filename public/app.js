// Tanzeel Video Downloader Front-end App v1.1.0
document.addEventListener('DOMContentLoaded', () => {
    const actionBtn = document.getElementById('action-btn');
    const resultsPanel = document.getElementById('results-panel');
    const optionsList = document.getElementById('options-list');
    const appStatus = document.getElementById('app-status');
    const linkInput = document.getElementById('link-input');

    let currentUrl = null;
    let isAnalyzed = false;

    // ========== Social Proof Counter ==========
    const updateDownloadCount = () => {
        const countEl = document.getElementById('download-count');
        if (!countEl) return;
        const base = 1247;
        const stored = parseInt(localStorage.getItem('tanzeel_dl_count') || '0', 10);
        const today = new Date().toDateString();
        const lastDate = localStorage.getItem('tanzeel_dl_date');
        if (lastDate !== today) {
            localStorage.setItem('tanzeel_dl_count', '0');
            localStorage.setItem('tanzeel_dl_date', today);
        }
        const display = base + stored;
        countEl.textContent = display.toLocaleString() + '+';
    };
    updateDownloadCount();

    // ========== Share Button ==========
    const shareBtn = document.getElementById('share-btn');
    const showShareToast = (msg) => {
        let toast = document.querySelector('.share-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'share-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2200);
    };

    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const shareData = {
                title: 'Tanzeel - Free Video Downloader',
                text: 'Download videos from YouTube, Instagram, Twitter & TikTok — free, fast, no ads.',
                url: 'https://tanzeel.app'
            };
            if (navigator.share) {
                try {
                    await navigator.share(shareData);
                } catch (e) {
                    if (e.name !== 'AbortError') {
                        await navigator.clipboard.writeText(shareData.url);
                        showShareToast('Link copied to clipboard!');
                    }
                }
            } else {
                try {
                    await navigator.clipboard.writeText(shareData.url);
                    showShareToast('Link copied to clipboard!');
                } catch {
                    showShareToast('Share: tanzeel.app');
                }
            }
        });
    }

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
            const baseUrl = window.API_BASE_URL.replace(/\/+$/, '');
            return `${baseUrl}${endpoint}`;
        }
        if (window.TANZEEL_CONFIG && typeof window.TANZEEL_CONFIG.apiBaseUrl === 'string') {
            const baseUrl = window.TANZEEL_CONFIG.apiBaseUrl.replace(/\/+$/, '');
            return `${baseUrl}${endpoint}`;
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
        optionsList.innerHTML = '';

        const safeTitle = videoTitle || 'Download Video';

        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = '';
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'download-option';

        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'opt-details';

        const qualitySpan = document.createElement('span');
        qualitySpan.className = 'opt-quality';
        qualitySpan.textContent = safeTitle;

        const sizeSpan = document.createElement('span');
        sizeSpan.className = 'opt-size';
        sizeSpan.textContent = 'Click to save MP4 to Gallery / Downloads';

        detailsDiv.appendChild(qualitySpan);
        detailsDiv.appendChild(sizeSpan);

        const badgeDiv = document.createElement('div');
        badgeDiv.className = 'opt-icon';
        badgeDiv.textContent = 'SAVE MP4';

        link.appendChild(detailsDiv);
        link.appendChild(badgeDiv);
        optionsList.appendChild(link);

        showResultsPanel();
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

    // ========== Ripple Effect on Action Button ==========
    const addRipple = (e, el) => {
        const rect = el.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        const size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
        el.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    };

    // ========== Input Validation with Shake ==========
    const shakeInput = () => {
        linkInput.classList.remove('input-shake');
        void linkInput.offsetWidth; // trigger reflow
        linkInput.classList.add('input-shake');
        appStatus.classList.add('status-error');
        setTimeout(() => {
            linkInput.classList.remove('input-shake');
            appStatus.classList.remove('status-error');
        }, 1500);
    };

    linkInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            actionBtn.click();
        }
    });

    linkInput.addEventListener('input', () => {
        const text = linkInput.value.trim();
        if (isValidUrl(text)) {
            updateStatus("Ready to download. Click the button.", "var(--primary)");
            appStatus.classList.add('status-success');
            appStatus.classList.remove('status-error');
        } else {
            updateStatus("Waiting for a valid link...", "var(--text-muted)");
            appStatus.classList.remove('status-success');
        }
    });

    // ========== Results Panel Show Animation ==========
    const showResultsPanel = () => {
        resultsPanel.classList.remove('hidden');
        resultsPanel.classList.add('show');
        setTimeout(() => resultsPanel.classList.remove('show'), 400);
    };

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
        
        // Hide results panel until confirmed
        if (resultsPanel) resultsPanel.classList.add('hidden');
        if (optionsList) optionsList.innerHTML = '';

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
            shakeInput();
            return;
        }
        
        currentUrl = manualText;

        let hasRealProgressStarted = false;
        let failedPolls = 0;
        
        const downloadId = Math.random().toString(36).substring(2, 10);
        const downloadUrl = getApiUrl(`/download?url=${encodeURIComponent(currentUrl)}&id=${downloadId}`);

        // Trigger browser file download via hidden iframe
        let iframe = document.getElementById('download-frame');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'download-frame';
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
        }
        iframe.src = downloadUrl;

        let pollCount = 0;
        const maxPolls = 60; // 60 seconds max polling duration

        const resetBtnState = (statusText, statusColor, isFailure = false) => {
            clearInterval(pollInterval);
            if (statusText) updateStatus(statusText, statusColor || "#059669");
            actionBtn.classList.remove('downloading');
            actionBtn.classList.remove('loading');
            progressContainer.style.display = 'none';
            fakeProgressText.style.display = 'none';
            spinner.style.display = 'none';
            if (btnIcon) btnIcon.style.display = 'block';
            if (isFailure && resultsPanel) {
                resultsPanel.classList.add('hidden');
                if (optionsList) optionsList.innerHTML = '';
            }
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
                        if (failedPolls >= 10 && !hasRealProgressStarted) {
                            renderDownloadOptions(lastAnalyzedTitle, downloadUrl);
                            return resetBtnState("Download dispatched to browser! Check your Downloads folder.", "#059669");
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
                            renderDownloadOptions(lastAnalyzedTitle, downloadUrl);
                            updateStatus("Video downloaded successfully! Check your Downloads folder.", "#059669");
                            
                            // Increment social proof counter
                            const c = parseInt(localStorage.getItem('tanzeel_dl_count') || '0', 10) + 1;
                            localStorage.setItem('tanzeel_dl_count', String(c));
                            updateDownloadCount();
                            
                            setTimeout(() => {
                                resetBtnState("Video downloaded successfully! Check your Downloads folder.", "#059669");
                                downloadStats.textContent = '';
                            }, 3000);
                        } else if (info.status === 'Failed') {
                            console.error("Download failed reason:", info.message);
                            resetBtnState(info.message || "Download failed. Please check your link.", "red", true);
                        }
                    }
                }

                if (pollCount >= maxPolls && !hasRealProgressStarted) {
                    renderDownloadOptions(lastAnalyzedTitle, downloadUrl);
                    resetBtnState("Download request finished. Check your Downloads folder.", "#059669");
                }
            } catch (e) {
                console.error('Polling error:', e);
                failedPolls++;
                if (failedPolls >= 10 && !hasRealProgressStarted) {
                    resetBtnState("Download dispatched to browser. Check your Downloads folder.", "#059669");
                }
            }
        }, 1000);
    };

    actionBtn.addEventListener('click', (e) => {
        if (actionBtn.classList.contains('loading') || actionBtn.classList.contains('downloading')) {
            return;
        }

        addRipple(e, actionBtn);

        const manualText = linkInput.value.trim();
        if (isValidUrl(manualText)) {
            triggerDownload(manualText);
        } else {
            shakeInput();
            updateStatus("Please paste a valid link first.", "#dc2626");
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

    // Info Modal Logic
    const infoBtn = document.getElementById('info-btn');
    const infoModal = document.getElementById('info-modal');
    const closeInfoModalBtn = document.getElementById('close-info-modal-btn');

    if (infoBtn && infoModal) {
        infoBtn.addEventListener('click', () => {
            infoModal.style.display = 'flex';
        });

        if (closeInfoModalBtn) {
            closeInfoModalBtn.addEventListener('click', () => {
                infoModal.style.display = 'none';
            });
        }

        infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal) {
                infoModal.style.display = 'none';
            }
        });
    }

    // ========== PWA: Install Prompt ==========
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;

        // Check if user already dismissed
        if (localStorage.getItem('tanzeel_install_dismissed') === 'true') return;

        // Show install banner after 30 seconds
        setTimeout(() => {
            const banner = document.getElementById('install-banner');
            if (banner && deferredPrompt) {
                banner.style.display = 'block';
            }
        }, 30000);
    });

    const installBtn = document.getElementById('install-btn');
    const dismissInstallBtn = document.getElementById('dismiss-install-btn');

    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log('Install outcome:', outcome);
            deferredPrompt = null;
            const banner = document.getElementById('install-banner');
            if (banner) banner.style.display = 'none';
        });
    }

    if (dismissInstallBtn) {
        dismissInstallBtn.addEventListener('click', () => {
            const banner = document.getElementById('install-banner');
            if (banner) banner.style.display = 'none';
            localStorage.setItem('tanzeel_install_dismissed', 'true');
        });
    }

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        const banner = document.getElementById('install-banner');
        if (banner) banner.style.display = 'none';
        console.log('Tanzeel PWA installed!');
    });

    // ========== PWA: Update Toast ==========
    const updateBtn = document.getElementById('update-btn');
    const dismissUpdateBtn = document.getElementById('dismiss-update-btn');

    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
            }
            const toast = document.getElementById('update-toast');
            if (toast) toast.style.display = 'none';
        });
    }

    if (dismissUpdateBtn) {
        dismissUpdateBtn.addEventListener('click', () => {
            const toast = document.getElementById('update-toast');
            if (toast) toast.style.display = 'none';
        });
    }
});
