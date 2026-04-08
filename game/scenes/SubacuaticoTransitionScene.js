import { BaseScene } from '../core/BaseScene.js';
import { getVideoSource } from '../core/VideoSupport.js';

export class SubacuaticoTransitionScene extends BaseScene {
  constructor(app) {
    super(app);
    this.name = 'subacuatico-transition';
  }

  async mount() {
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
      opacity: 1;
    `;
    document.body.appendChild(overlay);

    // Reproducir video de transición
    await this.playTransitionVideo(overlay);

    // Limpiar overlay
    overlay.style.transition = 'opacity 0.5s';
    overlay.style.opacity = '0';
    await new Promise(resolve => setTimeout(resolve, 500));
    document.body.removeChild(overlay);
    
    // Restaurar cursor
    document.body.style.cursor = 'auto';

    // Ir a la escena subacuática
    location.hash = '#rio';
  }

  async playTransitionVideo(overlay) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.src = getVideoSource('/game-assets/transiciones/lab-a-subacua.webm');
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
      video.muted = false;
      video.playsInline = true;

      overlay.appendChild(video);

      // Fade in desde negro
      requestAnimationFrame(() => {
        video.style.opacity = '1';
      });

      // Reproducir video
      video.play().catch((err) => {
        console.warn('[SubacuaticoTransitionScene] Error playing video:', err);
        // Si el video falla (ej: Safari sin soporte), resolver directamente
        resolve();
      });

      // Timeout de seguridad: si el video no termina en 30s, continuar
      const safetyTimeout = setTimeout(() => {
        console.warn('[SubacuaticoTransitionScene] Video timeout, continuing...');
        if (video.parentNode) video.parentNode.removeChild(video);
        resolve();
      }, 30000);

      // Si el video tiene error al cargar, resolver
      video.addEventListener('error', () => {
        console.warn('[SubacuaticoTransitionScene] Video load error, skipping transition');
        clearTimeout(safetyTimeout);
        if (video.parentNode) video.parentNode.removeChild(video);
        resolve();
      }, { once: true });

      // Cuando termine el video, hacer fade out
      video.addEventListener('ended', () => {
        clearTimeout(safetyTimeout);
        // Fade out a negro
        video.style.opacity = '0';
        
        setTimeout(() => {
          if (video.parentNode) video.parentNode.removeChild(video);
          resolve();
        }, 1000); // Esperar a que termine el fade out
      });
    });
  }

  async unmount() {
    // Restaurar canvas
    this.app.canvas.style.display = '';
    document.body.style.cursor = 'auto';
  }

  update(dt) {
    // No se necesita nada en el loop
  }

  render(renderer, dt) {
    // No renderizar nada (solo video en overlay)
  }
}
