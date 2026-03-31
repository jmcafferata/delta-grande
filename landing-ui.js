// Browser detection utility
const detectBrowser = () => {
    const ua = navigator.userAgent || '';
    const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|Edg/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    return { isSafari, isIOS, supportsWebMAlpha: !isSafari };
};
const browserInfo = detectBrowser();

// Video source helper - returns appropriate source based on browser
// For Safari, replaces .webm with .mov (HEVC with alpha channel)
const getVideoSource = (webmPath, options = {}) => {
    const { fallback = null, hideIfUnsupported = false } = options;
    
    if (browserInfo.supportsWebMAlpha) {
        return webmPath;
    }
    
    // Safari: try .mov version (HEVC with alpha)
    if (fallback) {
        return fallback;
    }
    
    // Auto-generate .mov path by replacing extension
    const movPath = webmPath.replace(/\.webm$/i, '.mov');
    
    // Return null to hide if specified and no fallback
    return hideIfUnsupported ? null : movPath;
};

// Expose globally for the other script
window.audioLayers = {
    ambient: document.getElementById('audio-ambient'),
    music: document.getElementById('audio-music'),
    dialog: document.getElementById('audio-dialog')
};
const audioLayers = window.audioLayers;
window.browserInfo = browserInfo; // Expose for game code
window.getVideoSource = getVideoSource; // Expose for game code

const LOGO_SEQ_FRAME_COUNT = 240;
const LOGO_SEQ_FPS = 24000 / 1001;
const LOGO_SEQ_WIDTH = 600;
const LOGO_SEQ_HEIGHT = 338;

const getLogoFramePath = (index) => {
    const normalized = ((index % LOGO_SEQ_FRAME_COUNT) + LOGO_SEQ_FRAME_COUNT) % LOGO_SEQ_FRAME_COUNT;
    return `assets/logo_sequence/logo_${String(normalized + 1).padStart(4, '0')}.png`;
};

class CanvasSequencePlayer {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas?.getContext('2d');
        this.frameCount = options.frameCount ?? LOGO_SEQ_FRAME_COUNT;
        this.frameDuration = 1000 / (options.fps ?? LOGO_SEQ_FPS);
        this.pathResolver = options.pathResolver ?? getLogoFramePath;
        this.preloadAhead = options.preloadAhead ?? 24;
        this.maxCache = options.maxCache ?? 80;
        this.frameCache = new Map();
        this.cacheOrder = [];
        this.loadingSet = new Set();
        this.currentFrame = 0;
        this.isPlaying = false;
        this.rafId = null;
        this.lastTick = 0;

        if (this.ctx) {
            this.ctx.imageSmoothingEnabled = true;
            this.ctx.imageSmoothingQuality = 'high';
        }
    }

    async prepare() {
        const firstFrame = await this.loadFrame(0);
        this.storeFrame(0, firstFrame);
        this.drawFrame(0);
        this.preloadWindow();
    }

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.lastTick = performance.now();
        this.rafId = requestAnimationFrame(this.tick);
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }

    tick = (timestamp) => {
        if (!this.isPlaying) return;
        if (timestamp - this.lastTick >= this.frameDuration) {
            this.advanceFrame();
            this.lastTick = timestamp;
        }
        this.rafId = requestAnimationFrame(this.tick);
    };

    advanceFrame() {
        this.currentFrame = (this.currentFrame + 1) % this.frameCount;
        this.drawFrame(this.currentFrame);
        this.preloadWindow();
    }

    drawFrame(index) {
        if (!this.ctx) return;
        const frame = this.frameCache.get(index);
        if (!frame) {
            this.requestFrame(index);
            return;
        }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    }

    preloadWindow() {
        for (let offset = 1; offset <= this.preloadAhead; offset++) {
            const idx = (this.currentFrame + offset) % this.frameCount;
            this.requestFrame(idx);
        }
    }

    requestFrame(index) {
        if (this.frameCache.has(index) || this.loadingSet.has(index)) return;
        this.loadingSet.add(index);
        this.loadFrame(index)
            .then((frame) => this.storeFrame(index, frame))
            .catch((err) => console.warn('Logo frame load failed', err))
            .finally(() => this.loadingSet.delete(index));
    }

    async loadFrame(index) {
        const src = this.pathResolver(index);
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
                try {
                    if (typeof window.createImageBitmap === 'function') {
                        const bitmap = await createImageBitmap(img);
                        resolve(bitmap);
                    } else {
                        resolve(img);
                    }
                } catch (error) {
                    reject(error);
                }
            };
            img.onerror = reject;
            img.src = src;
        });
    }

    storeFrame(index, frame) {
        this.frameCache.set(index, frame);
        this.cacheOrder.push(index);
        if (this.cacheOrder.length > this.maxCache) {
            const evictIndex = this.cacheOrder.shift();
            if (typeof evictIndex === 'number' && evictIndex !== index) {
                const cached = this.frameCache.get(evictIndex);
                if (cached && typeof cached.close === 'function') {
                    cached.close();
                }
                this.frameCache.delete(evictIndex);
            }
        }
    }
}

async function initLogoCanvasFallback() {
    const container = document.querySelector('.logo-naranja');
    const canvas = document.getElementById('logo-canvas');
    const video = container ? container.querySelector('video') : null;
    const forceCanvas = typeof window !== 'undefined' && window.forceLogoCanvas === true;

    if (!container || !canvas || !video) return;
    if (!(browserInfo.isSafari || browserInfo.isIOS || forceCanvas)) return;

    canvas.width = LOGO_SEQ_WIDTH;
    canvas.height = LOGO_SEQ_HEIGHT;

    const player = new CanvasSequencePlayer(canvas, {
        frameCount: LOGO_SEQ_FRAME_COUNT,
        fps: LOGO_SEQ_FPS,
        pathResolver: getLogoFramePath
    });

    try {
        await player.prepare();
        container.classList.add('is-canvas-active');
        video.pause();
        video.currentTime = 0;
        player.play();
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                player.pause();
            } else {
                player.play();
            }
        });
        window.logoSequencePlayer = player;
    } catch (err) {
        console.warn('Logo canvas fallback failed, keeping video playback', err);
    }
}

const enableBtn = document.getElementById('enable-audio-global');
// Legacy reference removed: audioEl (web-music)
const islandEl = document.querySelector('.floating-island');
const creditsBtn = document.getElementById('credits-btn');
const creditsOverlay = document.getElementById('credits-overlay');
const creditsClose = document.getElementById('credits-close');

// Splat Viewer components
const splatContainer = document.getElementById('splat-container');
const splatIframe = document.getElementById('splat-iframe');
let splatOverlay = null;
let splatCamera = null;
let splatApp = null;
let splatPrevAutoRender = true;
let splatPrevTimeScale = 1;
let splatDesiredPauseState = false;
let splatAppliedPauseState = false;

const resolveSplatApp = () => {
    if (splatApp) return splatApp;
    if (!splatIframe) return null;
    try {
        const iframeWin = splatIframe.contentWindow;
        if (!iframeWin || !iframeWin.document) return null;
        const appEl = iframeWin.document.querySelector('pc-app');
        if (appEl && appEl.app) {
            splatApp = appEl.app;
            return splatApp;
        }
    } catch (err) {
        return null;
    }
    return null;
};

const setSplatPaused = (shouldPause) => {
    splatDesiredPauseState = shouldPause;
    const app = resolveSplatApp();
    if (!app) return;
    if (splatAppliedPauseState === shouldPause) return;

    if (shouldPause) {
        splatPrevAutoRender = app.autoRender;
        splatPrevTimeScale = typeof app.timeScale === 'number' ? app.timeScale : 1;
        if (typeof app.pause === 'function') {
            try { app.pause(); } catch (err) {}
        } else {
            app.autoRender = false;
        }
        if (typeof app.timeScale === 'number') {
            app.timeScale = 0;
        }
    } else {
        if (typeof app.timeScale === 'number') {
            app.timeScale = splatPrevTimeScale;
        }
        if (typeof app.resume === 'function') {
            try { app.resume(); } catch (err) {}
        } else {
            app.autoRender = splatPrevAutoRender;
        }
        if (typeof app.render === 'function') {
            try { app.render(); } catch (err) {}
        }
    }

    splatAppliedPauseState = shouldPause;
};

let isDragging = false;
let previousMouseX = 0;
let dragMoved = false;

// Click detection
let mouseDownTime = 0;
let mouseDownPos = { x: 0, y: 0 };

function initIslandInteractions() {
    // Helper to capture PlayCanvas camera once the iframe is ready
    const attachSplatCamera = () => {
        if (!splatIframe) return;
        try {
            const iframeWin = splatIframe.contentWindow;
            if (!iframeWin || !iframeWin.document) return;
            const appEl = iframeWin.document.querySelector('pc-app');
            if (appEl && appEl.app) {
                splatApp = appEl.app;
                const cam = splatApp.root.findByName('camera');
                setSplatPaused(splatDesiredPauseState);
                if (cam) {
                    splatCamera = cam;
                    return; // success, stop polling
                }
            }
        } catch (err) {
            // Ignore CORS / timing issues; will retry
        }
        // Retry a few times until it appears
        setTimeout(attachSplatCamera, 150);
    };

    // Mouse Controls for Splat
    const getClientX = (ev) => (ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX);

    const handleMouseDown = (e) => {
        mouseDownTime = Date.now();
        mouseDownPos = { x: getClientX(e), y: e.clientY };
        isDragging = true;
        previousMouseX = getClientX(e);
        dragMoved = false;
    };

    if (islandEl) {
        islandEl.addEventListener('mousedown', handleMouseDown);
        islandEl.addEventListener('touchstart', handleMouseDown, { passive: true });
    }

    splatOverlay = document.getElementById('splat-overlay');
    if (splatOverlay) {
        splatOverlay.addEventListener('mousedown', handleMouseDown);
        splatOverlay.addEventListener('touchstart', handleMouseDown, { passive: true });
    } else {
        document.addEventListener('mousedown', (e) => {
            if (e.target.id === 'splat-overlay') {
                handleMouseDown(e);
            }
        });
    }

    const handleMove = (e) => {
        if (isDragging) {
            const clientX = getClientX(e);
            const deltaX = clientX - previousMouseX;
            if (Math.abs(deltaX) > 1) dragMoved = true;

            // Feed spark field yaw so squares/dots rotate with drag
            if (window.dgSetSparkYaw) {
                window.dgSetSparkYaw(deltaX * 0.003);
            }

            if (splatIframe) {
                // Rotate Splat Camera
                try {
                    const iframeWin = splatIframe.contentWindow;
                    if (iframeWin && iframeWin.document && splatCamera) {
                        // Get current position and rotation
                        const pos = splatCamera.getPosition();
                        const currentRot = splatCamera.getEulerAngles();
                        const radius = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
                        let theta = Math.atan2(pos.x, pos.z);

                        theta -= deltaX * 0.0025; // rotate around Y (50% slower)

                        const newX = radius * Math.sin(theta);
                        const newZ = radius * Math.cos(theta);

                        splatCamera.setPosition(newX, pos.y, newZ);
                        // Maintain the pitch (x rotation) while rotating to look at center
                        const dx = 0 - newX;
                        const dz = 0 - newZ;
                        const yaw = Math.atan2(dx, dz) * (180 / Math.PI);
                        splatCamera.setEulerAngles(currentRot.x, yaw, 0);
                    }
                } catch (err) {
                    // Ignore cross-origin errors if any
                }
            }

            previousMouseX = clientX;
        }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove, { passive: true });

    const handleUp = (e) => {
        isDragging = false;
    };

    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchend', handleUp, { passive: true });

    // Setup Iframe Click Listener
    if (splatIframe) {
        splatIframe.onload = () => {
            try {
                attachSplatCamera();
            } catch (e) {
                console.warn('Cannot access iframe content (likely CORS issue if not local):', e);
            }
        };
        attachSplatCamera();
    }
}

initIslandInteractions();
initLogoCanvasFallback();

let audioAnalyzer = null;
let dataArray = null;
let animationFrameId = null;

function initWaveform() {
    if (audioAnalyzer) return; // already initialized

    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioContext();
        audioAnalyzer = audioCtx.createAnalyser();
        audioAnalyzer.connect(audioCtx.destination); // Master output

        audioAnalyzer.fftSize = 64;
        const bufferLength = audioAnalyzer.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        // Connect ALL audio layers to the analyzer
        Object.values(audioLayers).forEach(layer => {
            if (layer) {
                try {
                    const source = audioCtx.createMediaElementSource(layer);
                    source.connect(audioAnalyzer);
                } catch (e) {
                    // reduce noise if already connected 
                }
            }
        });

        const waveformBars = document.querySelectorAll('.waveform-bar');
        const waveformContainer = document.getElementById('waveform');
        if (waveformContainer) waveformContainer.classList.add('is-visible');

        function draw() {
            animationFrameId = requestAnimationFrame(draw);
            audioAnalyzer.getByteFrequencyData(dataArray);

            waveformBars.forEach((bar, index) => {
                const value = dataArray[index] || 0;
                const percent = value / 255;
                const height = Math.max(2, percent * 34);
                bar.style.height = `${height}px`;
            });
        }
        draw();
        return audioCtx;
    } catch (err) {
        console.warn('Waveform init failed:', err);
        return null;
    }
}



// Preload background music and SFX to avoid playback delay on first click
const PRELOAD_BG_SRC = 'assets/music/13-verano.mp3';
const PRELOAD_SFX_SRC = '/assets/exito.mp3';

// Prepare SFX element and preload it
const sfxEl = new Audio(PRELOAD_SFX_SRC);
sfxEl.preload = 'auto';
sfxEl.crossOrigin = 'anonymous';
// Lower SFX volume to be less intrusive
sfxEl.volume = 0.1;
// Trigger load to warm cache (won't autoplay)
try { sfxEl.load(); } catch (e) { /* ignore load errors */ }

// Preload settings for layers
if (audioLayers.music) {
    audioLayers.music.src = PRELOAD_BG_SRC;
    audioLayers.music.volume = 0.4;
}
if (audioLayers.ambient) {
    audioLayers.ambient.volume = 0.4;
}
if (audioLayers.dialog) {
    audioLayers.dialog.volume = 0.8;
}

