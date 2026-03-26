export const UI = new class{
  init({ app, videoOverlayEl, videoEl }){
    this.app = app;
    this.videoOverlayEl = videoOverlayEl;
    this.videoEl = videoEl;

    // Cerrar overlay al click "afuera"
    this.videoOverlayEl.addEventListener('click', (e)=>{
      if (e.target === this.videoOverlayEl) this.hideVideo();
    });
  }

  /**
   * Reproduce un video en overlay full-screen “cover”.
   * opts: { src, controls=false, muted=true, immersive=true, playbackRate=1, onended }
   */
  showVideo(opts = {}){
    const { src, controls=false, muted=true, immersive=true, playbackRate=1, onended } = opts;
    console.log('[UI] showVideo called with src:', src);
    
    // Mark if this is a transition video
    if (src && src.includes('transicion')) {
      this._transitionVideoActive = true;
      console.log('[UI] Transition video detected, setting protection flag');
    }

    // Atributos y estilo para que no muestre controles y cubra pantalla
    this.videoEl.src = src || '';
    this.videoEl.controls = !!controls;
    this.videoEl.muted = !!muted;
    this.videoEl.playsInline = true;

    this.videoOverlayEl.style.display = 'block';
    console.log('[UI] videoOverlay display set to block, computed style:', window.getComputedStyle(this.videoOverlayEl).display);
    this.videoEl.playbackRate = playbackRate || 1;

    const done = () => {
      this.videoEl.onended = null;
      
      // Clear transition flag if it was set
      if (this._transitionVideoActive) {
        console.log('[UI] Transition video ended, clearing protection flag');
        this._transitionVideoActive = false;
      }
      
      try { this.videoEl.pause(); } catch {}

      let awaitable = null;
      if (typeof onended === 'function') {
        try {
          awaitable = onended({ video: this.videoEl, overlay: this.videoOverlayEl });
        } catch { awaitable = null; }
      }

      const finalize = () => { this.hideVideo(); };

      if (awaitable && typeof awaitable.then === 'function') {
        return awaitable.catch(()=>{}).finally(finalize);
      }

      finalize();
      return undefined;
    };

    this.videoEl.onended = () => {
      const res = done();
      if (res && typeof res.then === 'function') {
        res.catch(()=>{});
      }
    };

    const playbackReady = new Promise((resolve) => {
      const onReady = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        this.videoEl.removeEventListener('playing', onReady);
        this.videoEl.removeEventListener('canplay', onReady);
        if (fallbackTimer !== null) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
      };

      let fallbackTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, 500);

      if (!this.videoEl.paused && this.videoEl.readyState >= 2) {
        cleanup();
        resolve();
        return;
      }

      this.videoEl.addEventListener('playing', onReady, { once: true });
      this.videoEl.addEventListener('canplay', onReady, { once: true });
    });

    let playPromise = this.videoEl.play();
    console.log('[UI] Video play() called, promise:', playPromise);
    if (!(playPromise && typeof playPromise.then === 'function')) {
      playPromise = Promise.resolve();
    } else {
      playPromise = playPromise.then(() => {
        console.log('[UI] Video play() resolved successfully');
        console.log('[UI] Video paused after play:', this.videoEl.paused);
        console.log('[UI] Video currentTime after play:', this.videoEl.currentTime);
      }).catch((err) => {
        console.error('[UI] Video play() failed:', err);
      });
    }

    // Intento opcional de fullscreen nativo (ignora si falla/iOS)
    if (immersive && this.videoOverlayEl.requestFullscreen) {
      this.videoOverlayEl.requestFullscreen().catch(()=>{});
    }

    return Promise.all([playPromise, playbackReady]).then(() => {
      console.log('[UI] Video playback ready, overlay display:', this.videoOverlayEl.style.display);
      return this.videoEl;
    });
  }

  hideVideo(){
    console.log('[UI] hideVideo called, stack trace:');
    console.trace();
    
    // Don't hide if transition is active
    if (this._transitionVideoActive) {
      console.warn('[UI] Ignoring hideVideo - transition video is active');
      return;
    }
    
    try { this.videoEl.pause(); } catch {}
    // restaurar playbackRate por si se modificó
    try { this.videoEl.playbackRate = 1; } catch {}
    
    // 🔥 Optimización Móvil: Liberar el recurso de video de la RAM de inmediato
    if (window.browserInfo?.isMobile || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
      if (this.videoEl && this.videoEl.getAttribute('src')) {
        try { this.videoEl.removeAttribute('src'); } catch(e) {}
        try { this.videoEl.load(); } catch(e) {}
      }
    }
    
    this.videoOverlayEl.style.display = 'none';
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(()=>{});
    }
  }
}();
