import { BaseScene } from '../core/BaseScene.js';

// Tema visual consistente con RecorridoScene
const EFEDRA_OVERLAY_THEME = {
  fontKitHref: 'https://use.typekit.net/vmy8ypx.css',
  fonts: {
    family: `"new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`
  },
  colors: {
    text: '#FFC96A', // Color naranja/dorado principal
    textShadow: 'rgba(0, 0, 0, 0.45)'
  }
};

export class RecorridoTransitionScene extends BaseScene {
  constructor(app) {
    super(app);
    this.name = 'recorrido-transition';

    // Tracking for cleanup when navigation happens mid-transition
    this._overlay = null;
    this._backgroundAudio = null;
    this._activeVideos = new Set();
    this._rafIds = new Set();
    this._timeoutIds = new Set();
    this._intervalIds = new Set();
    this._skipHandler = null;
    this._cleanupRequested = false;
  }

  _resetCleanupState() {
    this._cleanupRequested = false;
    this._activeVideos.clear();
    this._rafIds.clear();
    this._timeoutIds.clear();
    this._intervalIds.clear();
    this._skipHandler = null;
    this._overlay = null;
    this._backgroundAudio = null;
  }

  _trackRaf(fn) {
    const id = requestAnimationFrame((ts) => {
      this._rafIds.delete(id);
      fn(ts);
    });
    this._rafIds.add(id);
    return id;
  }

  _trackTimeout(fn, ms) {
    const id = setTimeout(() => {
      this._timeoutIds.delete(id);
      fn();
    }, ms);
    this._timeoutIds.add(id);
    return id;
  }

  _trackInterval(fn, ms) {
    const id = setInterval(fn, ms);
    this._intervalIds.add(id);
    return id;
  }

  _stopTimers() {
    this._rafIds.forEach(cancelAnimationFrame);
    this._timeoutIds.forEach(clearTimeout);
    this._intervalIds.forEach(clearInterval);
    this._rafIds.clear();
    this._timeoutIds.clear();
    this._intervalIds.clear();
  }

  _stopVideos() {
    this._activeVideos.forEach((video) => {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch { /* ignore */ }
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
    });
    this._activeVideos.clear();
  }

  _stopAudio() {
    if (this._backgroundAudio) {
      try {
        this._backgroundAudio.pause();
        this._backgroundAudio.currentTime = 0;
        this._backgroundAudio.src = '';
      } catch { /* ignore */ }
      this._backgroundAudio = null;
    }
  }

  _removeOverlay() {
    if (this._overlay) {
      if (this._skipHandler) {
        this._overlay.removeEventListener('click', this._skipHandler);
      }
      if (this._overlay.parentNode) {
        this._overlay.parentNode.removeChild(this._overlay);
      }
      this._overlay = null;
      this._skipHandler = null;
    }
  }

  _forceCleanup() {
    this._cleanupRequested = true;
    this._stopTimers();
    this._stopVideos();
    this._stopAudio();
    this._removeOverlay();
    document.body.style.cursor = 'auto';
    if (this.app?.canvas) {
      this.app.canvas.style.display = '';
    }
  }