async function enableGlobalAudio(onlyContext = false) {
    // Initialize waveform (which creates context)
    const ctx = initWaveform();

    // Try to resume context
    if (ctx && ctx.state === 'suspended') {
        try { await ctx.resume(); } catch (e) { }
    } else {
        // Fallback if initWaveform didn't creating one or we need one generic
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
            const tempCtx = new Ctx();
            await tempCtx.resume();
        }
    }

    if (onlyContext) return;

    if (enableBtn) {
        enableBtn.textContent = 'Audio habilitado';
        enableBtn.disabled = true;
    }
    // Logic to play default music if nothing else is playing? 
    // Original code played `audioEl`.
    // We assume explicit click starts audio, OR we start music by default?
    // "Play" on enable usually implies starting background music.
    // Let's check if any layer is playing.
    const anyPlaying = Object.values(audioLayers).some(l => !l.paused);
    if (!anyPlaying) {
        // Start music by default if nothing playing
        if (audioLayers.music) {
            audioLayers.music.src = 'assets/music/13-verano.mp3';
            try { await audioLayers.music.play(); } catch (e) { }
            // Update UI state
            /* We can't easily update `state` from here as it's in another scope. 
               But the user interacts via clicks mostly. */
        }
    }
}
window.enableGlobalAudio = enableGlobalAudio;

if (enableBtn) enableBtn.addEventListener('click', enableGlobalAudio);

// PDF Viewer for Credits
let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;

const canvas = document.getElementById('pdf-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const pdfLoading = document.getElementById('pdf-loading');
const pdfError = document.getElementById('pdf-error');
const pageInfo = document.getElementById('pdf-page-info');
const prevBtn = document.getElementById('pdf-prev');
const nextBtn = document.getElementById('pdf-next');

// Configure PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function renderPage(num) {
    if (!pdfDoc || !canvas || !ctx) return;
    pageRendering = true;

    pdfDoc.getPage(num).then(function(page) {
        // Get container width - prioritize fitting width for tall PDFs
        const container = canvas.parentElement;
        const maxWidth = container ? container.clientWidth - 24 : 800;
        
        // Calculate scale to fit width (for vertical/tall PDFs)
        const viewport = page.getViewport({ scale: 1.0 });
        const scale = maxWidth / viewport.width;
        const scaledViewport = page.getViewport({ scale: scale });
        
        canvas.height = scaledViewport.height;
        canvas.width = scaledViewport.width;

        const renderContext = {
            canvasContext: ctx,
            viewport: scaledViewport
        };

        const renderTask = page.render(renderContext);
        renderTask.promise.then(function() {
            pageRendering = false;
            if (pageNumPending !== null) {
                renderPage(pageNumPending);
                pageNumPending = null;
            }
        });
    });

    if (pageInfo) pageInfo.textContent = `Página ${num} de ${pdfDoc.numPages}`;
    if (prevBtn) prevBtn.disabled = (num <= 1);
    if (nextBtn) nextBtn.disabled = (num >= pdfDoc.numPages);
}

function queueRenderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
    } else {
        renderPage(num);
    }
}

function onPrevPage() {
    if (pageNum <= 1) return;
    pageNum--;
    queueRenderPage(pageNum);
}

function onNextPage() {
    if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum++;
    queueRenderPage(pageNum);
}

if (prevBtn) prevBtn.addEventListener('click', onPrevPage);
if (nextBtn) nextBtn.addEventListener('click', onNextPage);

// Load PDF when opening credits
function loadPDF() {
    if (!canvas || !ctx || typeof pdfjsLib === 'undefined') {
        if (pdfError) {
            pdfError.textContent = 'El visor de PDF no está disponible';
            pdfError.style.display = 'block';
        }
        if (pdfLoading) pdfLoading.style.display = 'none';
        return;
    }

    const url = 'assets/creditos/Creditos Delta_20260114.pdf';
    
    if (pdfLoading) pdfLoading.style.display = 'block';
    if (pdfError) pdfError.style.display = 'none';

    pdfjsLib.getDocument(url).promise.then(function(pdf) {
        pdfDoc = pdf;
        if (pdfLoading) pdfLoading.style.display = 'none';
        renderPage(pageNum);
    }).catch(function(error) {
        console.error('Error loading PDF:', error);
        if (pdfError) {
            pdfError.textContent = 'Error al cargar el PDF de créditos';
            pdfError.style.display = 'block';
        }
        if (pdfLoading) pdfLoading.style.display = 'none';
    });
}

// Credits overlay interactions
function openCredits() {
    if (!creditsOverlay) return;
    creditsOverlay.classList.add('is-visible');
    creditsOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('credits-open');
    
    // Load PDF on first open
    if (!pdfDoc) {
        loadPDF();
    }
}

function closeCredits() {
    if (!creditsOverlay) return;
    creditsOverlay.classList.remove('is-visible');
    creditsOverlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('credits-open');
}

if (creditsBtn) creditsBtn.addEventListener('click', openCredits);
if (creditsClose) creditsClose.addEventListener('click', closeCredits);
if (creditsOverlay) {
    creditsOverlay.addEventListener('click', (ev) => {
        if (ev.target === creditsOverlay) closeCredits();
    });
}
window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeCredits();
    // Navigate PDF with arrow keys when credits are open
    if (creditsOverlay && creditsOverlay.classList.contains('is-visible')) {
        if (ev.key === 'ArrowLeft') onPrevPage();
        if (ev.key === 'ArrowRight') onNextPage();
    }
});

// Handle messages from service worker to update progress UI
(function () {
    const toast = document.getElementById('pwaToast');
    const bar = toast ? toast.querySelector('.pwa-progress > .bar') : null;
    const pct = document.getElementById('pwaToastPct');
    const filenameEl = document.getElementById('pwaToastFilename');
    const sizeEl = document.getElementById('pwaToastSize');
    const cancelBtn = document.getElementById('pwaCancelBtn');

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    function getFilename(url) {
        try {
            const urlObj = new URL(url, window.location.origin);
            const pathname = decodeURIComponent(urlObj.pathname);
            const parts = pathname.split('/');
            return parts[parts.length - 1] || pathname;
        } catch (e) {
            return url;
        }
    }

    function showPwaToast(message, percent, filename = '', fileSize = 0, cachedBytes = 0) {
        if (!toast) return;
        toast.querySelector('.label').textContent = message;
        if (bar) bar.style.width = (percent || 0) + '%';
        if (pct) pct.textContent = Math.round(percent || 0) + '%';

        if (filenameEl) {
            filenameEl.textContent = filename ? `📄 ${filename}` : '';
            filenameEl.style.display = filename ? 'block' : 'none';
        }

        if (sizeEl) {
            if (fileSize > 0 && cachedBytes > 0) {
                // Show: "45.2 KB | 735.8 MB downloaded"
                sizeEl.textContent = `${formatBytes(fileSize)} | ${formatBytes(cachedBytes)} descargados`;
                sizeEl.style.display = 'block';
            } else if (cachedBytes > 0) {
                sizeEl.textContent = `${formatBytes(cachedBytes)} descargados`;
                sizeEl.style.display = 'block';
            } else if (fileSize > 0) {
                sizeEl.textContent = formatBytes(fileSize);
                sizeEl.style.display = 'block';
            } else {
                sizeEl.style.display = 'none';
            }
        }

        toast.hidden = false;
    }

    function hidePwaToast() {
        if (!toast) return;
        toast.hidden = true;
        if (cancelBtn) cancelBtn.hidden = true;
    }

    function showCancelButton() {
        if (cancelBtn) cancelBtn.hidden = false;
    }

    function hideCancelButton() {
        if (cancelBtn) cancelBtn.hidden = true;
    }

    // Cancel button handler
    if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
            if ('serviceWorker' in navigator) {
                const reg = await navigator.serviceWorker.ready;
                if (reg && reg.active) {
                    reg.active.postMessage({ type: 'CANCEL_CACHE' });
                    cancelBtn.disabled = true;
                    cancelBtn.textContent = 'Cancelando...';
                }
            }
        });
    }

    // Expose a show function used by the other inline script
    window.showPwaToast = showPwaToast;

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            const data = event.data || {};

            if (data.type === 'CACHE_RESUME') {
                const { cached, total } = data;
                const pctVal = total ? Math.round((cached / total) * 100) : 0;
                showPwaToast(`Reanudando... (${cached}/${total})`, pctVal, '', 0, 0);
                showCancelButton();
            } else if (data.type === 'CACHE_PROGRESS') {
                const { cached, total, url, fileSize, cachedBytes } = data;
                const pctVal = total ? Math.round((cached / total) * 100) : 0;
                const filename = url ? getFilename(url) : '';
                showPwaToast(
                    `Guardando recursos... (${cached}/${total})`,
                    pctVal,
                    filename,
                    fileSize || 0,
                    cachedBytes || 0
                );
                showCancelButton();
            } else if (data.type === 'CACHE_ERROR') {
                // Show error briefly but don't interrupt the download
                const filename = data.url ? getFilename(data.url) : '';
                const errorMsg = data.error || `Status: ${data.status}`;

                if (data.skipping) {
                    // File is being skipped, show briefly
                    console.warn(`[Cache] Skipping file: ${filename} (${errorMsg})`);
                    // Don't update the toast for skipped files - let progress continue
                } else {
                    // Critical error
                    showPwaToast('Error: ' + filename, 0, '', 0, 0);
                }
                // Don't hide cancel button on error, user might want to cancel
            } else if (data.type === 'CACHE_CANCELLED') {
                const { cached, total } = data;
                showPwaToast(`Cancelado: ${cached}/${total} recursos guardados`, 0, '', 0, 0);
                hideCancelButton();
                setTimeout(hidePwaToast, 4000);
            } else if (data.type === 'CACHE_COMPLETE') {
                const { cached, total, totalBytes } = data;
                const sizeInfo = totalBytes ? ` (${formatBytes(totalBytes)})` : '';
                showPwaToast(`Listo: ${cached}/${total} recursos guardados${sizeInfo}`, 100, '', 0, 0);
                hideCancelButton();
                setTimeout(hidePwaToast, 3000);
            }
        });
    }
})();

(function () {
    const MIN_RADIUS = 18;
    const MAX_RADIUS = 38;
    const RATIO = 0.03;
    const MIN_CORNER = 24;
    const MAX_CORNER = 90;
    const CORNER_RATIO = 0.1;
    const frame = document.querySelector('.video-frame');
    const root = document.documentElement;
    if (!frame || !root) return;

    function updateRadius() {
        const rect = frame.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const calculated = Math.round(rect.width * RATIO);
        const value = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, calculated));
        root.style.setProperty('--video-frame-radius', value + 'px');
        const diag = Math.min(rect.width, rect.height);
        const scaledCorner = Math.round(diag * CORNER_RATIO);
        const cornerLength = Math.max(MIN_CORNER, Math.min(MAX_CORNER, scaledCorner));
        root.style.setProperty('--video-frame-corner-length', cornerLength + 'px');
    }

    updateRadius();
    window.addEventListener('resize', updateRadius);
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(updateRadius);
        observer.observe(frame);
    }
})();

// Drag and drop functionality for manifesto item
(function () {
    const manifestoItem = document.querySelector('.manifiesto-item');
    if (!manifestoItem) return;

    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    // Get initial position from computed style
    const style = window.getComputedStyle(manifestoItem);
    xOffset = parseInt(style.left) || 20;
    yOffset = parseInt(style.top) || 20;

    function dragStart(e) {
        if (e.type === "touchstart") {
            initialX = e.touches[0].clientX - xOffset;
            initialY = e.touches[0].clientY - yOffset;
        } else {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
        }

        // Only start drag if clicking on the element itself, not scrollbar
        if (e.target === manifestoItem || manifestoItem.contains(e.target)) {
            isDragging = true;
            manifestoItem.classList.add('dragging');
        }
    }

    function dragEnd(e) {
        if (isDragging) {
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
            manifestoItem.classList.remove('dragging');
        }
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();

            if (e.type === "touchmove") {
                currentX = e.touches[0].clientX - initialX;
                currentY = e.touches[0].clientY - initialY;
            } else {
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
            }

            xOffset = currentX;
            yOffset = currentY;

            // Keep element within viewport bounds
            const rect = manifestoItem.getBoundingClientRect();
            const maxX = window.innerWidth - rect.width;
            const maxY = window.innerHeight - rect.height;

            xOffset = Math.max(0, Math.min(xOffset, maxX));
            yOffset = Math.max(0, Math.min(yOffset, maxY));

            manifestoItem.style.left = xOffset + 'px';
            manifestoItem.style.top = yOffset + 'px';
        }
    }

    // Mouse events
    manifestoItem.addEventListener('mousedown', dragStart, false);
    document.addEventListener('mouseup', dragEnd, false);
    document.addEventListener('mousemove', drag, false);

    // Touch events
    manifestoItem.addEventListener('touchstart', dragStart, false);
    document.addEventListener('touchend', dragEnd, false);
    document.addEventListener('touchmove', drag, { passive: false });
})();

