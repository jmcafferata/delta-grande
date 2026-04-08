import { BaseScene } from '../core/BaseScene.js';
import { getVideoSource } from '../core/VideoSupport.js';

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

export class LabTransitionScene extends BaseScene {
  constructor(app) {
    super(app);
    this.name = 'lab-transition';
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

    // Crear barras cinematográficas (letterbox)
    const topBar = document.createElement('div');
    topBar.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 12%;
      background: black;
      z-index: 10001;
      pointer-events: none;
    `;
    overlay.appendChild(topBar);

    const bottomBar = document.createElement('div');
    bottomBar.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 12%;
      background: black;
      z-index: 10001;
      pointer-events: none;
    `;
    overlay.appendChild(bottomBar);

    // Mostrar texto con efecto typewriter antes del video
    const skipIntro = await this.showTypewriterText(overlay);

    // Reproducir video de transición con logo y audios (solo si no se saltó)
    if (!skipIntro) {
      await this.playTransitionVideo(overlay);
    }

    // Limpiar overlay
    overlay.style.transition = 'opacity 0.5s';
    overlay.style.opacity = '0';
    await new Promise(resolve => setTimeout(resolve, 500));
    document.body.removeChild(overlay);
    
    // Restaurar cursor
    document.body.style.cursor = 'auto';

    // Ir a la escena de laboratorio
    location.hash = '#lab';
  }