  async mount() {
    this._resetCleanupState();
    // 👇 Limpiar cualquier overlay del menú que haya quedado abierto
    const menuOverlays = document.querySelectorAll('body > div');
    menuOverlays.forEach(overlay => {
      const zIndex = window.getComputedStyle(overlay).zIndex;
      if (zIndex === '10000') {
        console.log('[RecorridoTransitionScene] Removing leftover menu overlay');
        overlay.remove();
      }
    });

    // Cargar fuente de TypeKit
    if (!document.getElementById('efedra-transition-font')) {
      const link = document.createElement('link');
      link.id = 'efedra-transition-font';
      link.rel = 'stylesheet';
      link.href = EFEDRA_OVERLAY_THEME.fontKitHref;
      document.head.appendChild(link);
    }

    // Ocultar el canvas 3D
    this.app.canvas.style.display = 'none';

    // Ocultar cursor durante la transición
    document.body.style.cursor = 'none';

    // Crear overlay para el video de transición
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: black;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      pointer-events: auto;
      opacity: 1;
    `;
    document.body.appendChild(overlay);
    this._overlay = overlay;

    

    // Iniciar música de fondo continua
    const backgroundAudio = new Audio('/game-assets/transiciones/Video animacion carpa.mp3');
    backgroundAudio.volume = 1.0;
    backgroundAudio.loop = false;
    backgroundAudio.play().catch(() => { });
    this._backgroundAudio = backgroundAudio;

    // Variable para controlar si se hace skip
    let skipped = false;

    // Hacer click para skip
    const skipHandler = () => {
      skipped = true;
    };
    this._skipHandler = skipHandler;
    overlay.addEventListener('click', skipHandler);

    // Reproducir primer video de transición con texto
    await this.playTransitionVideo(
      overlay,
      '/game-assets/transiciones/secuencia_inicio_recorrido1.webm',
      () => skipped,
      'El espinal cubre la gran parte del territorio entrerriano, llegando a las costas del Delta del Paraná, donde se fusiona con la selva en galería.',
      '/game-assets/transiciones/voiceovers/recorrido_transition_0.mp3'
    );

    // Si no se hizo skip, reproducir segundo video con texto
    if (!skipped) {
      await this.playTransitionVideo(
        overlay,
        '/game-assets/transiciones/secuencia_inicio_recorrido2.webm',
        () => skipped,
        'Aquí, en la unión de estos ecosistemas, se pueden encontrar una gran variedad de especies: algunas muy escurridizas, otras que les encanta hacerse ver.',
        '/game-assets/transiciones/voiceovers/recorrido_transition_1.mp3'
      );
    }

    // Remover event listener
    overlay.removeEventListener('click', skipHandler);
    this._skipHandler = null;

    // Detener música de fondo
    backgroundAudio.pause();
    backgroundAudio.currentTime = 0;
    this._backgroundAudio = null;

    // Limpiar overlay
    overlay.style.transition = 'opacity 0.5s';
    overlay.style.opacity = '0';
    await new Promise(resolve => setTimeout(resolve, 500));
    document.body.removeChild(overlay);
    this._overlay = null;

    // Wait a bit more to allow GC to clear video buffers
    console.log('[RecorridoTransitionScene] Waiting for GC...');
    
    // 🔥 AGGRESSIVE MEMORY CLEANUP
    // Clear THREE.js caches multiple times to ensure blob URLs are released
    if (typeof THREE !== 'undefined' && THREE.Cache) {
      THREE.Cache.clear();
    }
    
    // Multiple GC cycles to ensure blob URLs and textures are cleaned up
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (typeof THREE !== 'undefined' && THREE.Cache) {
        THREE.Cache.clear();
      }
    }
    
    console.log('[RecorridoTransitionScene] GC complete, transitioning...');

    // Restaurar cursor
    document.body.style.cursor = 'auto';

    // Ir a la escena de recorrido
    location.hash = '#recorrido';
  }

  async playTransitionVideo(overlay, videoSrc, isSkipped, textContent = null, audioSrc = null) {
    if (this._cleanupRequested) {
      return;
    }
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.src = videoSrc;
      video.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 0;
        pointer-events: none;
        position: absolute;
        inset: 0;
        transition: opacity 1s ease-in-out;
      `;
      video.muted = true; // Muted para que solo se escuche el audio de fondo
      video.playsInline = true;

      this._activeVideos.add(video);

      overlay.appendChild(video);

      // Crear overlay de texto si se proporciona contenido
      let textOverlay = null;
      let textEl = null;
      if (textContent) {
        // Use CSS classes defined in `game/index.html` for responsive sizing.
        textOverlay = document.createElement('div');
        textOverlay.className = 'recorrido-transition-text-overlay';
        textOverlay.setAttribute('aria-hidden', 'true');

        textEl = document.createElement('div');
        textEl.className = 'recorrido-transition-text-inner';
        textEl.style.position = 'relative'; // enable absolutely-positioned glitch layer without affecting layout

        textOverlay.appendChild(textEl);
        overlay.appendChild(textOverlay);
      }

      // Fade in desde negro
      this._trackRaf(() => {
        if (this._cleanupRequested) return;
        video.style.opacity = '1';
      });

      // Reproducir video
      video.play();

      // Reproducir audio de voz en off
      let voiceAudio = null;
      if (audioSrc) {
        voiceAudio = new Audio(audioSrc);
        voiceAudio.volume = 1.0;
        voiceAudio.play().catch(e => console.warn("Transition voiceover play failed", e));
      }

      // Iniciar efecto typewriter después de 2 segundos
      if (textContent && textOverlay && textEl) {
        // Pre-measure final height so the block is centered from the start (no jump on typewriter start)
        textEl.textContent = textContent;
        textEl.style.visibility = 'hidden';
        textEl.style.position = 'absolute';
        textEl.style.left = '-9999px';
        textEl.style.top = '-9999px';
        const measuredHeight = textEl.getBoundingClientRect().height;
        textEl.style.minHeight = `${Math.ceil(measuredHeight)}px`;
        textEl.textContent = '';
        textEl.style.visibility = 'visible';
        textEl.style.position = '';
        textEl.style.left = '';
        textEl.style.top = '';

        this._trackTimeout(() => {
          if (this._cleanupRequested) return;
          // Fade in del overlay (make visible via aria attribute so CSS handles opacity)
          textOverlay.setAttribute('aria-hidden', 'false');
          textOverlay.style.opacity = '1';

          // Caracteres para el efecto glitch
          const glitchChars = "!@#$%^&*()_+-=[]{}|;':\",./<>?~`abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
          const getRandomGlitchChar = () => glitchChars[Math.floor(Math.random() * glitchChars.length)];

          const fullText = textContent;
          
          // Pre-renderizar el texto completo para calcular el layout
          textEl.textContent = fullText;
          textEl.style.visibility = 'hidden';
          textEl.offsetHeight; // Forzar reflow
          
          // Crear spans para cada carácter
          textEl.textContent = '';
          textEl.style.visibility = 'visible';
          textEl.style.whiteSpace = 'pre-wrap'; // Preservar saltos de línea y espacios
          
          const chars = fullText.split('');
          const charSpans = [];
          
          chars.forEach((char) => {
            const span = document.createElement('span');
            span.textContent = char;
            span.style.opacity = '0';
            span.style.display = 'inline'; // Forzar inline para evitar espacios extras
            textEl.appendChild(span);
            charSpans.push(span);
          });
          
          // Crear contenedor para caracteres glitch
          const glitchSpan = document.createElement('span');
          glitchSpan.style.position = 'absolute';
          glitchSpan.style.left = '0';
          glitchSpan.style.bottom = '0';
          glitchSpan.style.pointerEvents = 'none';
          glitchSpan.style.whiteSpace = 'pre';
          glitchSpan.style.opacity = '0.3';
          glitchSpan.style.animation = 'glitch-flicker 0.1s infinite';
          glitchSpan.style.transform = 'translateY(100%)'; // render just below the baseline to avoid layout jitter
          textEl.appendChild(glitchSpan);
          
          let currentIndex = 0;

          const typewriterInterval = this._trackInterval(() => {
            if (this._cleanupRequested) {
              clearInterval(typewriterInterval);
              return;
            }
            if (currentIndex < charSpans.length) {
              // Revelar el siguiente carácter
              charSpans[currentIndex].style.opacity = '1';
              charSpans[currentIndex].style.transition = 'opacity 0.05s ease-in';
              
              // Actualizar caracteres glitch
              const glitchCount = Math.floor(Math.random() * 3) + 3;
              let glitchText = '';
              for (let i = 0; i < glitchCount; i++) {
                glitchText += getRandomGlitchChar();
              }
              glitchSpan.textContent = glitchText;
              
              currentIndex++;
            } else {
              clearInterval(typewriterInterval);
              glitchSpan.remove(); // Remover los caracteres glitch al final
            }
          }, 25); // 25ms entre cada caracter

          // Agregar CSS para el efecto de parpadeo del glitch
          if (!document.getElementById('glitch-flicker-style')) {
            const style = document.createElement('style');
            style.id = 'glitch-flicker-style';
            style.textContent = `
              @keyframes glitch-flicker {
                0%, 100% { opacity: 0.6; }
                50% { opacity: 0.2; }
              }
            `;
            document.head.appendChild(style);
          }
        }, 2000);
      }

      // Chequear si se hace skip cada frame
      let skipRafId = null;
      const checkSkip = () => {
        if (isSkipped()) {
          endVideo();
        } else {
          skipRafId = this._trackRaf(checkSkip);
        }
      };
      checkSkip();

      const endVideo = () => {
        if (skipRafId) {
          cancelAnimationFrame(skipRafId);
          this._rafIds.delete(skipRafId);
        }
        if (voiceAudio) {
          voiceAudio.pause();
          voiceAudio.currentTime = 0;
        }
        video.pause();
        video.src = ''; // Release memory
        video.load();

        this._activeVideos.delete(video);

        this._trackTimeout(() => {
          if (video.parentNode) video.parentNode.removeChild(video);
          if (textOverlay && textOverlay.parentNode) textOverlay.parentNode.removeChild(textOverlay);
          resolve();
        }, 1000); // Esperar a que termine el fade out
      };

      // Monitorear el video para iniciar fade out 1 segundo antes del final
      let monitorRafId = null;
      const monitorVideoEnd = () => {
        if (video.paused || video.ended) return;

        const timeRemaining = video.duration - video.currentTime;

        // Iniciar fade out 1 segundo antes del final
        if (timeRemaining <= 1.0 && video.style.opacity !== '0') {
          video.style.opacity = '0';

          // Fade out del texto también
          if (textOverlay) {
              textOverlay.style.transition = 'opacity 1s';
              textOverlay.setAttribute('aria-hidden', 'true');
              textOverlay.style.opacity = '0';
          }
        }

        if (!video.ended) {
          monitorRafId = this._trackRaf(monitorVideoEnd);
        }
      };

      // Cuando el video cargue metadata, iniciar monitoreo
      video.addEventListener('loadedmetadata', () => {
        monitorVideoEnd();
      });

      // Cuando termine el video, limpiar
      video.addEventListener('ended', () => {
        if (monitorRafId) {
          cancelAnimationFrame(monitorRafId);
          this._rafIds.delete(monitorRafId);
        }
        endVideo();
      });
    });
  }

  async unmount() {
    this._forceCleanup();
  }

  update(dt) {
    // No se necesita nada en el loop
  }

  render(renderer, dt) {
    // No renderizar nada (solo video en overlay)
  }
}