// Floating text typewriter animation on scroll
(function () {
    const floatingTexts = document.querySelectorAll('.floating-text');
    if (!floatingTexts.length) return;

    const typewriterConfig = {
        totalDuration: 1000, // Total duration in ms for all characters (faster entry)
        startDelay: 300, // ms before animation starts when element enters viewport
        glitchChars: '█▓▒░@#$%&*ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        glitchIterations: 2, // Number of random characters to show before the real one
        glitchSpeed: 15 // ms between glitch characters
    };

    // Store original content and state for each floating-text
    const textStates = new Map();

    function initFloatingText() {
        floatingTexts.forEach(container => {
            // If already initialized, skip
            if (textStates.has(container)) return;

            const paragraphs = container.querySelectorAll('p, div');
            const originalContent = Array.from(paragraphs).map(p => ({
                element: p,
                originalHTML: p.innerHTML,
                isAnimating: false,
                timeoutId: null,
                intervalId: null,
                height: 0,
                width: 0,
                textAlign: '',
                charPositions: [] // Array of {x, y, width, height} for each character
            }));
            textStates.set(container, originalContent);

            // Calculate positions by rendering text invisibly
            let hasValidHeight = false;
            originalContent.forEach(state => {
                const { element, originalHTML } = state;

                // Store original text-align
                state.textAlign = window.getComputedStyle(element).textAlign;

                // Temporarily show full text to measure
                element.innerHTML = originalHTML;
                element.style.visibility = 'hidden';
                element.style.height = 'auto';
                element.style.width = 'auto';

                const rect = element.getBoundingClientRect();
                state.height = rect.height;
                state.width = rect.width;

                if (state.height > 0) hasValidHeight = true;

                // Get character positions relative to element
                const plainText = element.textContent;
                const elementRect = element.getBoundingClientRect();

                for (let i = 0; i < plainText.length; i++) {
                    try {
                        // Create a range for each character
                        let charIndex = 0;
                        let found = false;

                        const walk = (node) => {
                            if (found) return;
                            if (node.nodeType === Node.TEXT_NODE) {
                                for (let j = 0; j < node.textContent.length; j++) {
                                    if (charIndex === i) {
                                        const range = document.createRange();
                                        range.setStart(node, j);
                                        range.setEnd(node, j + 1);
                                        const rects = range.getClientRects();

                                        if (rects.length > 0) {
                                            const charRect = rects[0];
                                            state.charPositions.push({
                                                x: charRect.left - elementRect.left,
                                                y: charRect.top - elementRect.top,
                                                width: charRect.width,
                                                height: charRect.height
                                            });
                                        } else {
                                            state.charPositions.push({
                                                x: 0,
                                                y: 0,
                                                width: 0,
                                                height: 0
                                            });
                                        }
                                        found = true;
                                        return;
                                    }
                                    charIndex++;
                                }
                            } else if (node.nodeType === Node.ELEMENT_NODE) {
                                for (let child of node.childNodes) {
                                    walk(child);
                                    if (found) return;
                                }
                            }
                        };

                        walk(element);
                    } catch (e) {
                        // Fallback if position calculation fails
                        state.charPositions.push({
                            x: 0,
                            y: 0,
                            width: 0,
                            height: 0
                        });
                    }
                }

                // Clear and set proper dimensions ONLY if we got a valid height
                // Otherwise leave it alone (fallback to static text)
                if (state.height > 0) {
                    element.innerHTML = '';
                    element.style.visibility = 'visible';
                    element.style.height = state.height + 'px';
                    element.style.width = 'auto';
                } else {
                    element.style.visibility = 'visible';
                    element.style.height = 'auto';
                }
            });

            // Set container height
            const maxHeight = originalContent.reduce((max, state) => Math.max(max, state.height), 0);
            if (maxHeight > 0) {
                container.style.minHeight = maxHeight + 'px';
            }
        });
    }

    function getPlainTextLength(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.textContent.length;
    }

    function getPartialHTML(html, charCount) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        let count = 0;

        const walk = (node, maxChars) => {
            if (count >= maxChars) return '';
            if (node.nodeType === Node.TEXT_NODE) {
                const remaining = maxChars - count;
                const text = node.textContent.substring(0, remaining);
                count += text.length;
                return text;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tagName = node.tagName.toLowerCase();
                let result = `<${tagName}>`;
                for (let child of node.childNodes) {
                    if (count >= maxChars) break;
                    result += walk(child, maxChars);
                }
                result += `</${tagName}>`;
                return result;
            }
            return '';
        };

        let result = '';
        for (let child of temp.childNodes) {
            if (count >= charCount) break;
            result += walk(child, charCount);
        }
        return result;
    }

    function getPartialHTMLWithGlitch(html, charCount, glitchChar = null) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        let count = 0;

        const walk = (node, maxChars) => {
            if (count >= maxChars) return '';
            if (node.nodeType === Node.TEXT_NODE) {
                const remaining = maxChars - count;
                let text = node.textContent.substring(0, remaining);

                // If we have a glitch character and we're at the last position, replace it
                if (glitchChar !== null && count + text.length === maxChars && text.length > 0) {
                    text = text.substring(0, text.length - 1) + glitchChar;
                }

                count += text.length;
                return text;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tagName = node.tagName.toLowerCase();
                let result = `<${tagName}>`;
                for (let child of node.childNodes) {
                    if (count >= maxChars) break;
                    result += walk(child, maxChars);
                }
                result += `</${tagName}>`;
                return result;
            }
            return '';
        };

        let result = '';
        for (let child of temp.childNodes) {
            if (count >= charCount) break;
            result += walk(child, charCount);
        }
        return result;
    }

    function animateTypewriter(container) {
        const states = textStates.get(container);
        if (!states) return;

        states.forEach(state => {
            if (state.isAnimating) return; // Already animating

            state.isAnimating = true;
            const { element, originalHTML, charPositions, textAlign } = state;
            const plainText = element.textContent || getPlainTextLength(originalHTML);
            const totalChars = typeof plainText === 'string' ? plainText.length : plainText;

            // Create a wrapper to maintain centering
            const wrapper = document.createElement('div');
            wrapper.style.position = 'relative';
            wrapper.style.display = 'inline-block';
            wrapper.style.textAlign = 'left';
            wrapper.style.minHeight = state.height + 'px';
            wrapper.style.minWidth = state.width + 'px';

            element.innerHTML = '';
            element.style.textAlign = textAlign;
            element.appendChild(wrapper);

            const getRandomGlitchChar = () => {
                return typewriterConfig.glitchChars.charAt(
                    Math.floor(Math.random() * typewriterConfig.glitchChars.length)
                );
            };

            // Get the actual text content to display
            const temp = document.createElement('div');
            temp.innerHTML = originalHTML;
            const textContent = temp.textContent;

            // Create randomized indices
            const indices = Array.from({ length: totalChars }, (_, i) => i);
            // Shuffle the indices
            for (let i = indices.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [indices[i], indices[j]] = [indices[j], indices[i]];
            }

            // Calculate time per character including glitch iterations
            const timePerChar = typewriterConfig.totalDuration / totalChars;
            const glitchTime = typewriterConfig.glitchIterations * typewriterConfig.glitchSpeed;

            state.timeoutId = setTimeout(() => {
                // Animate all characters simultaneously with staggered starts
                indices.forEach((charIndex, order) => {
                    const startTime = order * timePerChar;

                    // Glitch phase
                    for (let g = 0; g < typewriterConfig.glitchIterations; g++) {
                        setTimeout(() => {
                            const glitchChar = getRandomGlitchChar();
                            const pos = charPositions[charIndex] || { x: 0, y: 0 };

                            let span = wrapper.querySelector(`[data-char-index="${charIndex}"]`);
                            if (!span) {
                                span = document.createElement('span');
                                span.setAttribute('data-char-index', charIndex);
                                span.style.position = 'absolute';
                                span.style.left = pos.x + 'px';
                                span.style.top = pos.y + 'px';
                                span.style.whiteSpace = 'pre';
                                wrapper.appendChild(span);
                            }
                            span.textContent = glitchChar;
                        }, startTime + g * typewriterConfig.glitchSpeed);
                    }

                    // Final character reveal
                    setTimeout(() => {
                        const realChar = textContent[charIndex];
                        const pos = charPositions[charIndex] || { x: 0, y: 0 };

                        let span = wrapper.querySelector(`[data-char-index="${charIndex}"]`);
                        if (!span) {
                            span = document.createElement('span');
                            span.setAttribute('data-char-index', charIndex);
                            span.style.position = 'absolute';
                            span.style.left = pos.x + 'px';
                            span.style.top = pos.y + 'px';
                            span.style.whiteSpace = 'pre';
                            wrapper.appendChild(span);
                        }
                        span.textContent = realChar;
                    }, startTime + glitchTime);
                });

                // Animation complete - restore original HTML
                setTimeout(() => {
                    element.innerHTML = originalHTML;
                    element.style.textAlign = '';
                    state.isAnimating = false;
                }, typewriterConfig.totalDuration + glitchTime + 100);
            }, typewriterConfig.startDelay);
        });
    }

    // Setup Intersection Observer
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.2 // Trigger when 20% of the element is visible
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const container = entry.target;
            if (entry.isIntersecting) {
                // Initial animation
                animateTypewriter(container);
                
                // Setup repeating interval if not already set
                if (!container._repeatIntervalId) {
                    container._repeatIntervalId = setInterval(() => {
                        animateTypewriter(container);
                    }, 10000); // Repeat every 10 seconds
                }
            } else {
                // Stop interval when not visible to save resources
                if (container._repeatIntervalId) {
                    clearInterval(container._repeatIntervalId);
                    container._repeatIntervalId = null;
                }
            }
        });
    }, observerOptions);

    function startObserving() {
        initFloatingText();
        floatingTexts.forEach(container => observer.observe(container));
    }

    if (document.body.classList.contains('is-loading')) {
        const bodyObserver = new MutationObserver((mutations) => {
            if (!document.body.classList.contains('is-loading')) {
                startObserving();
                bodyObserver.disconnect();
            }
        });
        bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } else {
        startObserving();
    }
})();

(function () {
    const canvas = document.getElementById('manifiesto-canvas');
    if (!canvas) return;

    const content = document.querySelector('.grid-frame-content');
    const ctx = canvas.getContext('2d');
    const SQUARE_SIZE = 25;
    const COLS = 8;
    const ROWS = 13;

    const GRID_WIDTH = COLS * SQUARE_SIZE;
    const GRID_HEIGHT = ROWS * SQUARE_SIZE;

    // Margins for the outer elements
    const PADDING = 80;

    canvas.width = GRID_WIDTH + PADDING * 2;
    canvas.height = GRID_HEIGHT + PADDING * 2;

    const startX = PADDING;
    const startY = PADDING;

    // Increase right padding when columns decrease so text stays inside the grid area
    if (content) {
        const BASE_COLS = 10;
        const BASE_RIGHT_PADDING = 30; // matches initial inline padding-right
        const extraRight = Math.max(0, (BASE_COLS - COLS) * SQUARE_SIZE * 0.6);
        content.style.paddingRight = `${Math.round(BASE_RIGHT_PADDING + extraRight)}px`;
    }

    // 1. Grid of transparent blue squares with faint yellow outlines
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.15)'; // Faint yellow (fainter)
    ctx.fillStyle = 'rgba(0, 100, 255, 0.05)'; // Transparent blue (fainter)
    ctx.lineWidth = 1;

    for (let i = 0; i < COLS; i++) {
        for (let j = 0; j < ROWS; j++) {
            const x = startX + i * SQUARE_SIZE;
            const y = startY + j * SQUARE_SIZE;
            ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);
            ctx.strokeRect(x, y, SQUARE_SIZE, SQUARE_SIZE);
        }
    }

    // 2. 4px outsetted from the grid are yellow lines that form a square without corners
    // (the lines stops 5px before meeting in the corner)
    const OUTSET_1 = 16; // Slightly tighter spacing between grid and outer lines
    const CORNER_GAP = 30;

    const frameX = startX - OUTSET_1;
    const frameY = startY - OUTSET_1;
    const frameW = GRID_WIDTH + OUTSET_1 * 2;
    const frameH = GRID_HEIGHT + OUTSET_1 * 2;

    ctx.strokeStyle = '#FFFF00'; // Yellow
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;

    ctx.beginPath();
    // Top line
    ctx.moveTo(frameX + CORNER_GAP, frameY);
    ctx.lineTo(frameX + frameW - CORNER_GAP, frameY);

    // Bottom line
    ctx.moveTo(frameX + CORNER_GAP, frameY + frameH);
    ctx.lineTo(frameX + frameW - CORNER_GAP, frameY + frameH);

    // Left line
    ctx.moveTo(frameX, frameY + CORNER_GAP);
    ctx.lineTo(frameX, frameY + frameH - CORNER_GAP);

    // Right line
    ctx.moveTo(frameX + frameW, frameY + CORNER_GAP);
    ctx.lineTo(frameX + frameW, frameY + frameH - CORNER_GAP);

    ctx.stroke();

    // 3. Rounded corners just outside the outer frame with a tighter, aligned gap.
    const OFFSET_2 = 14; // Minimal separation to keep corners hugging the frame
    const cornerX = frameX - OFFSET_2;
    const cornerY = frameY - OFFSET_2;
    const cornerW = frameW + OFFSET_2 * 2;
    const cornerH = frameH + OFFSET_2 * 2;
    const CORNER_LENGTH = 55; // Base corner leg length
    const CORNER_BIAS = Math.round(CORNER_LENGTH * 0.01); // Extra run along the clockwise side
    const CORNER_RADIUS = 38; // Balanced curve for the extended legs

    ctx.strokeStyle = '#FFFF00';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#FFFF00';
    ctx.shadowBlur = 10; // Glowing

    ctx.beginPath();

    // Top-Left Corner: base run down, arc, then extend along top (clockwise side)
    ctx.moveTo(cornerX, cornerY + CORNER_LENGTH);
    ctx.arcTo(cornerX, cornerY, cornerX + CORNER_LENGTH, cornerY, CORNER_RADIUS);
    ctx.lineTo(cornerX + CORNER_LENGTH + CORNER_BIAS, cornerY);

    // Top-Right Corner: base run along top, arc, then extend down (clockwise side)
    ctx.moveTo(cornerX + cornerW - CORNER_LENGTH, cornerY);
    ctx.arcTo(cornerX + cornerW, cornerY, cornerX + cornerW, cornerY + CORNER_LENGTH, CORNER_RADIUS);
    ctx.lineTo(cornerX + cornerW, cornerY + CORNER_LENGTH + CORNER_BIAS);

    // Bottom-Right Corner: base run down, arc, then extend left along bottom (clockwise side)
    ctx.moveTo(cornerX + cornerW, cornerY + cornerH - CORNER_LENGTH);
    ctx.arcTo(cornerX + cornerW, cornerY + cornerH, cornerX + cornerW - CORNER_LENGTH, cornerY + cornerH, CORNER_RADIUS);
    ctx.lineTo(cornerX + cornerW - CORNER_LENGTH - CORNER_BIAS, cornerY + cornerH);

    // Bottom-Left Corner: base run along bottom, arc, then extend up (clockwise side)
    ctx.moveTo(cornerX + CORNER_LENGTH, cornerY + cornerH);
    ctx.arcTo(cornerX, cornerY + cornerH, cornerX, cornerY + cornerH - CORNER_LENGTH, CORNER_RADIUS);
    ctx.lineTo(cornerX, cornerY + cornerH - CORNER_LENGTH - CORNER_BIAS);

    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;
})();

// Lazy load videos
(function() {
    const lazyVideos = document.querySelectorAll('video.lazy-video');
    if ('IntersectionObserver' in window) {
        const videoObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const video = entry.target;
                    video.play().catch(() => {});
                    observer.unobserve(video);
                }
            });
        });

        lazyVideos.forEach(video => {
            videoObserver.observe(video);
        });
    } else {
        lazyVideos.forEach(video => video.play().catch(() => {}));
    }
})();

// Auto-pause videos when out of view to reduce concurrent decoding
(function() {
    const vids = document.querySelectorAll('[data-autopause]');
    if (!('IntersectionObserver' in window) || !vids.length) return;

    vids.forEach((v) => {
        v.preload = 'metadata';
    });

    const allowsAutoplay = (target) => {
        if (target.id === 'poema-video') {
            return document.body.classList.contains('is-video-priority');
        }
        return true;
    };

    const obs = new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
            if (isIntersecting && allowsAutoplay(target)) {
                target.play?.().catch(() => {});
            } else {
                target.pause?.();
            }
        });
    }, { threshold: 0.35 });

    vids.forEach((v) => obs.observe(v));
})();