  async showTypewriterText(overlay) {
    const lines = [
      'Tu rol',
      'Sos aprendiz de guardaparques.',
      'Tu misión es explorar un ecosistema del Delta del Paraná y descubrir su biodiversidad.',
      'Tu herramienta principal: la curiosidad y la capacidad de observación.',
      'Agudizá los sentidos, la naturaleza se muestra a quien sabe observar.',
      'Usá tu silencio: la naturaleza habla bajito.'
    ];

    const textContainer = document.createElement('div');
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
    `;
    overlay.appendChild(textContainer);

    // Logo arriba
    const logo = document.createElement('video');
    logo.src = getVideoSource('/game-assets/recorrido/interfaz/logo_naranja_alpha.webm');
    logo.style.cssText = `
      position: absolute;
      top: 8%;
      left: 50%;
      transform: translateX(-50%);
      width: 200px;
      height: auto;
      z-index: 10003;
      opacity: 0;
      transition: opacity 0.8s ease-in-out;
    `;
    logo.muted = true;
    logo.playsInline = true;
    logo.loop = true;
    overlay.appendChild(logo);

    // Reproducir logo
    logo.play().catch(() => {});
    requestAnimationFrame(() => {
      logo.style.opacity = '1';
    });

    // Indicador de click
    const clickIndicator = document.createElement('div');
    clickIndicator.style.cssText = `
      position: absolute;
      bottom: 15%;
      left: 50%;
      transform: translateX(-50%);
      color: ${EFEDRA_OVERLAY_THEME.colors.text};
      font-family: ${EFEDRA_OVERLAY_THEME.fonts.family};
      font-size: 0.9em;
      text-align: center;
      text-shadow: 0 0 12px ${EFEDRA_OVERLAY_THEME.colors.textShadow};
      animation: pulse 2s ease-in-out infinite;
      z-index: 10003;
      opacity: 0;
      transition: opacity 0.5s;
    `;
    clickIndicator.textContent = 'Click para continuar';
    overlay.appendChild(clickIndicator);

    // Botón "Saltear intro"
    const skipButton = document.createElement('button');
    skipButton.textContent = 'SALTEAR INTRO';
    skipButton.style.cssText = `
      position: absolute;
      top: 5%;
      right: 5%;
      padding: 12px 24px;
      font-size: 0.9em;
      font-weight: bold;
      font-family: ${EFEDRA_OVERLAY_THEME.fonts.family};
      background: transparent;
      color: ${EFEDRA_OVERLAY_THEME.colors.text};
      border: 2px solid ${EFEDRA_OVERLAY_THEME.colors.text};
      border-radius: 6px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 1px;
      transition: all 0.3s ease;
      z-index: 10004;
      opacity: 0.7;
    `;
    overlay.appendChild(skipButton);

    // Variable para controlar si se saltea la intro
    let skipIntro = false;

    // Efectos hover del botón
    skipButton.addEventListener('mouseenter', () => {
      skipButton.style.opacity = '1';
      skipButton.style.transform = 'scale(1.05)';
      skipButton.style.background = 'rgba(255, 201, 106, 0.1)';
    });
    
    skipButton.addEventListener('mouseleave', () => {
      skipButton.style.opacity = '0.7';
      skipButton.style.transform = 'scale(1)';
      skipButton.style.background = 'transparent';
    });

    // Click para saltear
    skipButton.addEventListener('click', () => {
      skipIntro = true;
    });

    // Agregar animación de pulso
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 0.4; transform: translateX(-50%) scale(1); }
        50% { opacity: 0.8; transform: translateX(-50%) scale(1.05); }
      }
      @keyframes slideUp {
        from { opacity: 1; transform: translateY(0); }
        to { opacity: 0; transform: translateY(-30px); }
      }
      @keyframes slideIn {
        from { opacity: 0; transform: translateY(30px); }
        to { opacity: 0.95; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);

    // Fade in del contenedor
    requestAnimationFrame(() => {
      textContainer.style.opacity = '1';
    });

    await new Promise(resolve => setTimeout(resolve, 800));

    for (let i = 0; i < lines.length; i++) {
      // Verificar si se saltó la intro
      if (skipIntro) {
        break;
      }

      const line = lines[i];
      const lineElement = document.createElement('div');
      lineElement.style.cssText = `
        color: ${EFEDRA_OVERLAY_THEME.colors.text};
        font-family: ${EFEDRA_OVERLAY_THEME.fonts.family};
        font-size: ${i === 0 ? '2.5em' : '1.4em'};
        font-weight: ${i === 0 ? 'bold' : 'normal'};
        margin: ${i === 0 ? '0 0 1.5em 0' : '0.5em 0'};
        text-align: center;
        line-height: 1.6;
        text-shadow: 0 0 18px ${EFEDRA_OVERLAY_THEME.colors.textShadow};
        opacity: 0;
        animation: slideIn 0.6s ease-out forwards;
      `;
      textContainer.appendChild(lineElement);

      // Variables de control para el typewriter
      let isTyping = true;
      let skipTyping = false;
      let advanceToNext = false;

      // Mostrar indicador de click desde el inicio
      clickIndicator.style.opacity = '1';

      // Configurar click handler que puede interrumpir el typewriter
      const clickHandler = () => {
        if (isTyping) {
          // Si está escribiendo, completar el texto inmediatamente
          skipTyping = true;
        } else {
          // Si ya terminó de escribir, avanzar a la siguiente línea
          advanceToNext = true;
        }
      };
      overlay.addEventListener('click', clickHandler);

      // Efecto typewriter con pausas en puntuación
      for (let j = 0; j < line.length; j++) {
        if (skipTyping) {
          // Completar el texto inmediatamente
          lineElement.textContent = line;
          break;
        }
        
        lineElement.textContent += line[j];
        
        // Determinar delay según el carácter
        let delay = 40; // delay normal
        const char = line[j];
        
        if (char === ',' || char === ';') {
          delay = 300; // pausa en coma o punto y coma
        } else if (char === '.' || char === ':') {
          delay = 400; // pausa más larga en punto o dos puntos
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Marcar que terminó de escribir
      isTyping = false;

      // Si no se clickeó durante el typewriter, esperar click
      if (!skipTyping && !advanceToNext) {
        await new Promise(resolve => {
          const checkAdvance = setInterval(() => {
            if (advanceToNext) {
              clearInterval(checkAdvance);
              resolve();
            }
          }, 50);
        });
      }

      // Remover event listener
      overlay.removeEventListener('click', clickHandler);

      // Verificar si se saltó la intro
      if (skipIntro) {
        break;
      }

      // Animar salida de la línea actual (excepto la última)
      if (i < lines.length - 1) {
        lineElement.style.animation = 'slideUp 0.4s ease-in forwards';
        clickIndicator.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 200));
      } else {
        // Última línea - pausa automática
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    // Mantener el texto visible un momento (solo si no se saltó)
    if (!skipIntro) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Fade out del texto
    textContainer.style.opacity = '0';
    clickIndicator.style.opacity = '0';
    skipButton.style.opacity = '0';
    logo.style.opacity = '0';
    await new Promise(resolve => setTimeout(resolve, 800));
    textContainer.remove();
    clickIndicator.remove();
    skipButton.remove();
    logo.remove();
    style.remove();

    // Retornar si se saltó la intro
    return skipIntro;
  }

  async playTransitionVideo(overlay) {
    return new Promise((resolve) => {
      // Logo naranja alpha - pantalla completa
      const logo = document.createElement('video');
      logo.src = getVideoSource('/game-assets/menu/logo_naranja_alpha.webm');
      logo.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        z-index: 10003;
        opacity: 1;
        pointer-events: none;
        transition: opacity 1s ease-out;
      `;
      logo.muted = true;
      logo.playsInline = true;
      logo.loop = true;
      overlay.appendChild(logo);

      // Video mapa gigante - centrado verticalmente (inicia invisible)
      const video = document.createElement('video');
      video.src = getVideoSource('/game-assets/laboratorio/cinematicas/mapa_gigante.webm');
      video.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 0;
        pointer-events: none;
        z-index: 10002;
        transition: opacity 1s ease-in-out;
      `;
      video.muted = true;
      video.playsInline = true;
      overlay.appendChild(video);

      // Audio intro dron sin bola (empieza inmediatamente)
      const audioDron = new Audio('/game-assets/laboratorio/intro dron sin bola.mp3');
      audioDron.volume = 1.0;

      // Audio glitch bola (empieza 7s después: 2s delay + 5s originales)
      const audioGlitch = new Audio('/game-assets/laboratorio/glitch bola.mp3');
      audioGlitch.volume = 1.0;

      // Reproducir logo inmediatamente
      logo.play().catch(() => {});
      
      // Reproducir video mapa gigante inmediatamente pero invisible
      video.play().catch(() => {});
      
      // Iniciar audio dron inmediatamente
      audioDron.play().catch((err) => {
        console.warn('No se pudo reproducir audio dron:', err);
      });

      // Después de 3 segundos: hacer fade in del mapa gigante (se superpone con el logo)
      setTimeout(() => {
        video.style.opacity = '1';
      }, 3000);

      // Después de 5 segundos (3s logo solo + 2s superpuesto): fadeout del logo
      setTimeout(() => {
        logo.style.opacity = '0';
        setTimeout(() => {
          if (logo.parentNode) logo.parentNode.removeChild(logo);
        }, 1000);
      }, 4000);

      // Iniciar audio glitch después de 8 segundos (3s logo solo + 5s)
      setTimeout(() => {
        audioGlitch.play().catch((err) => {
          console.warn('No se pudo reproducir audio glitch:', err);
        });
      }, 5000);

      // Detectar cuando el video está por terminar para hacer fade out anticipado
      video.addEventListener('loadedmetadata', () => {
        const fadeOutTime = Math.max(0, video.duration - 2); // Fade out 2 segundos antes del final
        
        const checkTime = () => {
          if (video.currentTime >= fadeOutTime) {
            video.style.opacity = '0';
            video.removeEventListener('timeupdate', checkTime);
          }
        };
        
        video.addEventListener('timeupdate', checkTime);
      });

      // Cuando termine el video, limpiar
      video.addEventListener('ended', () => {
        audioDron.pause();
        audioGlitch.pause();
        audioDron.currentTime = 0;
        audioGlitch.currentTime = 0;
        
        setTimeout(() => {
          if (video.parentNode) video.parentNode.removeChild(video);
          if (logo.parentNode) logo.parentNode.removeChild(logo);
          resolve();
        }, 1000);
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
