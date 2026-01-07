import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import { State } from '../core/State.js';
import { Save } from '../core/Save.js';

export class MenuScene extends BaseScene {
  constructor(app) {
    super(app);
    this.name = 'menu';
  }

  async mount() {
    // 👇 Ocultar overlays de recorrido (solo para RecorridoScene)
    const mapOverlay = document.querySelector('.map-overlay');
    const metadataOverlay = document.querySelector('.metadata-overlay');
    const zocaloVideo = document.getElementById('zocaloVideo');
    const inventoryCanvas = document.getElementById('inventoryCanvas');
    if (mapOverlay) mapOverlay.style.display = 'none';
    if (metadataOverlay) metadataOverlay.style.display = 'none';
    if (inventoryCanvas) inventoryCanvas.style.display = 'none';
    if (zocaloVideo) {
      zocaloVideo.style.opacity = '0';
      zocaloVideo.style.display = 'none';
      zocaloVideo.pause();
      zocaloVideo.src = '';
    }

    // Cargar fuente de Adobe Typekit
    this.ensureMenuFont();
    
    // Reproducir sonido ambiente del laboratorio (empezar en 68s, fade-in 2s, volumen objetivo 0.6)
    const MENU_AUDIO_OFFSET = 68; // segundos (cortar la primera parte)
    const MENU_AUDIO_TARGET_VOLUME = 0.6;
    const MENU_AUDIO_FADE_MS = 2000; // fade-in en ms

    this.ambientAudio = new Audio('/game-assets/menu/laboratorio.mp3');
    this.ambientAudio.loop = true;
    // comenzar en 0 para permitir fade-in
    try { this.ambientAudio.volume = 0; } catch (e) {}

    // startAmbient asegura que seteamos currentTime sólo cuando la metadata esté disponible
    const startAmbient = () => {
      try {
        if (typeof this.ambientAudio.duration === 'number' && !isNaN(this.ambientAudio.duration)) {
          if (MENU_AUDIO_OFFSET < this.ambientAudio.duration) {
            this.ambientAudio.currentTime = MENU_AUDIO_OFFSET;
          } else {
            // Si el offset excede la duración, empezar desde el inicio
            this.ambientAudio.currentTime = 0;
          }
        }
      } catch (err) {
        // Ignorar errores al setear currentTime
      }

      // Intentar reproducir, luego hacer fade-in hacia el volumen objetivo
      this.ambientAudio.play().then(() => {
        const start = performance.now();
        const step = () => {
          if (!this.ambientAudio) return; // si se desmontó
          const now = performance.now();
          const t = Math.min(1, (now - start) / MENU_AUDIO_FADE_MS);
          try {
            this.ambientAudio.volume = t * MENU_AUDIO_TARGET_VOLUME;
          } catch (e) {}
          if (t < 1) requestAnimationFrame(step);
          else try { this.ambientAudio.volume = MENU_AUDIO_TARGET_VOLUME; } catch (e) {}
        };
        requestAnimationFrame(step);
      }).catch(err => console.warn('Audio playback failed:', err));
    };

    if (this.ambientAudio.readyState >= 1) {
      startAmbient();
    } else {
      this.ambientAudio.addEventListener('loadedmetadata', startAmbient, { once: true });
      // Fallback por si 'loadedmetadata' no se dispara por alguna razón
      setTimeout(startAmbient, 500);
    }
    
    // Ocultar el canvas 3D
    this.app.canvas.style.display = 'none';

    // Ocultar cursor durante las cinemáticas
    document.body.style.cursor = 'none';
    
    // Crear overlay persistente para los videos
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: black;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: none;
      pointer-events: none;
    `;
    document.body.appendChild(overlay);

    // Colocar la barra de progreso dentro del overlay del menú para controlar la pila
    this._progressOverlay = window.progressManager?.overlay || null;
    this._progressOverlayParent = this._progressOverlay?.parentElement || null;
    this._progressOverlayNextSibling = this._progressOverlay?.nextSibling || null;
    this._progressOverlayOriginalZ = this._progressOverlay?.style.zIndex || '';

    this._restoreProgressOverlay = () => {
      if (!this._progressOverlay || !this._progressOverlayParent) return;
      this._progressOverlay.style.zIndex = this._progressOverlayOriginalZ;
      if (this._progressOverlayNextSibling) {
        this._progressOverlayParent.insertBefore(this._progressOverlay, this._progressOverlayNextSibling);
      } else {
        this._progressOverlayParent.appendChild(this._progressOverlay);
      }
      this._progressOverlay = null;
      this._progressOverlayParent = null;
      this._progressOverlayNextSibling = null;
    };

    if (this._progressOverlay) {
      this._progressOverlay.style.zIndex = '1';
      // Ocultar mientras corre el loading; se mostrará después del fade-in del laboratorio
      this._progressOverlay.style.display = 'none';
      this._progressOverlay.style.opacity = '0';
      overlay.appendChild(this._progressOverlay);
    }

    // Mostrar loader de laboratorio
    await this.playLoaderSequence(overlay);

    // Fade in progress overlay after loading screen completes
    if (window.progressManager) {
      window.progressManager.setVisible(false, true); // asegurar que no apareció durante el loader
      window.progressManager.updateAllProgress();
      window.progressManager.overlay.style.display = 'block';
      window.progressManager.overlay.style.opacity = '0';
      window.progressManager.overlay.style.transition = 'opacity 0.8s ease';
      requestAnimationFrame(() => {
        window.progressManager.overlay.style.opacity = '1';
      });
    }

    // Mostrar menú principal con botones
    const menuAction = await this.showMainMenu(overlay);

    // Limpiar overlay
    overlay.style.transition = 'opacity 0.5s';
    overlay.style.opacity = '0';
    await new Promise(resolve => setTimeout(resolve, 500));
    if (this._restoreProgressOverlay) {
      this._restoreProgressOverlay();
    }
    if (document.body.contains(overlay)) {
      document.body.removeChild(overlay);
    }
    
    // Restaurar cursor
    document.body.style.cursor = 'auto';

    // Ejecutar acción del menú
    if (menuAction === 'recorrido') {
      // Iniciar recorrido con instrucciones
      location.hash = '#instrucciones-transition';
    } else if (menuAction === 'subacuatica') {
      // Llevar a la misión subacuática
      location.hash = '#rio';
    } else if (menuAction === 'simulador') {
      // Entrar al simulador interactivo
      location.hash = '#simulador';
    }
    
  }

  async playLoaderSequence(overlay) {
    return new Promise((resolve) => {
      overlay.style.pointerEvents = 'none';
      overlay.style.cursor = 'none';

      const container = document.createElement('div');
      container.style.cssText = `
        position: absolute;
        inset: 0;
        background: black;
        overflow: hidden;
        z-index: 2;
        opacity: 1;
      `;

      const exterior = new Image();
      exterior.src = '/game-assets/menu/laboratorio_exterior.webp';
      exterior.style.cssText = `
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 1;
      `;

      const loader = document.createElement('video');
      loader.src = '/game-assets/menu/loader_yellow.webm';
      loader.style.cssText = `
        position: absolute;
        right: clamp(16px, 3vw, 64px);
        bottom: clamp(16px, 3vw, 64px);
          width: clamp(100px, 15vw, 260px);
          max-height: 50%;
        object-fit: contain;
        opacity: 1;
        pointer-events: none;
      `;
      loader.muted = true;
      loader.playsInline = true;
      loader.loop = false;

      container.appendChild(exterior);
      container.appendChild(loader);
      overlay.appendChild(container);

      let playbackStarted = false;
      const startPlayback = () => {
        if (playbackStarted) return;
        playbackStarted = true;
        const duration = loader.duration || 0;
        loader.playbackRate = duration > 0 ? duration / 5 : 1;
        loader.currentTime = 0;
        loader.play().catch(() => {});

        setTimeout(() => {
          container.style.transition = 'opacity 0.8s ease';
          container.style.opacity = '0';
          setTimeout(() => {
            loader.pause();
            if (container.parentNode) container.parentNode.removeChild(container);
            resolve();
          }, 800);
        }, 5000);
      };

      if (loader.readyState >= 1) {
        startPlayback();
      } else {
        loader.addEventListener('loadedmetadata', startPlayback, { once: true });
        setTimeout(startPlayback, 300);
      }
    });
  }

  async playIntroVideo(overlay, videoSrc, skippeable = false, withFades = false, audioSrc = null, audioVolume = 1.0) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.src = videoSrc;
      video.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: ${withFades ? '0' : '1'};
        pointer-events: auto;
        position: absolute;
        top: 0;
        left: 0;
        z-index: ${withFades ? '1' : '2'};
      `;
      video.muted = !audioSrc;
      video.playsInline = true;

      overlay.appendChild(video);

      // Audio sincronizado si se proporciona
      let audio = null;
      if (audioSrc) {
        audio = new Audio(audioSrc);
        audio.volume = audioVolume;
      }

      // Permitir saltear el video con clic si skippeable
      const skipVideo = (e) => {
        if (skippeable) {
          e.stopPropagation();
          // Al saltar el video, conservar la reproducción del audio.
          // Solo detener y remover el video.
          try {
            video.pause();
            video.currentTime = 0;
          } catch (err) {}
          if (video.parentNode) video.parentNode.removeChild(video);
          video.removeEventListener('click', skipVideo);
          resolve(true); // Indica que fue skipped
        }
      };
      
      if (skippeable) {
        video.addEventListener('click', skipVideo);
      }

      // Fade in del negro a video (3 segundos) solo si withFades
      video.play().then(() => {
        if (audio) audio.play().catch(() => {});
        
        if (withFades) {
          video.style.transition = 'opacity 3s ease-in';
          video.style.opacity = '1';
        }
      });

      // Calcular cuándo hacer fade out (últimos 3 segundos) solo si withFades
      if (withFades) {
        video.addEventListener('loadedmetadata', () => {
          const fadeOutTime = Math.max(0, video.duration - 3);
          
          const checkTime = () => {
            if (video.currentTime >= fadeOutTime) {
              video.style.transition = 'opacity 3s ease-out';
              video.style.opacity = '0';
            }
          };
          
          video.addEventListener('timeupdate', checkTime);
        });
      }

      // Cuando termine el video, limpiar
      video.addEventListener('ended', () => {
        // No pausar el audio aquí para que la canción pueda continuar
        // hasta su final independiente de la duración del video.
        // Remover el video después de un breve delay
        setTimeout(() => {
          if (video.parentNode) video.parentNode.removeChild(video);
        }, 50);
        video.removeEventListener('click', skipVideo);
        resolve(false); // Indica que terminó normalmente
      });
    });
  }

  async showMainMenu(overlay) {
    return new Promise((resolve) => {
      // Preparar overlay para el menú
      overlay.style.background = 'transparent';
      overlay.style.pointerEvents = 'auto';
      overlay.style.cursor = 'auto';

      // Fondo de laboratorio interior con fit calculado (cover sin deformar)
      const BASE_IMG_W = 1344;
      const BASE_IMG_H = 768;
      const sceneLayer = document.createElement('div');
      sceneLayer.style.cssText = `
        position: absolute;
        inset: 0;
        background-image: url('/game-assets/menu/laboratorio_interior.webp');
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        opacity: 0;
        transition: opacity 0.8s ease;
        z-index: 0;
        pointer-events: auto;
      `;
      const applyCoverFit = () => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const scale = Math.max(vw / BASE_IMG_W, vh / BASE_IMG_H);
        const w = BASE_IMG_W * scale;
        const h = BASE_IMG_H * scale;
        const left = (vw - w) / 2;
        const top = (vh - h) / 2;
        sceneLayer.style.width = `${w}px`;
        sceneLayer.style.height = `${h}px`;
        sceneLayer.style.left = `${left}px`;
        sceneLayer.style.top = `${top}px`;
      };
      requestAnimationFrame(() => { applyCoverFit(); sceneLayer.style.opacity = '1'; });
      overlay.appendChild(sceneLayer);

      // Función de limpieza y resolución común
      const finalizeAction = (action) => {
        try {
          if (this && this._menuResizeHandler) {
            window.removeEventListener('resize', this._menuResizeHandler);
          }
        } catch (e) {}
        if (window.progressManager) {
          window.progressManager.setVisible(false, true);
        }
        if (menuWrapper && menuWrapper.parentNode) menuWrapper.parentNode.removeChild(menuWrapper);
        this._menuResizeHandler = null;
        this._menuWrapper = null;
        this._menuContainer = null;
        resolve(action);
      };

      // Hotspots poligonales sobre los monitores
      const hotspotLayer = document.createElement('div');
      hotspotLayer.style.cssText = `
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
      `;

      const hotspotStyle = document.createElement('style');
      hotspotStyle.textContent = `
        .menu-hotspot {
          position: absolute;
          inset: 0;
          pointer-events: auto;
          background: transparent;
          border: none;
          cursor: pointer;
          clip-path: polygon(var(--poly));
          -webkit-clip-path: polygon(var(--poly));
          outline: 2px solid transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          white-space: pre-line;
          font-family: "new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
          font-size: clamp(14px, 1.4vw, 22px);
          font-weight: 700;
          letter-spacing: 1px;
          color: rgba(255,255,255,0.95);
          text-transform: uppercase;
          text-shadow: 0 2px 6px rgba(0,0,0,0.45);
          user-select: none;
        }
      `;
      document.head.appendChild(hotspotStyle);

      const hotspotDefs = [
        {
          action: 'recorrido',
          title: 'Iniciar recorrido',
          polygon: '21.42% 41.28%, 31.20% 40.10%, 31.63% 55.08%, 22.99% 59.38%',
        },
        {
          action: 'simulador',
          title: 'Simulador',
          polygon: '41.90% 34.03%, 50.46% 34.03%, 50.58% 48.83%, 42.20% 49.09%',
        },
        {
          action: 'subacuatica',
          title: 'Misión subacuática',
          polygon: '51.99% 34.90%, 59.72% 34.90%, 59.72% 48.44%, 52.24% 48.05%',
        },
      ];

      hotspotDefs.forEach(({ action, title, polygon }) => {
        const area = document.createElement('button');
        area.className = `menu-hotspot hotspot-${action}`;
        area.type = 'button';
        area.title = title;
        area.dataset.action = action;
        area.style.setProperty('--poly', polygon);
        area.addEventListener('click', () => {
          // Navegar a la escena correspondiente
          if (action === 'recorrido') location.hash = '#instrucciones-transition';
          else if (action === 'subacuatica') location.hash = '#rio';
          else if (action === 'simulador') location.hash = '#simulador';
          finalizeAction(action);
        });
        hotspotLayer.appendChild(area);
      });

      sceneLayer.appendChild(hotspotLayer);
      
      // Crear wrapper del menú que permitirá escalar el contenido
      const menuWrapper = document.createElement('div');
      menuWrapper.style.cssText = `
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 5;
      `;

      // Contenedor interno que realmente alberga el menú (este será escalado)
      const menuContainer = document.createElement('div');
      menuContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 30px;
        position: relative;
        transform-origin: center center;
        transition: transform 200ms ease;
        display: none;
      `;
      
      // Botón de atrás arriba a la derecha
      const backBtn = document.createElement('button');
      backBtn.textContent = '← ATRÁS';
      backBtn.style.cssText = `
        position: absolute;
        top: 30px;
        right: 30px;
        padding: 12px 24px;
        font-size: 16px;
        font-weight: bold;
        font-family: "new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
        background: transparent;
        color: rgba(255, 255, 255, 0.8);
        border: 2px solid rgba(255, 255, 255, 0.8);
        border-radius: 6px;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 1px;
        transition: all 0.3s ease;
        pointer-events: auto;
      `;
      
      backBtn.addEventListener('mouseenter', () => {
        backBtn.style.transform = 'scale(1.05)';
        backBtn.style.background = 'rgba(255, 255, 255, 0.15)';
        backBtn.style.color = 'rgb(255, 255, 255)';
        backBtn.style.borderColor = 'rgb(255, 255, 255)';
      });
      
      backBtn.addEventListener('mouseleave', () => {
        backBtn.style.transform = 'scale(1)';
        backBtn.style.background = 'transparent';
        backBtn.style.color = 'rgba(255, 255, 255, 0.8)';
        backBtn.style.borderColor = 'rgba(255, 255, 255, 0.8)';
      });
      
      backBtn.addEventListener('click', () => {
        // Volver a la página de inicio
        location.hash = '#';
        finalizeAction('back');
      });

      // Botón de borrar progreso en la esquina
      const resetBtn = document.createElement('button');
      resetBtn.textContent = 'BORRAR PROGRESO';
      resetBtn.style.cssText = `
        position: absolute;
        bottom: 30px;
        right: 30px;
        padding: 12px 24px;
        font-size: 16px;
        font-weight: bold;
        font-family: "new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
        background: transparent;
        color: rgba(255, 100, 100, 0.8);
        border: 2px solid rgba(255, 100, 100, 0.8);
        border-radius: 6px;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 1px;
        transition: all 0.3s ease;
        pointer-events: auto;
      `;
      
      resetBtn.addEventListener('mouseenter', () => {
        resetBtn.style.transform = 'scale(1.05)';
        resetBtn.style.background = 'rgba(255, 100, 100, 0.15)';
        resetBtn.style.color = 'rgb(255, 100, 100)';
        resetBtn.style.borderColor = 'rgb(255, 100, 100)';
      });
      
      resetBtn.addEventListener('mouseleave', () => {
        resetBtn.style.transform = 'scale(1)';
        resetBtn.style.background = 'transparent';
        resetBtn.style.color = 'rgba(255, 100, 100, 0.8)';
        resetBtn.style.borderColor = 'rgba(255, 100, 100, 0.8)';
      });
      
      resetBtn.addEventListener('click', () => {
        if (!confirm('¿Estás seguro de que quieres borrar todo el progreso?')) return;

        // Limpieza completa del progreso (recorrido, río y simulador)
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('deltaPlus.')) {
            localStorage.removeItem(key);
          }
        });

        // Reset state
        State.resetAll();

        // Refrescar de inmediato el overlay de progreso a 0%
        if (window.progressManager) {
          window.progressManager.updateAllProgress();
        } else if (typeof window.updateProgressOverlay === 'function') {
          window.updateProgressOverlay();
        }

        console.log('🗑️ Todo el progreso ha sido borrado del localStorage');
        
        // Volver al inicio y recargar
        location.hash = '#menu';
        location.reload();
      });
      
      // Colocar los botones fuera del contenedor escalable, en el wrapper
      // para que permanezcan en las esquinas del viewport y no sean afectados por el scale.
      menuWrapper.appendChild(backBtn);
      menuWrapper.appendChild(resetBtn);

      // Insertar en el wrapper y luego en el overlay
      menuWrapper.appendChild(menuContainer);
      overlay.appendChild(menuWrapper);

      // --- Responsive scaling logic ---
      // Escala el menú hacia abajo cuando el aspect ratio es menor que 16:9
      // Use a base design resolution and scale down if either width or height
      // is smaller than the base. This avoids cropping on very wide but short screens.
      const BASE_WIDTH = 1920;
      const BASE_HEIGHT = 1080;
      const MIN_SCALE = 0.5;

      const updateMenuScale = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        // scale factors relative to base dimensions
        const scaleW = w / BASE_WIDTH;
        const scaleH = h / BASE_HEIGHT;
        // pick the smallest (so we never overflow either dimension) but never > 1
        let scale = Math.min(1, scaleW, scaleH);
        if (scale < MIN_SCALE) scale = MIN_SCALE;
        menuContainer.style.transform = `scale(${scale})`;
      };

      // Guarda referencia para limpieza posterior
      const handleResize = () => {
        updateMenuScale();
        applyCoverFit();
      };
      this._menuResizeHandler = handleResize;
      this._menuWrapper = menuWrapper;
      this._menuContainer = menuContainer;

      window.addEventListener('resize', this._menuResizeHandler);
      // Ejecutar inicialmente para ajustar al tamaño actual
      handleResize();
    });
  }

  ensureMenuFont() {
    // Cargar fuente de Adobe Typekit si no está cargada
    const fontLinkId = 'menu-font-kit';
    if (!document.getElementById(fontLinkId)) {
      const link = document.createElement('link');
      link.id = fontLinkId;
      link.rel = 'stylesheet';
      link.href = 'https://use.typekit.net/vmy8ypx.css';
      document.head.appendChild(link);
    }
  }

  async unmount() {
    // Detener y limpiar sonido ambiente
    if (this.ambientAudio) {
      this.ambientAudio.pause();
      this.ambientAudio.currentTime = 0;
      this.ambientAudio = null;
    }
    
    // Restaurar canvas
    this.app.canvas.style.display = '';
    document.body.style.cursor = 'auto';
    
    // Limpiar listener de resize si existe
    if (this._menuResizeHandler) {
      try {
        window.removeEventListener('resize', this._menuResizeHandler);
      } catch (e) {}
      this._menuResizeHandler = null;
    }

    // Remover wrapper del menú si quedó en el DOM
    if (this._menuWrapper && this._menuWrapper.parentNode) {
      this._menuWrapper.parentNode.removeChild(this._menuWrapper);
      this._menuWrapper = null;
      this._menuContainer = null;
    }

    // Restaurar barra de progreso si quedó dentro del overlay del menú
    if (this._restoreProgressOverlay) {
      this._restoreProgressOverlay();
      this._restoreProgressOverlay = null;
    }

    // Ocultar por completo la barra de progreso al salir del menú
    if (window.progressManager) {
      window.progressManager.setVisible(false, true);
    }

    // Limpiar cualquier overlay del menú que pueda haber quedado (fallback)
    const overlays = document.querySelectorAll('body > div');
    overlays.forEach(overlay => {
      // Solo eliminar overlays con z-index 10000 que son del menú
      const zIndex = window.getComputedStyle(overlay).zIndex;
      if (zIndex === '10000') {
        overlay.remove();
      }
    });
  }

  update(dt) {
    // No se necesita nada en el loop
  }

  render(renderer, dt) {
    // No renderizar nada (solo videos en overlay)
  }
}