// Gate heavy media so the splat and Poema video never run simultaneously
(function() {
    const firstFloatingText = document.querySelector('.floating-text');
    const videoSection = document.getElementById('main-video-section');
    const video = document.getElementById('poema-video');
    if (!firstFloatingText || !videoSection || !video) return;

    // Trigger video mode slightly before the floating text fully leaves the viewport.
    // This makes the Poema section fade in earlier while scrolling.
    const VIDEO_PRIORITY_OFFSET = 0.5; // ~18% of viewport height from the top

    const body = document.body;
    let currentMode = null;

    const updateAria = (isVideoMode) => {
        videoSection.setAttribute('aria-hidden', isVideoMode ? 'false' : 'true');
        if (splatContainer) {
            splatContainer.setAttribute('aria-hidden', isVideoMode ? 'true' : 'false');
        }
    };

    const applyMode = (mode) => {
        if (currentMode === mode) return;
        currentMode = mode;
        const isVideoMode = mode === 'video';

        body.classList.toggle('is-video-priority', isVideoMode);
        body.classList.toggle('is-splat-priority', !isVideoMode);
        updateAria(isVideoMode);

        if (isVideoMode) {
            setSplatPaused(true);
        } else {
            setSplatPaused(false);
            video.pause();
        }
    };

    const computeMode = () => {
        const rect = firstFloatingText.getBoundingClientRect();
        const gateTopPx = (window.innerHeight || 0) * VIDEO_PRIORITY_OFFSET;
        return rect.bottom <= gateTopPx ? 'video' : 'splat';
    };

    const applyCurrentMode = () => applyMode(computeMode());

    if ('IntersectionObserver' in window) {
        // Shrink the observer root from the top so "not intersecting" occurs earlier
        // (i.e., when the floating text's bottom reaches ~18% of the viewport height).
        const gateTopPx = Math.round((window.innerHeight || 0) * VIDEO_PRIORITY_OFFSET);
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.target !== firstFloatingText) return;

                // Determine whether we've scrolled past the floating text relative to the
                // effective root top (accounts for rootMargin).
                const rootTop = entry.rootBounds?.top ?? 0;
                const passed = !entry.isIntersecting && entry.boundingClientRect.bottom <= rootTop;
                applyMode(passed ? 'video' : 'splat');
            });
        }, { threshold: 0, rootMargin: `-${gateTopPx}px 0px 0px 0px` });

        observer.observe(firstFloatingText);
        applyCurrentMode();
    } else {
        applyCurrentMode();
        window.addEventListener('scroll', applyCurrentMode, { passive: true });
    }
})();

// Fade down global audio when the YouTube iframe section is in view
(function() {
    const targetSection = document.getElementById('main-video-section');
    if (!targetSection) return;

    const FADE_MS = 700;
    let savedVolumes = null;
    let dimmed = false;
    let fadeId = null;

    const getLayers = () => window.audioLayers || {
        ambient: document.getElementById('audio-ambient'),
        music: document.getElementById('audio-music'),
        dialog: document.getElementById('audio-dialog')
    };

    const fadeTo = (targets) => {
        if (fadeId) cancelAnimationFrame(fadeId);
        const layers = getLayers();
        const start = performance.now();
        const startVolumes = {};

        Object.keys(targets).forEach((name) => {
            const layer = layers[name];
            startVolumes[name] = layer ? layer.volume : 0;
        });

        const step = (now) => {
            const t = Math.min((now - start) / FADE_MS, 1);
            Object.keys(targets).forEach((name) => {
                const layer = layers[name];
                if (!layer) return;
                const from = startVolumes[name];
                const to = targets[name];
                layer.volume = from + (to - from) * t;
            });

            if (t < 1) {
                fadeId = requestAnimationFrame(step);
            }
        };

        fadeId = requestAnimationFrame(step);
    };

    const dimAudio = () => {
        if (dimmed) return;
        const layers = getLayers();
        savedVolumes = {};
        Object.keys(layers).forEach((name) => {
            const layer = layers[name];
            if (layer) savedVolumes[name] = layer.volume;
        });

        const targets = {};
        Object.keys(savedVolumes).forEach((name) => { 
            // Keep ambient playing in the background, only dim music and dialog
            targets[name] = name === 'ambient' ? savedVolumes[name] : 0;
        });
        fadeTo(targets);
        dimmed = true;
    };

    const restoreAudio = () => {
        if (!dimmed || !savedVolumes) return;
        fadeTo(savedVolumes);
        dimmed = false;
    };

    const handleVisibilityFallback = () => {
        const rect = targetSection.getBoundingClientRect();
        const inView = rect.top < window.innerHeight * 0.75 && rect.bottom > window.innerHeight * 0.25;
        if (inView) {
            dimAudio();
        } else {
            restoreAudio();
        }
    };

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    dimAudio();
                } else {
                    restoreAudio();
                }
            });
        }, { threshold: 0.45 });

        observer.observe(targetSection);
    } else {
        handleVisibilityFallback();
        window.addEventListener('scroll', handleVisibilityFallback, { passive: true });
        window.addEventListener('resize', handleVisibilityFallback);
    }
})();

// Custom controls for the self-hosted Poema video
(function() {
    const video = document.getElementById('poema-video');
    const playBtn = document.getElementById('poema-play-toggle');
    const audioBtn = document.getElementById('poema-audio-toggle');
    if (!video || !playBtn || !audioBtn) return;

    const gateAllowsPlayback = () => document.body.classList.contains('is-video-priority');

    // Keep muted by default; start paused until fully in view
    video.muted = true;
    video.pause();
    video.currentTime = 0;

    const updatePlayLabel = () => {
        const playing = !video.paused && !video.ended;
        playBtn.textContent = playing ? 'Pausa' : 'Reproducir';
        playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    };

    const updateAudioLabel = () => {
        const muted = video.muted;
        audioBtn.textContent = muted ? 'Habilitar audio' : 'Deshabilitar audio';
        audioBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
    };

    playBtn.addEventListener('click', () => {
        if (video.paused || video.ended) {
            video.play().catch(() => {});
        } else {
            video.pause();
        }
        updatePlayLabel();
    });

    audioBtn.addEventListener('click', () => {
        video.muted = !video.muted;
        updateAudioLabel();
    });

    video.addEventListener('play', updatePlayLabel);
    video.addEventListener('pause', updatePlayLabel);
    video.addEventListener('ended', updatePlayLabel);

    const ensurePlayWhenVisible = () => {
        const section = document.getElementById('main-video-section');
        if (!section) return;

        const attemptPlay = () => {
            if (!gateAllowsPlayback()) return;
            if (video.paused) video.play().catch(() => {});
        };

        const attemptPause = () => {
            if (!video.paused) video.pause();
        };

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    const fullyInView = entry.intersectionRatio >= 0.9;
                    if (fullyInView) {
                        attemptPlay();
                    } else if (!entry.isIntersecting || entry.intersectionRatio < 0.5) {
                        attemptPause();
                    }
                });
            }, { threshold: [0, 0.5, 0.9] });
            observer.observe(section);
        } else {
            // Fallback: check once on load
            const rect = section.getBoundingClientRect();
            const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
            if (inView) {
                attemptPlay();
            } else {
                attemptPause();
            }
        }
    };

    ensurePlayWhenVisible();
    updatePlayLabel();
    updateAudioLabel();
})();


// Extracted scripts from index.html

