import { BaseScene } from '../core/BaseScene.js';

// Tema visual consistente con RecorridoScene
const EFEDRA_OVERLAY_THEME = {
  fontKitHref: 'https://use.typekit.net/vmy8ypx.css',
  fonts: {
    family: `"new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`
  },
  colors: {
    text: '#FBFE5E', // Amarillo principal del proyecto
    textShadow: 'rgba(0, 0, 0, 0.45)'
  }
};

export class InstruccionesTransitionScene extends BaseScene {
  constructor(app) {
    super(app);
    this.name = 'instrucciones-transition';
  }

  async mount() {
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

    // Calcular escala responsive basada en 1920x1080
    const BASE_WIDTH = 1920;
    const BASE_HEIGHT = 1080;
    const getScale = () => {
      const scaleX = window.innerWidth / BASE_WIDTH;
      const scaleY = window.innerHeight / BASE_HEIGHT;
      return Math.min(scaleX, scaleY);
    };
    this.scale = getScale();
    
    // Actualizar escala en resize
    this.resizeHandler = () => {
      this.scale = getScale();
      if (this.textContainer) {
        this.textContainer.style.transform = `scale(${this.scale})`;
      }
      if (this.logo) {
        this.logo.style.transform = `translateX(-50%) scale(${this.scale})`;
      }
      if (this.clickIndicator) {
        this.clickIndicator.style.transform = `translateX(-50%) scale(${this.scale})`;
      }
      if (this.skipButton) {
        this.skipButton.style.transform = `scale(${this.scale})`;
      }
    };
    window.addEventListener('resize', this.resizeHandler);
    
    // Crear overlay con fondo estático web-bg
    const overlay = document.createElement('div');
    // clase para estilos específicos del overlay de instrucciones
    overlay.className = 'efedra-instrucciones-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      pointer-events: auto;
      opacity: 1;
      overflow: hidden;
      background-image: url('/assets/web-bgs/D+fondo_para_web_01.webp');
      background-position: top center;
      background-repeat: no-repeat;
      background-size: cover;
      background-attachment: scroll;
    `;
    document.body.appendChild(overlay);

    // Agregar nubes animadas
    const cloud1 = document.createElement('div');
    cloud1.style.cssText = `
      position: absolute;
      inset: -14%;
      background: url('/assets/nube.png') center center / contain no-repeat;
      mix-blend-mode: lighten;
      opacity: 0.3;
      filter: hue-rotate(-8deg) saturate(1.05) brightness(1.06);
      pointer-events: none;
      z-index: 1;
      animation: cloudTintCycle 20s ease-in-out infinite alternate, cloudDrift 32s ease-in-out infinite alternate;
    `;
    overlay.appendChild(cloud1);

    const cloud2 = document.createElement('div');
    cloud2.style.cssText = `
      position: absolute;
      inset: -14%;
      background: url('/assets/nube.png') center center / contain no-repeat;
      mix-blend-mode: lighten;
      opacity: 0.26;
      filter: hue-rotate(-8deg) saturate(1.05) brightness(1.04);
      pointer-events: none;
      z-index: 1;
      animation: cloudTintCycle 20s ease-in-out infinite alternate, cloudDriftFlip 32s ease-in-out infinite alternate;
    `;
    overlay.appendChild(cloud2);

    // Agregar sonido ambiente
    const ambientSound = document.createElement('audio');
    ambientSound.src = '/assets/delta-web-ambiente.mp3';
    ambientSound.loop = true;
    ambientSound.volume = 0.5;
    ambientSound.play().catch((err) => {
      console.warn('No se pudo reproducir sonido ambiente:', err);
    });

    // Mostrar texto con efecto typewriter
    await this.showTypewriterText(overlay);

    // Detener sonido ambiente antes de salir
    if (ambientSound && !ambientSound.paused) {
      ambientSound.pause();
      ambientSound.currentTime = 0;
    }

    // Limpiar overlay
    overlay.style.transition = 'opacity 0.5s';
    overlay.style.opacity = '0';
    await new Promise(resolve => setTimeout(resolve, 500));
    if (document.body.contains(overlay)) {
      document.body.removeChild(overlay);
    }
    
    // Restaurar cursor
    document.body.style.cursor = 'auto';

    // Navigate to recorrido-transition after transition completes
    location.hash = '#recorrido-transition';
  }

  async showTypewriterText(overlay) {
    const lines = [
      'Tu rol',
      'Sos aprendiz de guardaparques.',
      'Tu misión es explorar un ecosistema del Delta del Paraná\ny descubrir su biodiversidad.',
      'Tu herramienta principal: la curiosidad\ny la capacidad de observación.',
      'Agudizá los sentidos,\nla naturaleza se muestra a quien sabe observar.',
      'Usá tu silencio: la naturaleza habla bajito.'
    ];

    const audioFiles = [
      'tu_rol.mp3',
      'sos_aprendiz.mp3',
      'tu_mision.mp3',
      'tu_herramienta.mp3',
      'agudiza_sentidos.mp3',
      'usa_silencio.mp3'
    ];

    const textContainer = document.createElement('div');
    this.textContainer = textContainer;
    textContainer.style.cssText = `
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0 10%;
      z-index: 10002;
      opacity: 0;
      transition: opacity 0.8s ease-in-out;
      transform: scale(${this.scale});
      transform-origin: center center;
    `;
    overlay.appendChild(textContainer);

    
    // Botón de saltear
    const skipButton = document.createElement('button');
    this.skipButton = skipButton;
    skipButton.textContent = 'SALTEAR';
    skipButton.style.cssText = `
      position: absolute;
      top: 5%;
      right: 5%;
      transform: scale(${this.scale});
      transform-origin: top right;
      padding: 12px 24px;
      background: rgba(255, 201, 106, 0.15);
      border: 2px solid ${EFEDRA_OVERLAY_THEME.colors.text};
      color: ${EFEDRA_OVERLAY_THEME.colors.text};
      font-family: ${EFEDRA_OVERLAY_THEME.fonts.family};
      font-size: 16px;
      font-weight: bold;
      letter-spacing: 0.08em;
      cursor: pointer;
      z-index: 10004;
      opacity: 0;
      transition: all 0.3s ease;
      pointer-events: auto;
      text-shadow: 0 0 14px ${EFEDRA_OVERLAY_THEME.colors.textShadow};
    `;
    overlay.appendChild(skipButton);

    // Hover effect para el botón
    skipButton.addEventListener('mouseenter', () => {
      skipButton.style.background = `rgba(255, 201, 106, 0.35)`;
      skipButton.style.transform = `scale(${this.scale * 1.05})`;
    });
    skipButton.addEventListener('mouseleave', () => {
      skipButton.style.background = `rgba(255, 201, 106, 0.15)`;
      skipButton.style.transform = `scale(${this.scale})`;
    });

    // Variable para controlar si se saltea
    this.skipRequested = false;

    // Handler para el botón de saltear - ir directo a recorrido
    skipButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.skipRequested = true;
      
      // Limpiar elementos y navegar
      overlay.style.transition = 'opacity 0.3s';
      overlay.style.opacity = '0';
      setTimeout(() => {
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
        document.body.style.cursor = 'auto';
        // Navigate after cleanup
        location.hash = '#recorrido-transition';
      }, 300);
    });

    // Indicador de click
    const clickIndicator = document.createElement('div');
    this.clickIndicator = clickIndicator;
    clickIndicator.className = 'efedra-click-indicator';
    clickIndicator.style.cssText = `
      position: absolute;
      bottom: 12%;
      left: 50%;
      transform: translateX(-50%) scale(${this.scale});
      transform-origin: center center;
      color: ${EFEDRA_OVERLAY_THEME.colors.text};
      font-family: ${EFEDRA_OVERLAY_THEME.fonts.family};
      font-size: 0.95em;
      text-align: center;
      text-shadow: 0 0 14px ${EFEDRA_OVERLAY_THEME.colors.textShadow};
      z-index: 10003;
      opacity: 0;
      transition: opacity 0.5s ease;
      pointer-events: none;
    `;
    clickIndicator.innerHTML = `
      <span style="display:inline-block; letter-spacing:0.04em;">Click para continuar</span>
      <div class="efedra-ripple r1" style="position:absolute; left:50%; transform:translateX(-50%); width:64px; height:64px; border-radius:50%; border:1px solid ${EFEDRA_OVERLAY_THEME.colors.text}; opacity:.25; top:-28px;"></div>
      <div class="efedra-ripple r2" style="position:absolute; left:50%; transform:translateX(-50%); width:64px; height:64px; border-radius:50%; border:1px solid ${EFEDRA_OVERLAY_THEME.colors.text}; opacity:.25; top:-28px;"></div>
    `;
    overlay.appendChild(clickIndicator);

    // Agregar animación de pulso y nubes
    const style = document.createElement('style');
    style.textContent = `
      /* Indicador con ondas/ripples */
      @keyframes clickFloat {
        0%,100% { transform: translate(-50%, 0); }
        50% { transform: translate(-50%, -6px); }
      }
      @keyframes rippleGrow {
        0% { transform: translate(-50%, 0) scale(0.7); opacity: 0.35; }
        70% { opacity: 0.08; }
        100% { transform: translate(-50%, 0) scale(1.25); opacity: 0; }
      }
      .efedra-click-indicator { animation: clickFloat 2.8s ease-in-out infinite; }
      .efedra-click-indicator .efedra-ripple.r1 { animation: rippleGrow 2.8s ease-in-out infinite; animation-delay: .0s; }
      .efedra-click-indicator .efedra-ripple.r2 { animation: rippleGrow 2.8s ease-in-out infinite; animation-delay: 1.4s; }

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

      /* Animaciones de nubes */
      @keyframes cloudTintCycle {
        0% {
          opacity: 0.2;
          filter: hue-rotate(-12deg) saturate(0.95) brightness(1.02);
        }
        50% {
          opacity: 0.42;
          filter: hue-rotate(24deg) saturate(1.25) brightness(1.12);
        }
        100% {
          opacity: 0.26;
          filter: hue-rotate(-18deg) saturate(1.05) brightness(1.08);
        }
      }

      @keyframes cloudDrift {
        0% {
          transform: translateX(-12%) scale(1.2);
        }
        100% {
          transform: translateX(12%) scale(1.2);
        }
      }

      @keyframes cloudDriftFlip {
        0% {
          transform: translateX(12%) scale(1.2) scaleY(-1);
        }
        100% {
          transform: translateX(-12%) scale(1.2) scaleY(-1);
        }
      }
    `;
    document.head.appendChild(style);

    // Fade in del contenedor y botón de saltear
    requestAnimationFrame(() => {
      textContainer.style.opacity = '1';
      this.skipButton.style.opacity = '1';
    });

    await new Promise(resolve => setTimeout(resolve, 800));

    // Crear contenedor fijo para el texto actual
    const currentLineContainer = document.createElement('div');
    currentLineContainer.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 80%;
      max-width: 1200px;
    `;
    textContainer.appendChild(currentLineContainer);

    let currentAudio = null;

    for (let i = 0; i < lines.length; i++) {
      // Si se solicitó saltear, salir del loop
      if (this.skipRequested) {
        if (currentAudio) {
          currentAudio.pause();
          currentAudio = null;
        }
        break;
      }
      const line = lines[i];

      // Play audio
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      if (audioFiles[i]) {
        currentAudio = new Audio(`/game-assets/instrucciones/voiceovers/${audioFiles[i]}`);
        currentAudio.volume = 1.0;
        currentAudio.play().catch(e => console.warn("Audio play failed", e));
      }
      
      // Limpiar el contenedor antes de agregar nueva línea
      currentLineContainer.innerHTML = '';
      currentLineContainer.style.opacity = '1'; // Resetear opacidad para la nueva línea
      
      const lineElement = document.createElement('div');
      // Base font sizes for 1920x1080 (will scale with container)
      const baseFontSize = i === 0 ? 48 : 27;
      lineElement.style.cssText = `
        color: ${EFEDRA_OVERLAY_THEME.colors.text};
        font-family: ${EFEDRA_OVERLAY_THEME.fonts.family};
        font-size: ${baseFontSize}px;
        font-weight: ${i === 0 ? 'bold' : 'normal'};
        margin: ${i === 0 ? '0 0 1.5em 0' : '0.5em 0'};
        text-align: center;
        line-height: 1.6;
        animation: fadeWaveIn 0.6s ease-out forwards;
      `;
      currentLineContainer.appendChild(lineElement);

      // Construir spans por carácter para animación de ondas
      const spans = [];
      const parts = line.split(/(\n)/); // Separa por \n pero mantiene el delimitador

      for (const part of parts) {
        if (part === '\n') {
          lineElement.appendChild(document.createElement('br'));
        } else {
          for (let c = 0; c < part.length; c++) {
            const ch = part[c] === ' ' ? '\u00A0' : part[c];
            const s = document.createElement('span');
            s.textContent = ch;
            s.style.display = 'inline-block';
            s.style.opacity = '0';
            s.style.transform = 'translateY(10px)';
            s.style.filter = 'blur(3px)';
            s.style.transition = 'opacity 220ms ease-out, transform 360ms ease-out, filter 480ms ease-out';
            s.style.willChange = 'transform, opacity, filter';
            // Animación continua de onda una vez revelado
            s.style.setProperty('--waveAmp', i === 0 ? '8px' : '5px');
            s.style.animation = `charWave ${i === 0 ? 2600 : 2800}ms ease-in-out ${c * 60}ms infinite`;
            lineElement.appendChild(s);
            spans.push(s);
          }
        }
      }

      // Variables de control para el typewriter
      let isTyping = true;
      let skipTyping = false;
      let advanceToNext = false;

      // Mostrar indicador de click desde el inicio
      clickIndicator.style.opacity = '1';

      // Configurar click handler: completa el texto si está escribiendo, o avanza si ya terminó
      const clickHandler = () => {
        if (isTyping) {
          skipTyping = true; // completar inmediatamente toda la frase
        } else {
          advanceToNext = true; // pasar a la siguiente línea inmediatamente
        }
      };
      overlay.addEventListener('click', clickHandler);

      // Efecto typewriter revelando spans y manteniendo onda
      for (let j = 0; j < spans.length; j++) {
        // Si se solicitó saltear, salir
        if (this.skipRequested) {
          skipTyping = true;
        }

        if (skipTyping) {
          // Revelar todos de golpe
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

        // Pausas según puntuación del carácter recién revelado
        let delay = 40; // base
        const char = line[j];
        if (char === ',' || char === ';') delay = 300;
        else if (char === '.' || char === ':') delay = 400;
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Marcar que terminó de escribir
      isTyping = false;

      // Si se solicitó saltear, no esperar
      if (this.skipRequested) {
        advanceToNext = true;
      }

      // Pequeña pausa para que el usuario vea el texto completo antes de poder avanzar
      if (!this.skipRequested) {
        await new Promise(resolve => setTimeout(resolve, 400));
      }

      // Si no se clickeó, esperar click para avanzar
      if (!advanceToNext && !this.skipRequested) {
        await new Promise(resolve => {
          const checkAdvance = setInterval(() => {
            if (advanceToNext || this.skipRequested) { clearInterval(checkAdvance); resolve(); }
          }, 50);
        });
      }

      // Remover event listener
      overlay.removeEventListener('click', clickHandler);

      // Transición a la siguiente línea (excepto la última)
      if (i < lines.length - 1) {
        clickIndicator.style.opacity = '0';
        
        // Simplemente hacer fade out sin animación de movimiento
        currentLineContainer.style.transition = 'opacity 0.3s ease';
        currentLineContainer.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 300));
      } else {
        // Última línea - pausa automática
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    // Stop any playing audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    // Mantener el texto visible un momento
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Fade out del texto
    textContainer.style.opacity = '0';
    clickIndicator.style.opacity = '0';
    await new Promise(resolve => setTimeout(resolve, 800));
    textContainer.remove();
    clickIndicator.remove();
    style.remove();
  }

  async unmount() {
    // Limpiar resize handler
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
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