// --------------------------------------------------
(function () {
            const cardImages = [
                'assets/cards_webp/aguara.webp',
                'assets/cards_webp/armado.webp',
                'assets/cards_webp/banderita.webp',
                'assets/cards_webp/camalote.webp',
                'assets/cards_webp/carancho.webp',
                'assets/cards_webp/cardenal.webp',
                'assets/cards_webp/carpintero.webp',
                'assets/cards_webp/ceibo.webp',
                'assets/cards_webp/chaja.webp',
                'assets/cards_webp/clavel.webp',
                'assets/cards_webp/culebra.webp',
                'assets/cards_webp/dorado.webp',
                'assets/cards_webp/efedra.webp',
                'assets/cards_webp/espinillo.webp',
                'assets/cards_webp/guazuncho.webp',
                'assets/cards_webp/malvavisco.webp',
                'assets/cards_webp/martin.webp',
                'assets/cards_webp/mburucuya.webp',
                'assets/cards_webp/murcielago.webp',
                'assets/cards_webp/ombu.webp',
                'assets/cards_webp/pacu.webp',
                'assets/cards_webp/paloma.webp',
                'assets/cards_webp/palometa.webp',
                'assets/cards_webp/rana.webp',
                'assets/cards_webp/raya.webp',
                'assets/cards_webp/salvia.webp',
                'assets/cards_webp/suelda.webp',
                'assets/cards_webp/surubi.webp',
                'assets/cards_webp/tembetari.webp',
                'assets/cards_webp/tortuga.webp',
                'assets/cards_webp/vieja.webp',
                'assets/cards_webp/viraro.webp',
                'assets/cards_webp/yacare.webp',
                'assets/cards_webp/yaguarundi.webp',
                'assets/cards_webp/yarara.webp',
                'assets/cards_webp/yatei.webp',
                'assets/cards_webp/yesquero.webp'
            ];

            function shuffle(arr) {
                const a = arr.slice();
                for (let i = a.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [a[i], a[j]] = [a[j], a[i]];
                }
                return a;
            }

            let speciesData = [];
            const audioOpen = new Audio('game-assets/recorrido/sonido/metadata_popup.mp3');
            const audioClose = new Audio('game-assets/recorrido/sonido/metadata_cierre.mp3');
            audioOpen.volume = 0.4;
            audioClose.volume = 0.5;

            // Mapping for card names to actual species IDs (for underwater species)
            const cardToSpeciesMap = {
                'surubi': 'surubi_pintado',
                'armado': 'armado_chancho',
                'palometa': 'palometa_brava',
                'raya': 'raya_negra',
                'vieja': 'vieja_del_agua',
                'pacu': 'pacu',
                'dorado': 'dorado',
                'sabalo': 'sabalo'
            };

            // Glitch animation variables
            let typeWriterTimeout = null;
            let typeWriterInterval = null;
            const glitchChars = "!@#$%^&*()_+-=[]{}|;':\",./<>?~`abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

            const getRandomGlitchChar = () => glitchChars[Math.floor(Math.random() * glitchChars.length)];

            const getPlainTextLength = (html) => {
                const temp = document.createElement('div');
                temp.innerHTML = html;
                return temp.textContent.length;
            };

            const getPartialHTML = (html, charCount) => {
                const temp = document.createElement('div');
                temp.innerHTML = html;
                let count = 0;

                const walk = (node, maxChars) => {
                    if (count >= maxChars) return '';
                    if (node.nodeType === Node.TEXT_NODE) {
                        const remaining = maxChars - count;
                        const text = node.textContent.substring(0, remaining);
                        count += text.length;
                        return text;
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        const tagName = node.tagName.toLowerCase();
                        let result = `<${tagName}>`;
                        for (let child of node.childNodes) {
                            if (count >= maxChars) break;
                            result += walk(child, maxChars);
                        }
                        result += `</${tagName}>`;
                        return result;
                    }
                    return '';
                };

                let result = '';
                for (let child of temp.childNodes) {
                    if (count >= charCount) break;
                    result += walk(child, charCount);
                }
                return result;
            };

            const isVideoPixelTransparent = (videoElement, event) => {
                if (!videoElement || videoElement.readyState < 2) return false;

                const rect = videoElement.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = videoElement.videoWidth;
                canvas.height = videoElement.videoHeight;

                context.drawImage(videoElement, 0, 0);

                const scaleX = videoElement.videoWidth / rect.width;
                const scaleY = videoElement.videoHeight / rect.height;
                const pixelX = Math.floor(x * scaleX);
                const pixelY = Math.floor(y * scaleY);

                const pixelData = context.getImageData(pixelX, pixelY, 1, 1).data;
                const alpha = pixelData[3];

                return alpha < 128;
            };

            // Fetch species data (land + fish)
            let speciesDataPromise = Promise.all([
                fetch('game/data/especies.json').then(r => r.json()),
                fetch('game/data/fish_species.json').then(r => r.json()).catch(() => ({ species: [] }))
            ])
                .then(([land, fish]) => {
                    const landSpecies = land?.species || [];
                    const fishSpecies = fish?.species || [];
                    speciesData = [...landSpecies, ...fishSpecies];
                })
                .catch(err => console.error('Error loading species data:', err));

            async function openVideoOverlay(src, speciesId) {
                const overlay = document.getElementById('video-overlay');
                const video = document.getElementById('overlay-video');
                const textOverlay = document.getElementById('overlay-text');

                if (!overlay || !video) return;

                const startTypewriter = (fullText) => {
                    if (!textOverlay) return;

                    textOverlay.innerHTML = '';
                    textOverlay.classList.add('is-visible');

                    if (typeWriterTimeout) clearTimeout(typeWriterTimeout);
                    if (typeWriterInterval) clearInterval(typeWriterInterval);

                    typeWriterTimeout = setTimeout(() => {
                        const totalChars = getPlainTextLength(fullText);
                        let currentIndex = 0;

                        typeWriterInterval = setInterval(() => {
                            if (currentIndex <= totalChars) {
                                let displayText = getPartialHTML(fullText, currentIndex);
                                const glitchCount = Math.min(3, totalChars - currentIndex);
                                for (let i = 0; i < glitchCount; i++) {
                                    displayText += `<span style="opacity: 0.6; animation: glitch-flicker 0.1s infinite;">${getRandomGlitchChar()}</span>`;
                                }
                                textOverlay.innerHTML = displayText;
                                currentIndex++;
                            } else {
                                textOverlay.innerHTML = fullText;
                                clearInterval(typeWriterInterval);
                            }
                        }, 5);
                    }, 3000);
                };

                // Clear any existing animations
                if (typeWriterTimeout) clearTimeout(typeWriterTimeout);
                if (typeWriterInterval) clearInterval(typeWriterInterval);

                video.src = src;
                video.play().catch(e => console.error("Video play failed:", e));

                overlay.classList.add('is-visible');
                overlay.setAttribute('aria-hidden', 'false');

                // Play sound
                audioOpen.currentTime = 0;
                audioOpen.play().catch(e => console.log('Audio play failed', e));

                // Populate text if data exists
                if (textOverlay && speciesId) {
                    // Ensure species data loaded
                    if (typeof speciesDataPromise !== 'undefined') {
                        try { await speciesDataPromise; } catch (e) { /* ignore */ }
                    }

                    const info = speciesData.find(s => s.id === speciesId);
                    if (info && info.text) {
                        video.playbackRate = info.dataVideoSpeed || 0.5;
                        startTypewriter(info.text);
                    } else {
                        // Fallback: load legacy txt and wrap in <p> for consistent formatting
                        video.playbackRate = info?.dataVideoSpeed || 0.5;
                        const infoPath = `game-assets/sub/data_videos/${speciesId}.txt`;
                        fetch(infoPath)
                            .then(res => res.ok ? res.text() : '')
                            .then(text => {
                                if (!text) {
                                    textOverlay.classList.remove('is-visible');
                                    textOverlay.innerHTML = '';
                                    return;
                                }
                                const fullText = text
                                    .split(/\n\n+/)
                                    .map(p => p.trim())
                                    .filter(Boolean)
                                    .map(p => `<p>${p}</p>`)
                                    .join('');
                                startTypewriter(fullText);
                            })
                            .catch(() => {
                                textOverlay.classList.remove('is-visible');
                                textOverlay.innerHTML = '';
                            });
                    }
                } else if (textOverlay) {
                    video.playbackRate = 0.5;
                    textOverlay.classList.remove('is-visible');
                    textOverlay.innerHTML = '';
                }

                // Close on click outside
                overlay.onclick = (e) => {
                    if (e.target === overlay) {
                        closeVideoOverlay();
                    }
                };

                // Close on transparent pixel click
                video.onclick = (e) => {
                    if (isVideoPixelTransparent(video, e)) {
                        closeVideoOverlay();
                    }
                };
            }

            function openInfoOnlyOverlay(speciesId) {
                const overlay = document.getElementById('video-overlay');
                const video = document.getElementById('overlay-video');
                const textOverlay = document.getElementById('overlay-text');

                if (!overlay || !video || !textOverlay) return;

                // Clear any existing animations
                if (typeWriterTimeout) clearTimeout(typeWriterTimeout);
                if (typeWriterInterval) clearInterval(typeWriterInterval);

                // Map card name to actual species ID (for underwater species)
                const actualSpeciesId = cardToSpeciesMap[speciesId] || speciesId;

                // Hide video, show overlay with image
                video.src = '';
                video.style.display = 'none';

                // Create or get image element for species
                let speciesImg = overlay.querySelector('.species-info-image');
                if (!speciesImg) {
                    speciesImg = document.createElement('img');
                    speciesImg.className = 'species-info-image';
                    speciesImg.style.cssText = `
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        max-width: 40%;
                        max-height: 50vh;
                        object-fit: contain;
                        z-index: 1;
                        pointer-events: none;
                    `;
                    overlay.querySelector('div').appendChild(speciesImg);
                }

                // Load species image
                const imagePath = `game-assets/sub/completed_fish_data/${actualSpeciesId}.png`;
                speciesImg.src = imagePath;
                speciesImg.style.display = 'block';

                overlay.classList.add('is-visible');
                overlay.setAttribute('aria-hidden', 'false');

                // Play sound
                audioOpen.currentTime = 0;
                audioOpen.play().catch(e => console.log('Audio play failed', e));

                // Position text overlay to the right or below image
                textOverlay.style.position = 'absolute';
                textOverlay.style.right = '5%';
                textOverlay.style.top = '50%';
                textOverlay.style.transform = 'translateY(-50%)';
                textOverlay.style.width = '45%';

                // Get species info from especies.json or fetch from sub species data
                const info = speciesData.find(s => s.id === actualSpeciesId);
                
                if (info && info.text) {
                    // Show text with typewriter effect
                    textOverlay.innerHTML = '';
                    textOverlay.classList.add('is-visible');
                    textOverlay.style.background = 'rgba(0, 0, 0, 0.85)';
                    textOverlay.style.padding = '2rem';
                    textOverlay.style.borderRadius = '8px';
                    textOverlay.style.maxHeight = '80vh';
                    textOverlay.style.overflow = 'auto';

                    typeWriterTimeout = setTimeout(() => {
                        const fullText = info.text;
                        const totalChars = getPlainTextLength(fullText);
                        let currentIndex = 0;

                        typeWriterInterval = setInterval(() => {
                            if (currentIndex <= totalChars) {
                                let displayText = getPartialHTML(fullText, currentIndex);
                                const glitchCount = Math.min(3, totalChars - currentIndex);
                                for (let i = 0; i < glitchCount; i++) {
                                    displayText += `<span style="opacity: 0.6; animation: glitch-flicker 0.1s infinite;">${getRandomGlitchChar()}</span>`;
                                }
                                textOverlay.innerHTML = displayText;
                                currentIndex++;
                            } else {
                                textOverlay.innerHTML = fullText;
                                clearInterval(typeWriterInterval);
                            }
                        }, 5);
                    }, 500); // Start immediately (shorter delay)
                } else {
                    // Try to fetch info from sub species data (for underwater species)
                    const infoPath = `game-assets/sub/completed_fish_data/${actualSpeciesId}.txt`;
                    
                    fetch(infoPath)
                        .then(response => {
                            if (response.ok) return response.text();
                            throw new Error('Info not found');
                        })
                        .then(text => {
                            textOverlay.innerHTML = '';
                            textOverlay.classList.add('is-visible');
                            textOverlay.style.background = 'rgba(0, 0, 0, 0.85)';
                            textOverlay.style.padding = '2rem';
                            textOverlay.style.borderRadius = '8px';
                            textOverlay.style.maxHeight = '80vh';
                            textOverlay.style.overflow = 'auto';
                            textOverlay.style.whiteSpace = 'pre-wrap';

                            // Convert plain text to HTML paragraphs (only for final display)
                            const formattedText = text.split('\n\n').map(para => `<p>${para}</p>`).join('');
                            
                            typeWriterTimeout = setTimeout(() => {
                                const totalChars = text.length;
                                let currentIndex = 0;

                                typeWriterInterval = setInterval(() => {
                                    if (currentIndex <= totalChars) {
                                        // Display as plain text during animation to avoid partial HTML tags
                                        const displayText = text.substring(0, currentIndex);
                                        const glitchCount = Math.min(3, totalChars - currentIndex);
                                        let glitchChars = '';
                                        for (let i = 0; i < glitchCount; i++) {
                                            glitchChars += getRandomGlitchChar();
                                        }
                                        textOverlay.textContent = displayText + glitchChars;
                                        currentIndex++;
                                    } else {
                                        // At the end, show formatted HTML
                                        textOverlay.style.whiteSpace = 'normal';
                                        textOverlay.innerHTML = formattedText;
                                        clearInterval(typeWriterInterval);
                                    }
                                }, 5);
                            }, 500);
                        })
                        .catch(err => {
                            console.error('Failed to load species info:', err);
                            textOverlay.innerHTML = '<p>Información no disponible para esta especie.</p>';
                            textOverlay.classList.add('is-visible');
                            textOverlay.style.background = 'rgba(0, 0, 0, 0.85)';
                            textOverlay.style.padding = '2rem';
                            textOverlay.style.borderRadius = '8px';
                        });
                }

                // Close on click
                overlay.onclick = (e) => {
                    if (e.target === overlay) {
                        closeVideoOverlay();
                    }
                };
            }

            function closeVideoOverlay() {
                const overlay = document.getElementById('video-overlay');
                const video = document.getElementById('overlay-video');
                const textOverlay = document.getElementById('overlay-text');

                if (!overlay || !video) return;

                // Show video again in case it was hidden
                video.style.display = '';

                // Hide species image if it exists
                const speciesImg = overlay.querySelector('.species-info-image');
                if (speciesImg) {
                    speciesImg.style.display = 'none';
                }

                // Reset text overlay styles
                if (textOverlay) {
                    textOverlay.style.position = '';
                    textOverlay.style.right = '';
                    textOverlay.style.top = '';
                    textOverlay.style.transform = '';
                    textOverlay.style.width = '';
                }

                // Clear animations
                if (typeWriterTimeout) clearTimeout(typeWriterTimeout);
                if (typeWriterInterval) clearInterval(typeWriterInterval);

                video.pause();
                video.src = '';
                video.onclick = null; // Remove listener
                overlay.classList.remove('is-visible');
                overlay.setAttribute('aria-hidden', 'true');

                if (textOverlay) {
                    textOverlay.classList.remove('is-visible');
                    textOverlay.innerHTML = '';
                }

                // Play close sound
                audioClose.currentTime = 0;
                audioClose.play().catch(e => console.log('Audio play failed', e));
            }

            function renderCards() {
                const rows = [
                    document.getElementById('cards-row-top'),
                    document.getElementById('cards-row-bottom')
                ].filter(Boolean);

                if (!rows.length || !cardImages.length) return;

                const isMobile = window.innerWidth <= 768;
                const count = isMobile ? 3 : 8;
                const picks = shuffle(cardImages).slice(0, count);

                // Clear existing
                rows.forEach(row => row.innerHTML = '');

                if (isMobile) {
                    // Mobile: all 3 in the first row, clicks enabled
                    const row = rows[0];
                    picks.forEach(src => {
                        const card = createCardElement(src, false);
                        row.appendChild(card);
                    });
                } else {
                    // Desktop: 4 per row
                    rows.forEach((row, rowIndex) => {
                        const start = rowIndex * 4;
                        const end = start + 4;
                        picks.slice(start, end).forEach((src) => {
                            const card = createCardElement(src, false);
                            row.appendChild(card);
                        });
                    });
                }
            }

            function createCardElement(src, disableClick) {
                const card = document.createElement('div');
                card.className = 'card-item';
                card.style.cursor = disableClick ? 'default' : 'pointer';

                const img = document.createElement('img');
                img.src = src;
                img.alt = 'Carta del Delta';
                img.loading = 'lazy';

                card.appendChild(img);

                if (!disableClick) {
                    card.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const filename = src.split('/').pop();
                        const species = filename.split('.')[0];
                        // Map to actual species id when needed (e.g., underwater fish)
                        const actualSpeciesId = cardToSpeciesMap[species] || species;

                        const candidateVideos = [
                            // New fish/underwater data videos live here
                            `game-assets/sub/data_videos/${actualSpeciesId}_data.webm`,
                            // Fallback to the original path used by land species
                            `game-assets/recorrido/criaturas/${actualSpeciesId}/${actualSpeciesId}_data.webm`
                        ];

                        // Try each candidate video path until one exists
                        (async () => {
                            for (const videoPathWebm of candidateVideos) {
                                const videoPath = getVideoSource(videoPathWebm);
                                if (!videoPath) continue; // Skip if browser doesn't support
                                try {
                                    const res = await fetch(videoPath, { method: 'HEAD' });
                                    const type = res.headers.get('content-type') || '';
                                    if (res.ok && type.startsWith('video/')) {
                                        openVideoOverlay(videoPath, actualSpeciesId);
                                        return;
                                    }
                                } catch (err) {
                                    // Continue to next candidate
                                }
                            }
                            console.warn('No video found for species:', actualSpeciesId);
                            openInfoOnlyOverlay(species);
                        })();
                    });
                }

                return card;
            }

            document.addEventListener('DOMContentLoaded', renderCards);

            // Re-render on resize if crossing breakpoint
            let wasMobile = window.innerWidth <= 768;
            window.addEventListener('resize', () => {
                const isMobile = window.innerWidth <= 768;
                if (isMobile !== wasMobile) {
                    wasMobile = isMobile;
                    renderCards();
                }
            });
        })();

// --------------------------------------------------
// "Contenidos" material button: download both PDFs on click
        (() => {
            const contenidosBtn = document.querySelector('.material-buttons-container .material-button[href="#"]');
            if (!contenidosBtn) return;

            const pdfs = [
                { href: 'assets/pdfs/Actividades%20Primario.pdf', filename: 'Actividades Primario.pdf' },
                { href: 'assets/pdfs/Actividades%20Secundario.pdf', filename: 'Actividades Secundario.pdf' }
            ];

            const triggerDownload = (href, filename) => {
                const link = document.createElement('a');
                link.href = href;
                link.download = filename;
                link.rel = 'noopener';
                document.body.appendChild(link);
                link.click();
                link.remove();
            };

            contenidosBtn.addEventListener('click', (event) => {
                event.preventDefault();
                pdfs.forEach(({ href, filename }) => triggerDownload(href, filename));
            });
        })();

// --------------------------------------------------
// Show the down arrow after a brief delay to hint scrolling
        (function () {
            const indicator = document.getElementById('scroll-indicator');
            const SHOW_DELAY_MS = 3000;
            if (!indicator) return;

            function reveal() { indicator.classList.add('is-visible'); }

            function startTimer() {
                setTimeout(reveal, SHOW_DELAY_MS);
            }

            window.addEventListener('dg:entry-ui', startTimer, { once: true });
        })();

// --------------------------------------------------
// Make the scroll indicator clickable: scroll one screen down
        (function () {
            const indicator = document.getElementById('scroll-indicator');
            if (!indicator) return;

            const prefersReducedMotion = typeof window !== 'undefined'
                && window.matchMedia
                && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            const scrollDownOneScreen = () => {
                try {
                    window.scrollBy({
                        top: window.innerHeight,
                        left: 0,
                        behavior: prefersReducedMotion ? 'auto' : 'smooth'
                    });
                } catch {
                    // Older browsers
                    window.scrollBy(0, window.innerHeight);
                }
            };

            indicator.addEventListener('click', scrollDownOneScreen);
        })();

// --------------------------------------------------
const WELCOME_THEME = {
            fontKitHref: 'https://use.typekit.net/vmy8ypx.css',
            fonts: {
                family: `"new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`
            },
            colors: {
                text: '#FBFE5E',
                textShadow: 'rgba(0, 0, 0, 0.45)'
            }
        };

        window.showWelcomeSequence = async function (onComplete) {
            // Load font
            if (!document.getElementById('efedra-transition-font')) {
                const link = document.createElement('link');
                link.id = 'efedra-transition-font';
                link.rel = 'stylesheet';
                link.href = WELCOME_THEME.fontKitHref;
                document.head.appendChild(link);
            }

            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'welcome-overlay';
            overlay.style.cssText = `
                position: fixed;
                inset: 0;
                z-index: 100001;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                pointer-events: auto;
                opacity: 0;
                transition: opacity 0.5s ease;
                background: #000;
            `;
            document.body.appendChild(overlay);

            // Background video
            const bgVideo = document.createElement('video');
            const bgVideoSrc = getVideoSource('assets/web-bgs/web-bg01.webm', { hideIfUnsupported: true });
            if (bgVideoSrc) {
                bgVideo.src = bgVideoSrc;
            }
            bgVideo.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                object-fit: cover;
                opacity: 0.6;
            `;
            bgVideo.muted = true;
            bgVideo.playsInline = true;
            bgVideo.loop = true;
            bgVideo.autoplay = true;

            bgVideo.onerror = () => {
                console.warn('Video failed to load, falling back to image');
                bgVideo.style.display = 'none';
                overlay.style.backgroundImage = "url('assets/web-bgs/D+fondo_para_web_01.webp')";
                overlay.style.backgroundSize = 'cover';
                overlay.style.backgroundPosition = 'center';
            };

            overlay.appendChild(bgVideo);

            try {
                await bgVideo.play();
            } catch (e) {
                console.warn('Video play failed', e);
            }

            // Scale logic - Simplified for better mobile readability
            // We won't scale the text container, but we will use responsive units
            const updateScale = () => {
                // No-op for text container to allow responsive CSS to work
                // We might want to scale other elements if needed, but for now let's rely on CSS
            };
            window.addEventListener('resize', updateScale);

            // Text Container
            const textContainer = document.createElement('div');
            textContainer.style.cssText = `
                position: absolute;
                inset: 0;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 0 20px;
                z-index: 10002;
            `;
            overlay.appendChild(textContainer);

            // Skip Button
            const skipButton = document.createElement('button');
            skipButton.textContent = 'SALTEAR';
            skipButton.style.cssText = `
                position: absolute;
                top: 20px;
                right: 20px;
                padding: 12px 24px;
                background: rgba(255, 201, 106, 0.15);
                border: 2px solid ${WELCOME_THEME.colors.text};
                color: ${WELCOME_THEME.colors.text};
                font-family: ${WELCOME_THEME.fonts.family};
                font-size: 14px;
                font-weight: bold;
                letter-spacing: 0.08em;
                cursor: pointer;
                z-index: 10004;
                pointer-events: auto;
                text-shadow: 0 0 14px ${WELCOME_THEME.colors.textShadow};
                transition: all 0.3s ease;
            `;

            skipButton.addEventListener('mouseenter', () => {
                skipButton.style.background = `rgba(255, 201, 106, 0.35)`;
                skipButton.style.transform = `scale(1.05)`;
            });
            skipButton.addEventListener('mouseleave', () => {
                skipButton.style.background = `rgba(255, 201, 106, 0.15)`;
                skipButton.style.transform = `scale(1)`;
            });

            let skipRequested = false;
            skipButton.addEventListener('click', (e) => {
                e.stopPropagation();
                skipRequested = true;
            });
            overlay.appendChild(skipButton);

            // Click Indicator
            const clickIndicator = document.createElement('div');
            clickIndicator.className = 'welcome-click-indicator';
            clickIndicator.style.cssText = `
                position: absolute;
                bottom: 10%;
                left: 50%;
                transform: translateX(-50%);
                color: ${WELCOME_THEME.colors.text};
                font-family: ${WELCOME_THEME.fonts.family};
                font-size: 0.95em;
                text-align: center;
                text-shadow: 0 0 14px ${WELCOME_THEME.colors.textShadow};
                z-index: 10003;
                opacity: 0;
                transition: opacity 0.5s ease;
                pointer-events: none;
                width: 100%;
            `;
            clickIndicator.innerHTML = `
                <span style="display:inline-block; letter-spacing:0.04em;">Click para continuar</span>
            `;
            overlay.appendChild(clickIndicator);

            // Add styles for animations
            if (!document.getElementById('welcome-anim-style')) {
                const style = document.createElement('style');
                style.id = 'welcome-anim-style';
                style.textContent = `
                    @keyframes clickFloat {
                        0%,100% { transform: translate(-50%, 0); }
                        50% { transform: translate(-50%, -6px); }
                    }
                    @keyframes rippleGrow {
                        0% { transform: translate(-50%, 0) scale(0.7); opacity: 0.35; }
                        70% { opacity: 0.08; }
                        100% { transform: translate(-50%, 0) scale(1.25); opacity: 0; }
                    }
                    .welcome-click-indicator { animation: clickFloat 2.8s ease-in-out infinite; }
                    .welcome-click-indicator .efedra-ripple.r1 { animation: rippleGrow 2.8s ease-in-out infinite; animation-delay: .0s; }
                    .welcome-click-indicator .efedra-ripple.r2 { animation: rippleGrow 2.8s ease-in-out infinite; animation-delay: 1.4s; }

                    /* Entrada/salida más suave */
                    @keyframes fadeWaveIn {
                        from { opacity: 0; transform: translateY(24px); filter: blur(4px); }
                        to { opacity: 0.98; transform: translateY(0); filter: blur(0); }
                    }
                    @keyframes fadeWaveOut {
                        from { opacity: 1; transform: translateY(0); }
                        to { opacity: 0; transform: translateY(-26px); }
                    }

                    /* Ondas por carácter */
                    @keyframes charWave {
                        0%, 100% { transform: translateY(0); }
                        50% { transform: translateY(var(--waveAmp, 6px)); }
                    }
                `;
                document.head.appendChild(style);
            }

            // Initial scale update
            updateScale();

            // Show overlay
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
            });

            const lines = [
                "Bienvenidx a Delta Grande, un ecosistema digital donde podés explorar el Delta del Paraná a través de juegos, recorridos interactivos, microdocumentales, paisajes 3D, voces y sonidos del territorio.",
                "Acá vas a descubrir la vida del Delta desde una experiencia que combina arte, ciencia y tecnología, y que te permitirá recorrerlo sin dejar huella: jugar, aprender y sumergirte en uno de los ecosistemas más singulares de Sudamérica."
            ];

            const currentLineContainer = document.createElement('div');
            currentLineContainer.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 90%;
                max-width: 1200px;
                text-align: center;
            `;
            textContainer.appendChild(currentLineContainer);

            for (let i = 0; i < lines.length; i++) {
                if (skipRequested) break;
                const line = lines[i];

                currentLineContainer.innerHTML = '';
                currentLineContainer.style.opacity = '1';

                const lineElement = document.createElement('div');
                lineElement.style.cssText = `
                    color: ${WELCOME_THEME.colors.text};
                    font-family: ${WELCOME_THEME.fonts.family};
                    font-size: clamp(24px, 2.5vw, 30px);
                    line-height: 1.5;
                    text-shadow: 0 0 14px ${WELCOME_THEME.colors.textShadow};
                    animation: fadeWaveIn 0.6s ease-out forwards;
                `;
                currentLineContainer.appendChild(lineElement);

                // Build spans per word for wave animation
                const spans = [];
                const parts = line.split(/(\n)/);

                for (const part of parts) {
                    if (part === '\n') {
                        lineElement.appendChild(document.createElement('br'));
                    } else {
                        const words = part.split(' ');
                        for (let w = 0; w < words.length; w++) {
                            const wordText = words[w];
                            if (!wordText) continue;

                            const s = document.createElement('span');
                            s.textContent = wordText;
                            s.style.display = 'inline-block';
                            s.style.opacity = '0';
                            s.style.transform = 'translateY(10px)';
                            s.style.filter = 'blur(3px)';
                            s.style.transition = 'opacity 220ms ease-out, transform 360ms ease-out, filter 480ms ease-out';
                            s.style.willChange = 'transform, opacity, filter';

                            // Continuous wave animation once revealed
                            s.style.setProperty('--waveAmp', '5px');
                            s.style.animation = `charWave 2800ms ease-in-out ${spans.length * 150}ms infinite`;

                            lineElement.appendChild(s);
                            spans.push(s);

                            // Add space after word
                            if (w < words.length - 1) {
                                lineElement.appendChild(document.createTextNode(' '));
                            }
                        }
                    }
                }

                let isTyping = true;
                let skipTyping = false;
                let advanceToNext = false;

                // Show click indicator
                clickIndicator.style.opacity = '1';

                const clickHandler = () => {
                    if (isTyping) {
                        skipTyping = true;
                    } else {
                        advanceToNext = true;
                    }
                };
                overlay.addEventListener('click', clickHandler);

                // Typewriter effect
                for (let j = 0; j < spans.length; j++) {
                    if (skipRequested) {
                        skipTyping = true;
                    }

                    if (skipTyping) {
                        for (let k = 0; k < spans.length; k++) {
                            const el = spans[k];
                            el.style.opacity = '1';
                            el.style.transform = 'translateY(0)';
                            el.style.filter = 'blur(0)';
                        }
                        break;
                    }

                    const el = spans[j];
                    el.style.opacity = '1';
                    el.style.transform = 'translateY(0)';
                    el.style.filter = 'blur(0)';

                    let delay = 100;
                    const wordText = el.textContent;
                    const lastChar = wordText[wordText.length - 1];

                    if (lastChar === ',' || lastChar === ';') delay = 300;
                    else if (lastChar === '.' || lastChar === ':') delay = 500;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                isTyping = false;

                if (skipRequested) {
                    advanceToNext = true;
                }

                if (!skipRequested) {
                    await new Promise(resolve => setTimeout(resolve, 400));
                }

                if (!advanceToNext && !skipRequested) {
                    await new Promise(resolve => {
                        const checkAdvance = setInterval(() => {
                            if (advanceToNext || skipRequested) {
                                clearInterval(checkAdvance);
                                resolve();
                            }
                        }, 50);
                    });
                }

                overlay.removeEventListener('click', clickHandler);

                if (i < lines.length - 1) {
                    clickIndicator.style.opacity = '0';
                    currentLineContainer.style.transition = 'opacity 0.3s ease';
                    currentLineContainer.style.opacity = '0';
                    await new Promise(resolve => setTimeout(resolve, 300));
                } else {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }

            // Cleanup
            if (onComplete) onComplete();

            // Small delay to ensure loader is hidden behind the overlay before fading out overlay
            await new Promise(r => setTimeout(r, 100));

            overlay.style.transition = 'opacity 2s ease'; // Slower fade out
            overlay.style.opacity = '0';

            // Trigger fade-in of selector and manifesto after 3 seconds
            setTimeout(() => {
                const selector = document.querySelector('.sound-selector');
                const manifesto = document.querySelector('.manifiesto-item');
                if (selector) selector.classList.add('is-visible');
                if (manifesto) manifesto.classList.add('is-visible');
            }, 3000);

            setTimeout(() => {
                if (document.body.contains(overlay)) {
                    document.body.removeChild(overlay);
                }
                window.removeEventListener('resize', updateScale);
            }, 2000); // Wait for the 2s transition
        };

// --------------------------------------------------
// Display the loader for 4 seconds, fade to black, hold 2 seconds, then reveal the page
        (function () {
            // Force scroll to top on every load and prevent browser scroll restoration
            if ('scrollRestoration' in history) {
                history.scrollRestoration = 'manual';
            }
            window.scrollTo(0, 0);

            const loader = document.getElementById('page-loader');
            const loaderVideo = loader ? loader.querySelector('video') : null;
            const loaderCounter = document.getElementById('loader-counter');
            const body = document.body;
            const entryGate = document.getElementById('entry-gate');
            const entryButton = document.getElementById('entry-button');
            const floatingIsland = document.querySelector('.floating-island');
            const birdsOverlay = document.getElementById('birds-overlay');
            const birdsVideo = document.getElementById('birds-video');
            const disableBirds = !browserInfo.supportsWebMAlpha; // Safari cannot show WebM alpha
            const splatContainer = document.getElementById('splat-container');
            const sparkCanvas = document.getElementById('spark-canvas');
            const sparkCtx = sparkCanvas ? sparkCanvas.getContext('2d') : null;
            const MIN_DISPLAY_MS = 4000;
            const BLACKOUT_FADE_MS = 800;
            const BLACKOUT_HOLD_MS = 2000;
            const FALLBACK_REVEAL_MS = MIN_DISPLAY_MS + BLACKOUT_FADE_MS + BLACKOUT_HOLD_MS + 2000;
            let loaderHidden = false;
            let revealStarted = false;
            let entryStarted = false;
            let uiRevealed = false;

            const startLoaderCounter = () => {
                if (!loaderCounter) return;
                const start = performance.now();
                const duration = MIN_DISPLAY_MS;
                const step = (now) => {
                    if (loaderHidden) return;
                    const pct = Math.min(100, Math.round(((now - start) / duration) * 100));
                    loaderCounter.textContent = `${pct}%`;
                    loaderCounter.setAttribute('aria-label', `Cargando ${pct}%`);
                    if (pct < 100) requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
            };

            if (disableBirds && birdsOverlay) {
                birdsOverlay.style.display = 'none';
            }

            startLoaderCounter();

            const sparkState = {
                running: false,
                raf: 0,
                lastTs: 0,
                squares: [],
                dots: [],
                resizeHandler: null,
                angleY: 0,
                targetAngleY: 0
            };

            // Allow other scripts (drag handler) to push yaw rotations
            window.dgSetSparkYaw = (delta) => {
                sparkState.targetAngleY += delta;
            };

            const resizeSparkCanvas = () => {
                if (!sparkCanvas || !sparkCtx) return;
                const ratio = window.devicePixelRatio || 1;
                const width = splatContainer?.clientWidth || sparkCanvas.clientWidth || sparkCanvas.parentElement?.clientWidth || 0;
                const height = splatContainer?.clientHeight || sparkCanvas.clientHeight || sparkCanvas.parentElement?.clientHeight || 0;
                sparkCanvas.width = width * ratio;
                sparkCanvas.height = height * ratio;
                sparkCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
            };

            const startSparks = () => {
                if (!sparkCanvas || !sparkCtx || sparkState.running) return;
                resizeSparkCanvas();
                sparkState.running = true;
                sparkState.lastTs = 0;

                const spawnSquare = (width, height) => {
                    // Spawn in an ellipse, with depth for pseudo-3D
                    const rx = width * 0.2184; // +20% radius
                    const ry = Math.max(height * 0.155, width * 0.09);  // Scale with width on wide screens
                    const rz = Math.max(width, height) * 0.2; // depth range
                    const ang = Math.random() * Math.PI * 2;
                    const rad = Math.sqrt(Math.random());
                    const x = Math.cos(ang) * rx * rad;
                    const y = (Math.random() - 0.688) * ry; // lift higher (~+44% from original)
                    const z = Math.random() * rz; // 0 front, rz back
                    const speed = 18 + Math.random() * 16;
                    // Random unit direction for free flight
                    const dirTheta = Math.random() * Math.PI * 2;
                    const dirPhi = Math.acos(2 * Math.random() - 1);
                    const dx = Math.sin(dirPhi) * Math.cos(dirTheta);
                    const dy = Math.cos(dirPhi);
                    const dz = Math.sin(dirPhi) * Math.sin(dirTheta);
                    // Scale size based on width, uncapped for wide screens
                    const viewportScale = width / 1600;
                    const size = (6 + Math.random() * 10) * Math.max(0.7, viewportScale);
                    const colors = ['rgba(251, 254, 94, 1)', 'rgba(255, 255, 255, 1)', 'rgba(76, 91, 255, 1)'];
                    const life = 1.1 + Math.random() * 0.9;
                    sparkState.squares.push({
                        x,
                        y,
                        z,
                        vx: dx * speed,
                        vy: dy * speed,
                        vz: dz * speed,
                        size,
                        color: colors[Math.floor(Math.random() * colors.length)],
                        life,
                        ttl: life
                    });
                };

                const spawnDot = (width, height) => {
                    const rx = width * 0.2184; // +20% radius
                    const ry = Math.max(height * 0.155, width * 0.09);  // Scale with width on wide screens
                    const rz = Math.max(width, height) * 0.2;
                    const ang = Math.random() * Math.PI * 2;
                    const rad = Math.sqrt(Math.random());
                    const x = Math.cos(ang) * rx * rad;
                    const y = (Math.random() - 0.288) * ry; // lift higher (~+44% from original)
                    const z = Math.random() * rz;
                    const viewportScale = width / 1600;
                    const size = (2 + Math.random() * 3) * 0.2 * Math.max(1, viewportScale);
                    const speed = 12 + Math.random() * 10;
                    const dirTheta = Math.random() * Math.PI * 2;
                    const dirPhi = Math.acos(2 * Math.random() - 1);
                    const dx = Math.sin(dirPhi) * Math.cos(dirTheta);
                    const dy = Math.cos(dirPhi);
                    const dz = Math.sin(dirPhi) * Math.sin(dirTheta);
                    sparkState.dots.push({ x, y, z, size, ttl: 2, life: 2, vx: dx * speed, vy: dy * speed, vz: dz * speed });
                };

                const loop = (ts) => {
                    if (!sparkState.running) return;
                    const ratio = window.devicePixelRatio || 1;
                    const width = sparkCanvas.clientWidth || sparkCanvas.width / ratio;
                    const height = sparkCanvas.clientHeight || sparkCanvas.height / ratio;
                    if (width === 0 || height === 0) {
                        sparkState.raf = requestAnimationFrame(loop);
                        return;
                    }

                    const dt = sparkState.lastTs ? (ts - sparkState.lastTs) / 1000 : 0;
                    sparkState.lastTs = ts;

                    if (dt && sparkState.squares.length < 46) {
                        const spawns = Math.floor(dt * 7);
                        for (let i = 0; i < spawns; i++) spawnSquare(width, height);
                        if (Math.random() < dt * 4) spawnSquare(width, height);
                    }

                    if (dt && sparkState.dots.length < 40) {
                        if (Math.random() < dt * 8) spawnDot(width, height);
                    }

                    const ctx = sparkCtx;
                    ctx.clearRect(0, 0, width, height);

                    // Ease toward target angle so rotation feels smooth
                    sparkState.angleY += (sparkState.targetAngleY - sparkState.angleY) * 0.12;
                    const cosY = Math.cos(sparkState.angleY);
                    const sinY = Math.sin(sparkState.angleY);
                    // Scale fov with viewport size to maintain perspective scale (zooming in as viewport grows)
                    const fov = Math.max(width, height) * 0.5;
                    const cx = width * 0.5;
                    const cy = height * 0.53;
                    const zOffset = Math.max(width, height) * 0.4; // push everything forward to avoid z<=0

                    const next = [];
                    for (const s of sparkState.squares) {
                        s.ttl -= dt;
                        if (s.ttl <= 0) continue;
                        s.x += s.vx * dt;
                        s.y += s.vy * dt;
                        s.z += s.vz * dt;
                        // Mild damping to keep motion contained
                        s.vx *= 0.995;
                        s.vy *= 0.995;
                        s.vz *= 0.995;

                        // Rotate around Y
                        const rx = s.x * cosY - s.z * sinY;
                        const rz = s.x * sinY + s.z * cosY + zOffset;
                        if (rz <= 12) continue; // avoid divide by small z

                        const persp = fov / rz;
                        const sx = cx + rx * persp;
                        const sy = cy + s.y * persp;
                        const size = s.size * persp;

                        if (size < 0.3 || sx < -100 || sx > width + 100 || sy < -100 || sy > height + 100) {
                            continue;
                        }

                        ctx.globalAlpha = 0.5;
                        ctx.lineWidth = 0.55;
                        ctx.strokeStyle = s.color;
                        ctx.strokeRect(sx - size / 2, sy - size / 2, size, size);
                        next.push(s);
                    }
                    ctx.globalAlpha = 1;
                    sparkState.squares = next;

                    const nextDots = [];
                    for (const d of sparkState.dots) {
                        d.ttl -= dt;
                        if (d.ttl <= 0) continue;
                        d.x += d.vx * dt;
                        d.y += d.vy * dt;
                        d.z += d.vz * dt;
                        d.vx *= 0.995;
                        d.vy *= 0.995;
                        d.vz *= 0.995;

                        const rx = d.x * cosY - d.z * sinY;
                        const rz = d.x * sinY + d.z * cosY + zOffset;
                        if (rz <= 12) continue;
                        const persp = fov / rz;
                        const sx = cx + rx * persp;
                        const sy = cy + d.y * persp;
                        const size = d.size * persp;
                        if (size < 0.1) continue;

                        ctx.fillStyle = 'rgba(251, 254, 94, 1)';
                        ctx.beginPath();
                        ctx.arc(sx, sy, size, 0, Math.PI * 2);
                        ctx.fill();
                        nextDots.push(d);
                    }
                    sparkState.dots = nextDots;
                    sparkState.raf = requestAnimationFrame(loop);
                };

                sparkState.resizeHandler = resizeSparkCanvas;
                window.addEventListener('resize', sparkState.resizeHandler);
                sparkState.raf = requestAnimationFrame(loop);
            };

            function shouldSkipLoader() {
                const DEBUG_KEYS = ['debug', 'dgDebug', 'skipLoader'];
                const truthyValues = new Set(['1', 'true', 'yes', 'on', 'skip', 'loader']);
                const sources = [
                    new URLSearchParams(window.location.search),
                    new URLSearchParams(window.location.hash ? window.location.hash.substring(1) : '')
                ];
                const hasDebugParam = sources.some((params) => {
                    return DEBUG_KEYS.some((key) => {
                        if (!params.has(key)) return false;
                        const value = params.get(key);
                        if (!value) return true;
                        return truthyValues.has(value.toLowerCase());
                    });
                });
                if (hasDebugParam) return true;
                try {
                    const stored = localStorage.getItem('dgSkipLoader');
                    if (!stored) return false;
                    return truthyValues.has(stored.toLowerCase());
                } catch (err) {
                    return false;
                }
            }

            const skipLoader = shouldSkipLoader();

            function hideLoader() {
                if (!loader || loaderHidden) return;
                loaderHidden = true;
                if (loaderCounter) {
                    loaderCounter.textContent = '100%';
                    loaderCounter.setAttribute('aria-label', 'Cargando 100%');
                }
                loader.classList.add('is-hidden');
                body && body.classList.remove('is-loading');
            }

            function revealUIElements() {
                if (uiRevealed) return;
                uiRevealed = true;
                const selector = document.querySelector('.sound-selector');
                const manifesto = document.querySelector('.manifiesto-item');
                if (selector) selector.classList.add('is-visible');
                if (manifesto) manifesto.classList.add('is-visible');
                window.dispatchEvent(new CustomEvent('dg:entry-ui'));
            }

            function showEntryGate() {
                if (!entryGate) {
                    revealUIElements();
                    return;
                }
                // Ensure page starts at top and prevent scroll
                window.scrollTo(0, 0);
                document.documentElement.classList.add('no-scroll');
                body && body.classList.add('no-scroll');

                entryGate.setAttribute('aria-hidden', 'false');
                entryGate.classList.add('is-interactive');
            }

            function runEntryTimeline() {
                if (entryStarted) return;
                entryStarted = true;

                // Allow scroll again
                document.documentElement.classList.remove('no-scroll');
                body && body.classList.remove('no-scroll');
                if ('scrollRestoration' in history) {
                    history.scrollRestoration = 'auto';
                }

                // Arrancar ambiente apenas el usuario hace clic en "Entrar"
                if (typeof window.playAmbientFromEntry === 'function') {
                    window.playAmbientFromEntry();
                }

                if (entryButton) {
                    entryButton.disabled = true;
                    entryButton.classList.add('is-hiding');
                }

                setTimeout(() => {
                    if (entryGate) entryGate.classList.add('is-fading');
                }, 140);

                setTimeout(() => {
                    if (floatingIsland) floatingIsland.classList.add('cloud1-visible');
                }, 600);

                setTimeout(() => {
                    if (floatingIsland) floatingIsland.classList.add('cloud2-visible');
                }, 1200);

                setTimeout(() => {
                    if (splatContainer) splatContainer.classList.add('is-visible');
                }, 1800);

                if (splatContainer) {
                    let birdsLoopPatched = false;
                    const startBirdsVideo = () => {
                        if (disableBirds) return;
                        if (!birdsVideo) return;
                        birdsVideo.pause();
                        birdsVideo.currentTime = 0;
                        if (!birdsLoopPatched) {
                            const TRIM = 0.5; // trim last 500ms for seamless loop
                            const handleLoopTrim = () => {
                                const d = birdsVideo.duration;
                                if (!Number.isFinite(d) || d <= TRIM) return;
                                if (birdsVideo.currentTime >= d - TRIM) {
                                    birdsVideo.currentTime = 0;
                                    birdsVideo.play().catch(() => { });
                                }
                            };
                            birdsVideo.addEventListener('timeupdate', handleLoopTrim);
                            birdsVideo.addEventListener('ended', handleLoopTrim);
                            birdsLoopPatched = true;
                        }
                        const play = () => {
                            birdsOverlay?.classList.add('is-active');
                            birdsVideo.play().catch(() => { });
                        };
                        const delayPlay = () => setTimeout(play, 5000);
                        if (birdsVideo.readyState >= 2) {
                            delayPlay();
                        } else {
                            birdsVideo.addEventListener('canplay', delayPlay, { once: true });
                        }
                    };

                    const onReady = () => {
                        startBirdsVideo();
                        startSparks();
                    };

                    const onTransitionEnd = (e) => {
                        if (e.target === splatContainer && e.propertyName === 'opacity') {
                            splatContainer.removeEventListener('transitionend', onTransitionEnd);
                            onReady();
                        }
                    };

                    if (getComputedStyle(splatContainer).opacity === '1') {
                        // already visible (e.g., loader skipped)
                        onReady();
                    } else {
                        splatContainer.addEventListener('transitionend', onTransitionEnd);
                    }
                }

                setTimeout(revealUIElements, 2400);

                setTimeout(() => {
                    if (entryGate && entryGate.parentElement) {
                        entryGate.setAttribute('aria-hidden', 'true');
                        entryGate.remove();
                    }
                }, 1700);
            }

            if (entryButton) {
                entryButton.addEventListener('click', runEntryTimeline);
            }

            function startReveal() {
                if (!loader || revealStarted) return;
                revealStarted = true;
                // Skip welcome intro: hide loader immediately
                hideLoader();
                showEntryGate();
            }

            if (skipLoader) {
                hideLoader();
                showEntryGate();
                return; // Debug flag short-circuits the rest of the loader choreography
            }

            if (loaderVideo) {
                loaderVideo.addEventListener('loadedmetadata', () => {
                    if (!loaderVideo.duration) return;
                    const desiredSeconds = MIN_DISPLAY_MS / 1000;
                    const adjustedRate = loaderVideo.duration / desiredSeconds;
                    if (adjustedRate > 0) {
                        loaderVideo.playbackRate = adjustedRate;
                    }
                });
            }

            const loadPromise = new Promise((resolve) => {
                if (document.readyState === 'complete') resolve();
                else window.addEventListener('load', resolve, { once: true });
            });
            const minDisplayPromise = new Promise((resolve) => setTimeout(resolve, MIN_DISPLAY_MS));

            Promise.all([loadPromise, minDisplayPromise]).then(() => {
                requestAnimationFrame(startReveal);
            });

            // Safety timeout in case load event never fires
            setTimeout(startReveal, FALLBACK_REVEAL_MS);
        })();

// --------------------------------------------------
// Background image cycle: fade between hero textures after the page loads (ping-pong order)
        (function () {
            const root = document.getElementById('bg-transition-root');
            const BG_IMAGES = [
                '/assets/web-bgs/D+fondo_para_web_01.webp',
                '/assets/web-bgs/D+fondo_para_web_02.webp',
                '/assets/web-bgs/D+fondo_para_web_03.webp'
            ];
            const DISPLAY_MS = 2000;
            const FADE_MS = 2000;

            if (!root || BG_IMAGES.length < 2) return;

            const layers = [document.createElement('div'), document.createElement('div')];
            let activeLayer = 0;
            let currentIndex = 0;
            let direction = 1;

            layers.forEach((layer) => {
                layer.className = 'bg-transition-layer';
                layer.style.transitionDuration = FADE_MS + 'ms';
                root.appendChild(layer);
            });

            // Preload to avoid flashing when swapping images
            BG_IMAGES.forEach((src) => {
                const img = new Image();
                img.decoding = 'async';
                img.src = src;
            });

            function nextIndex() {
                if (currentIndex === BG_IMAGES.length - 1) direction = -1;
                else if (currentIndex === 0) direction = 1;
                return currentIndex + direction;
            }

            function crossfade(toIdx) {
                const nextLayer = layers[activeLayer ^ 1];
                nextLayer.style.backgroundImage = `url('${BG_IMAGES[toIdx]}')`;
                void nextLayer.offsetWidth; // force reflow so the transition always triggers
                nextLayer.classList.add('is-visible');
                layers[activeLayer].classList.remove('is-visible');
                activeLayer ^= 1;
                currentIndex = toIdx;
            }

            function startCycle() {
                layers[activeLayer].style.backgroundImage = `url('${BG_IMAGES[currentIndex]}')`;
                layers[activeLayer].classList.add('is-visible');

                window.setInterval(() => {
                    const target = nextIndex();
                    crossfade(target);
                }, DISPLAY_MS);
            }

            window.addEventListener('load', startCycle, { once: true });
        })();

// --------------------------------------------------
// Basic PWA install + offline helpers
        (function () {
            let deferredPrompt = null;
            const installBtn = document.getElementById('pwaInstallBtn');
            const saveBtn = document.getElementById('pwaSaveBtn');
            const fullscreenBtn = document.getElementById('fullscreenBtn');
            const fullscreenTarget = document.documentElement;
            const supportsFullscreen = !!(
                fullscreenBtn &&
                fullscreenTarget &&
                fullscreenTarget.requestFullscreen &&
                document.fullscreenEnabled
            );

            const updateFullscreenButton = () => {
                if (!fullscreenBtn) return;
                const isFullscreen = !!document.fullscreenElement;
                fullscreenBtn.textContent = isFullscreen ? 'Salir pantalla completa' : 'Pantalla completa';
                fullscreenBtn.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
            };

            // Listen for the beforeinstallprompt event
            window.addEventListener('beforeinstallprompt', (e) => {
                // Prevent the mini-infobar from appearing on mobile
                e.preventDefault();
                deferredPrompt = e;
                // Show the install button
                if (installBtn) installBtn.hidden = false;
            });

            // Register service worker (if available)
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/service-worker.js').then((reg) => {
                    console.log('ServiceWorker registrado:', reg);
                }).catch((err) => {
                    console.warn('ServiceWorker registro fallido:', err);
                });
            }

            // Install button action
            if (installBtn) {
                installBtn.addEventListener('click', async () => {
                    if (!deferredPrompt) return;
                    deferredPrompt.prompt();
                    const choice = await deferredPrompt.userChoice;
                    if (choice && choice.outcome) {
                        console.log('Install choice:', choice.outcome);
                    }
                    // Hide the install button after attempt
                    deferredPrompt = null;
                    installBtn.hidden = true;
                });
            }

            // Save offline action: send a message to the service worker to cache resources
            if (saveBtn) {
                saveBtn.addEventListener('click', async () => {
                    if (!('serviceWorker' in navigator)) {
                        alert('Service Worker no soportado en este navegador.');
                        return;
                    }

                    try {
                        const reg = await navigator.serviceWorker.ready;
                        if (reg && reg.active) {
                            // Show toast UI and kick off caching
                            showPwaToast('Guardando recursos...', 0);
                            reg.active.postMessage({ type: 'CACHE_OFFLINE' });
                            // The service worker will post progress messages back
                        } else {
                            alert('Service Worker aún no está activo. Intenta de nuevo en unos segundos.');
                        }
                    } catch (err) {
                        console.warn('Error al pedir cache offline:', err);
                        alert('No se pudo iniciar el guardado offline.');
                    }
                });
            }

            if (fullscreenBtn) {
                if (!supportsFullscreen) {
                    fullscreenBtn.hidden = true;
                } else {
                    updateFullscreenButton();
                    fullscreenBtn.addEventListener('click', async () => {
                        if (!document.fullscreenElement) {
                            try {
                                if (fullscreenTarget.requestFullscreen.length === 1) {
                                    await fullscreenTarget.requestFullscreen({ navigationUI: 'hide' });
                                } else {
                                    await fullscreenTarget.requestFullscreen();
                                }
                                if (screen.orientation && screen.orientation.lock) {
                                    try {
                                        await screen.orientation.lock('landscape');
                                    } catch (err) {
                                        // Ignore orientation lock failures.
                                    }
                                }
                            } catch (err) {
                                console.warn('Fullscreen request failed:', err);
                            }
                        } else if (document.exitFullscreen) {
                            try {
                                await document.exitFullscreen();
                            } catch (err) {
                                console.warn('Exit fullscreen failed:', err);
                            }
                        }
                    });
                    document.addEventListener('fullscreenchange', updateFullscreenButton);
                }
            }

            // When the app is installed, hide install button
            window.addEventListener('appinstalled', () => {
                if (installBtn) installBtn.hidden = true;
                console.log('App instalada');
            });
        })();

// --------------------------------------------------
// Sound selector hotspots: positions are given relative to the image's natural size.
        (function () {
            const coords = {
                dialog: { x: 798, y: 71 },
                music: { x: 872, y: 40 },
                ambient: { x: 948, y: 71 }
            };
            const RADIUS = 25; // px radius as requested

            // Re-grab the global audio element here (module scope const is not visible in this IIFE)
            const audioEl = document.getElementById('web-music');

            const selectorImg = document.querySelector('.sound-selector img#sound-toggle');
            if (!selectorImg) return;

            // Create container for hotspots (absolute positioned over the image)
            const container = document.createElement('div');
            container.className = 'sound-hotspots-container';
            container.setAttribute('aria-hidden', 'false');
            container.style.position = 'absolute';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '100%';
            container.style.height = '100%';
            container.style.pointerEvents = 'none';
            container.style.zIndex = '22';

            // Ensure the parent (.sound-selector) is positioned relatively
            const selParent = selectorImg.parentElement;

            const tooltip = document.createElement('div');
            tooltip.className = 'sound-tooltip';
            tooltip.setAttribute('role', 'tooltip');
            tooltip.hidden = true;
            if (selParent) selParent.appendChild(tooltip);

            let tooltipTarget = null;
            let hideTooltipTimer = null;

            const tooltipLabels = {
                dialog: 'Relatos',
                music: 'Música',
                ambient: 'Ambiente'
            };

            function positionTooltip(target) {
                if (!tooltip || !selParent || tooltip.hidden) return;
                const rect = target.getBoundingClientRect();
                const parentRect = selParent.getBoundingClientRect();
                const centerX = rect.left - parentRect.left + rect.width / 2;
                const top = rect.top - parentRect.top;
                tooltip.style.left = centerX + 'px';
                tooltip.style.top = (top - 6) + 'px';
            }

            function showTooltip(name, target) {
                if (!tooltip) return;
                if (hideTooltipTimer) {
                    clearTimeout(hideTooltipTimer);
                    hideTooltipTimer = null;
                }
                tooltip.textContent = tooltipLabels[name] || name;
                tooltipTarget = target;
                tooltip.hidden = false;
                positionTooltip(target);
                requestAnimationFrame(() => tooltip.classList.add('is-visible'));
            }

            function hideTooltip() {
                if (!tooltip) return;
                tooltip.classList.remove('is-visible');
                tooltipTarget = null;
                hideTooltipTimer = setTimeout(() => { tooltip.hidden = true; }, 160);
            }

            // Helper to create a hotspot element
            function makeHotspot(name) {
                const el = document.createElement('button');
                el.type = 'button';
                el.className = 'sound-hotspot';
                el.dataset.channel = name;
                el.setAttribute('aria-pressed', 'false');
                el.setAttribute('aria-label', `Alternar ${name}`);
                el.style.position = 'absolute';
                el.style.width = (RADIUS * 2) + 'px';
                el.style.height = (RADIUS * 2) + 'px';
                el.style.borderRadius = '50%';
                el.style.boxSizing = 'border-box';
                el.style.pointerEvents = 'auto';
                el.style.transition = 'transform 180ms ease, background 180ms ease, opacity 180ms ease';
                el.style.display = 'flex';
                el.style.alignItems = 'center';
                el.style.justifyContent = 'center';
                el.style.cursor = 'pointer';
                return el;
            }

            const hotspots = {
                dialog: makeHotspot('dialog'),
                music: makeHotspot('music'),
                ambient: makeHotspot('ambient')
            };

            Object.keys(hotspots).forEach((name) => {
                const el = hotspots[name];
                const show = () => showTooltip(name, el);
                const hide = () => hideTooltip();
                el.addEventListener('mouseenter', show);
                el.addEventListener('focus', show);
                el.addEventListener('mouseleave', hide);
                el.addEventListener('blur', hide);
                el.addEventListener('pointermove', () => {
                    if (tooltipTarget === el && !tooltip.hidden) {
                        positionTooltip(el);
                    }
                });
            });

            // Add to container
            Object.values(hotspots).forEach(h => container.appendChild(h));
            if (selParent) selParent.appendChild(container);

            // Debug panel removed in production build
            const debugContent = null;

            // Positioning function: scale coords from natural image size to displayed size
            function positionHotspots() {
                const naturalW = selectorImg.naturalWidth || selectorImg.width;
                const naturalH = selectorImg.naturalHeight || selectorImg.height;
                const rect = selectorImg.getBoundingClientRect();
                const scaleX = rect.width / naturalW;
                const scaleY = rect.height / naturalH;

                const positions = {};
                Object.keys(coords).forEach((k) => {
                    const c = coords[k];
                    const hx = Math.round(c.x * scaleX - RADIUS);
                    const hy = Math.round(c.y * scaleY - RADIUS);
                    const el = hotspots[k];
                    el.style.left = hx + 'px';
                    el.style.top = hy + 'px';
                    positions[k] = { left: hx, top: hy, rawX: c.x, rawY: c.y };
                });

                if (tooltipTarget && !tooltip.hidden) {
                    positionTooltip(tooltipTarget);
                }

            }

            // Toggle state storage (start all OFF)
            const state = { dialog: false, music: false, ambient: false };

            function updateHotspotUI(name) {
                const el = hotspots[name];
                if (!el) return;
                const on = !!state[name];
                el.dataset.on = on ? '1' : '0';
                el.setAttribute('aria-pressed', on ? 'true' : 'false');
                el.style.background = on ? 'rgba(255,229,92,0)' : 'rgba(0,0,0,0)';
                el.style.transform = on ? 'scale(1.07)' : 'scale(1)';
            }

            // map channel -> image filename
            const channelImage = {
                dialog: 'assets/selectores/selector-sonido-dialogo.png',
                music: 'assets/selectores/selector-sonido-musica.png',
                ambient: 'assets/selectores/selector-sonido-ambiente.png',
                off: 'assets/selectores/selector-sonido-off.png'
            };

            // helper to update selector image based on current state
            function refreshSelectorImage(lastToggled) {
                // If none enabled, show off image
                const enabled = Object.keys(state).filter(k => state[k]);
                if (enabled.length === 0) {
                    selectorImg.src = channelImage.off;
                    return;
                }
                // Prefer the last toggled channel if it's enabled, otherwise pick the first enabled
                if (lastToggled && state[lastToggled]) {
                    selectorImg.src = channelImage[lastToggled] || channelImage.off;
                    return;
                }
                selectorImg.src = channelImage[enabled[0]] || channelImage.off;
            }

            const relatosFiles = [
                'guia-monte-paloma.mp3',
                'gustavo-andino.mp3',
                'nino-2-pesca.mp3',
                'nino-3.mp3',
                'nino-pesca.mp3',
                'norma-isabel-alarcon.mp3',
                'pamela.mp3',
                'ruben-angel-alarcon.mp3'
            ];

            const musicFiles = [
                '02-carnaval.mp3',
                '10-lluvia.mp3',
                '11-dorado.mp3',
                '13-verano.mp3'
            ];

            // Wire click handlers
            // Wire click handlers
            Object.keys(hotspots).forEach((k) => {
                const el = hotspots[k];
                el.addEventListener('click', async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();

                    // Resolve layers (ensure we have them even if module hasn't run)
                    const layers = window.audioLayers || {
                        ambient: document.getElementById('audio-ambient'),
                        music: document.getElementById('audio-music'),
                        dialog: document.getElementById('audio-dialog')
                    };

                    const wasActive = state[k];

                    // 1. If clicking the currently active selector -> For music/dialog, play new random; for ambient, toggle OFF
                    if (wasActive) {
                        if (k === 'ambient') {
                            // Toggle OFF ambient
                            Object.keys(state).forEach(s => { state[s] = false; updateHotspotUI(s); });
                            refreshSelectorImage();
                            Object.values(layers).forEach(layer => {
                                if (layer) {
                                    layer.pause();
                                    layer.currentTime = 0;
                                }
                            });
                            return;
                        }
                        // For music/dialog, continue to play a new random track (don't return)
                    }

                    // 2. Switching TO a mode (or replaying same mode for music/dialog)

                    // Update UI State: Only clicked one is ON
                    Object.keys(state).forEach(s => { state[s] = (s === k); updateHotspotUI(s); });
                    refreshSelectorImage(k);

                    // Ensure Audio Context is resumed
                    if (typeof window.enableGlobalAudio === 'function') {
                        await window.enableGlobalAudio(true);
                    }

                    // Helper functions
                    const play = async (layerName, vol, src, loop, forceReload = false) => {
                        const l = layers[layerName];
                        if (!l) return;
                        l.volume = vol;
                        l.loop = loop;

                        const alreadyCorrectSrc = l.src && src && l.src.includes(src);
                        if (!alreadyCorrectSrc || forceReload) {
                            l.src = src;
                            l.load();
                        }
                        try { await l.play(); } catch (e) { console.warn('Play error', e); }
                    };

                    const stop = (layerName) => {
                        const l = layers[layerName];
                        if (l) {
                            l.pause();
                            l.currentTime = 0;
                        }
                    };

                    const SRC_MUSIC = 'assets/music/13-verano.mp3';
                    const SRC_AMBIENT = 'assets/delta-web-ambiente.mp3';

                    // 3. Logic Branches based on selection
                    if (k === 'dialog') {
                        // RELATOS MODE
                        // 1. Play Random Story (100%)
                        const randomFile = relatosFiles[Math.floor(Math.random() * relatosFiles.length)];
                        await play('dialog', 1.0, `assets/relatos/${randomFile}`, false, true);

                        // 2. Ambient BG (30%)
                        await play('ambient', 0.3, SRC_AMBIENT, true, false);

                        // 3. Stop Music
                        stop('music');

                    } else if (k === 'music') {
                        // MUSIC MODE
                        // 1. Play Random Music (80%)
                        const randomMusic = musicFiles[Math.floor(Math.random() * musicFiles.length)];
                        await play('music', 0.8, `assets/music/${randomMusic}`, true, true);

                        // 2. Ambient BG (30%)
                        await play('ambient', 0.3, SRC_AMBIENT, true, false);

                        // 3. Stop Dialog
                        stop('dialog');

                    } else if (k === 'ambient') {
                        // AMBIENT MODE
                        // 1. Ambient (100%)
                        await play('ambient', 1.0, SRC_AMBIENT, true, false);

                        // 2. Stop others
                        stop('music');
                        stop('dialog');
                    }
                });
            });

            // Init after image loaded
            if (selectorImg.complete) positionHotspots();
            selectorImg.addEventListener('load', positionHotspots);
            window.addEventListener('resize', positionHotspots);

            // initialize UI
            Object.keys(hotspots).forEach(k => updateHotspotUI(k));
            // Ensure selector image and debug reflect initial OFF state
            try { refreshSelectorImage(); } catch (e) { /* ignore */ }
            // Debugging removed: no initial debug state

            // Allow entry button to start ambient immediately after user gesture
            window.playAmbientFromEntry = async function playAmbientFromEntry() {
                const layers = window.audioLayers || {
                    ambient: document.getElementById('audio-ambient'),
                    music: document.getElementById('audio-music'),
                    dialog: document.getElementById('audio-dialog')
                };
                const audio = layers.ambient;
                if (!audio) return;

                // Reset UI state to only ambient on
                Object.keys(state).forEach(s => { state[s] = false; updateHotspotUI(s); });
                state.ambient = true;
                updateHotspotUI('ambient');
                refreshSelectorImage('ambient');

                // Ensure audio is unlocked
                if (typeof window.enableGlobalAudio === 'function') {
                    await window.enableGlobalAudio(true);
                }

                audio.src = 'assets/delta-web-ambiente.mp3';
                audio.loop = true;
                try {
                    await audio.play();
                } catch (err) {
                    console.warn('No se pudo iniciar ambiente en la entrada:', err);
                }
            };
        })();
