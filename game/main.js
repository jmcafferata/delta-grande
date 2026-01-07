import { App } from './core/App.js';
import { Router } from './core/Router.js';
import { SceneManager } from './core/SceneManager.js';
import { EventBus } from './core/EventBus.js';
import { State } from './core/State.js';
import { UI } from './core/UI.js';


import { MenuScene } from './scenes/MenuScene.js';
import { LabScene } from './scenes/LabScene.js';
import { InstruccionesTransitionScene } from './scenes/InstruccionesTransitionScene.js';
import { RecorridoTransitionScene } from './scenes/RecorridoTransitionScene.js';
import { SubacuaticoTransitionScene } from './scenes/SubacuaticoTransitionScene.js';
import { RecorridoScene } from './scenes/RecorridoScene.js';
import { SimuladorScene } from './scenes/SimuladorScene.js';
import { RioScene } from './scenes/RioScene.js';


// App singleton
const app = new App('#app');


// UI overlays (hud)
UI.init({
  app,
  videoOverlayEl: document.getElementById('videoOverlay'),
  videoEl: document.getElementById('transition_video') // Changed from labVideo to transition_video for transitions
});


// Global router + scenes
const scenes = {
menu: () => new MenuScene(app),
lab: () => new LabScene(app),
'instrucciones-transition': () => new InstruccionesTransitionScene(app),
'recorrido-transition': () => new RecorridoTransitionScene(app),
'subacuatico-transition': () => new SubacuaticoTransitionScene(app),
recorrido: () => new RecorridoScene(app),
simulador: () => new SimuladorScene(app),
rio: () => new RioScene(app)
};


const sceneManager = new SceneManager(app, scenes);
const router = new Router({
onRoute: (route) => {
const name = route.replace(/^#/, '') || 'menu';
sceneManager.goTo(name);
}
});


// Topbar buttons navigation
for (const btn of document.querySelectorAll('[data-nav]')) {
btn.addEventListener('click', () => router.navigate(btn.dataset.nav));
}

// Menu button navigation
const menuButton = document.getElementById('menuButton');
if (menuButton) {
  menuButton.addEventListener('click', () => {
    router.navigate('#menu');
  });
}


const pauseOverlay = document.getElementById('pauseOverlay');
const mainMenuOverlay = document.getElementById('mainMenuOverlay');

const pauseButtons = {
resume: pauseOverlay?.querySelector('[data-action="resume"]'),
restart: pauseOverlay?.querySelector('[data-action="restart"]'),
exit: pauseOverlay?.querySelector('[data-action="exit"]')
};

const mainButtons = {
continue: mainMenuOverlay?.querySelector('[data-action="continue"]'),
new: mainMenuOverlay?.querySelector('[data-action="new"]'),
options: mainMenuOverlay?.querySelector('[data-action="options"]'),
quit: mainMenuOverlay?.querySelector('[data-action="quit"]')
};

const setOverlayVisible = (overlay, visible) => {
if (!overlay) return;
overlay.classList.toggle('is-visible', visible);
overlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
};

const updateContinueAvailability = () => {
if (!mainButtons.continue) return;
const canContinue = !!sceneManager.currentName;
mainButtons.continue.disabled = !canContinue;
mainButtons.continue.setAttribute('aria-disabled', canContinue ? 'false' : 'true');
};

const showPauseMenu = () => {
if (!pauseOverlay || !mainMenuOverlay) return;
if (mainMenuOverlay.classList.contains('is-visible')) return;
setOverlayVisible(pauseOverlay, true);
app.pause();
};

const hidePauseMenu = ({ keepPaused = false } = {}) => {
if (!pauseOverlay) return;
setOverlayVisible(pauseOverlay, false);
if (!keepPaused && !mainMenuOverlay?.classList.contains('is-visible')) {
app.resume();
}
};

const showMainMenu = () => {
if (!mainMenuOverlay) return;
setOverlayVisible(pauseOverlay, false);
setOverlayVisible(mainMenuOverlay, true);
app.pause();
updateContinueAvailability();
};

const hideMainMenu = () => {
if (!mainMenuOverlay) return;
setOverlayVisible(mainMenuOverlay, false);
if (!pauseOverlay?.classList.contains('is-visible')) {
app.resume();
}
};

// Expose pause menu controls so in-scene interactions (e.g., map overlay) can trigger them
window.showPauseMenu = showPauseMenu;
window.hidePauseMenu = hidePauseMenu;

pauseButtons.resume?.addEventListener('click', () => hidePauseMenu());

pauseButtons.restart?.addEventListener('click', async () => {
  if (!sceneManager.currentName) return;
  
  // Si estamos en RecorridoScene, reiniciar la ronda actual
  if (sceneManager.currentName === 'recorrido') {
    const recorridoScene = sceneManager.instance;
    if (recorridoScene && recorridoScene.speciesManager) {
      console.log('🔄 Reiniciando ronda actual...');
      
      // Borrar progreso de la ronda actual (especies encontradas)
      recorridoScene.speciesManager.clearCurrentRoundProgress();
      
      // Calcular el índice de escena para el ambiente 1 de la ronda actual
      // Las 6 escenas se reciclan: Ronda 1 = escenas 0-5, Ronda 2 = escenas 0-5, etc.
      const sceneIndex = 0; // Ambiente 1 siempre es escena 0 (dentro de cualquier ronda)
      
      // Recargar la escena 0 (ambiente 1)
      await recorridoScene.loadStage(sceneIndex);
      
      console.log('✅ Reinicio completado - Volviendo al inicio de la ronda');
    }
  } else {
    // Para otras escenas, simplemente recargar
    await sceneManager.goTo(sceneManager.currentName);
  }
  
  hidePauseMenu();
});

pauseButtons.exit?.addEventListener('click', () => {
  hidePauseMenu({ keepPaused: false });
  // Navegar al menú y recargar la página para asegurar un estado limpio.
  // Establecemos el hash y luego recargamos, de forma similar a `resetearProgreso`.
  try {
    location.hash = '#menu';
    location.reload();
  } catch (e) {
    // Fallback: navegar con el router si reload falla
    console.warn('Reload failed, navigating via router', e);
    router.navigate('#menu');
  }
});

mainButtons.continue?.addEventListener('click', () => {
if (!sceneManager.currentName) return;
hideMainMenu();
});

mainButtons.new?.addEventListener('click', async () => {
  if (confirm('¿Estás seguro de que quieres comenzar de nuevo? Se borrará todo tu progreso.')) {
    // Clear all deltaPlus related localStorage data
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('deltaPlus.')) {
        localStorage.removeItem(key);
      }
    });
    
    // Reset game state but keep hasSeenIntro=true (skip full intro, show only logo)
    State.resetProgress();
    
    console.log('✅ Progreso borrado. Iniciando nuevo juego...');
    
    // Update progress overlay to 0%
    if (window.progressManager) {
      window.progressManager.updateAllProgress();
    }
    
    // Navigate to MenuScene (solo logo-naranja.webm)
    hideMainMenu();
    router.navigate('#menu');
    
    // Reload to ensure clean state
    setTimeout(() => location.reload(), 100);
  }
});

mainButtons.options?.addEventListener('click', () => {
alert('Opciones disponibles próximamente.');
});

mainButtons.quit?.addEventListener('click', () => {
window.location.href = '../index.html';
});

addEventListener('keydown', (event) => {
if (event.key !== 'Escape') return;
if (UI.videoOverlayEl && UI.videoOverlayEl.style.display !== 'none') return;
if (!pauseOverlay || !mainMenuOverlay) return;
if (mainMenuOverlay.classList.contains('is-visible')) return;
if (pauseOverlay.classList.contains('is-visible')) {
hidePauseMenu();
} else {
showPauseMenu();
}
});


// Initialize everything
async function startApp() {
  // Start the application
  app.start();
  router.boot(); // reads current hash and triggers first scene

  // 🎬 Ir a menu principal si no hay hash especificado
  if (!location.hash || location.hash === '#') {
    location.hash = '#menu';
  }

  EventBus.on('scene:changed', updateContinueAvailability);
  
  // No mostrar el overlay de progreso automáticamente al inicio.
  // El MenuScene controla cuándo se muestra (después del loader de laboratorio).
}

// Start the application
startApp();


// 🔄 Global functions for resetting game progress
window.resetearProgreso = () => {
  if (confirm('¿Estás seguro de que quieres borrar todo el progreso y volver al inicio? Esta acción no se puede deshacer.')) {
    // Clear all deltaPlus related localStorage data
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('deltaPlus.')) {
        localStorage.removeItem(key);
      }
    });

    // Clear State data
    State.resetAll();
    
    console.log('✅ Progreso borrado. Recargando página...');
    
    // Update progress overlay to 0%
    if (window.progressManager) {
      window.progressManager.updateAllProgress();
    }
    
    // Reload page to start fresh
    location.hash = '#menu';
    location.reload();
  }
};

window.volverAlInicio = () => {
  console.log('🔄 Volviendo al menú inicial...');
  location.hash = '#menu';
};

console.log('═══════════════════════════════════════════════════');
console.log('🎮 COMANDOS GLOBALES DISPONIBLES:');
console.log('═══════════════════════════════════════════════════');
console.log('  resetearProgreso() - Borrar TODO el progreso y volver al inicio');
console.log('  volverAlInicio() - Ir al menú inicial (sin borrar progreso)');
console.log('═══════════════════════════════════════════════════');


// Progress Overlay Manager
class ProgressOverlayManager {
  constructor() {
    this.overlay = document.getElementById('progress-overlay');
    this.indicators = {
      recorrido: this.overlay?.querySelector('[data-bar="recorrido"]'),
      subacuatico: this.overlay?.querySelector('[data-bar="subacuatico"]'),
      isla: this.overlay?.querySelector('[data-bar="isla"]')
    };
    this.masks = {
      recorrido: this.overlay?.querySelector('[data-mask="recorrido"]'),
      subacuatico: this.overlay?.querySelector('[data-mask="subacuatico"]'),
      isla: this.overlay?.querySelector('[data-mask="isla"]')
    };
    
    // Progress bar positions as percentages (based on 544px width canvas)
    this.minX = 41.36;  // 225px / 544px = 41.36% (0% position - left edge of indicator)
    this.maxX = 89.71;  // 488px / 544px = 89.71% (100% position - right edge of indicator)
    this.indicatorWidth = 12.132;  // 66px / 544px = 12.132% (width of indicator)
    
    // Load and display initial progress
    this.updateAllProgress();
  }
  
  /**
   * Update a single progress bar
   * @param {string} barName - 'recorrido', 'subacuatico', or 'isla'
   * @param {number} percentage - Value between 0 and 100
   */
  updateProgress(barName, percentage) {
    const indicator = this.indicators[barName];
    const mask = this.masks[barName];
    if (!indicator) return;
    
    // Clamp percentage between 0 and 100
    const clampedPct = Math.max(0, Math.min(100, percentage));
    
    // Calculate X position as percentage - interpolate between min and max, then subtract indicator width
    const xPos = this.minX + (this.maxX - this.minX) * (clampedPct / 100) - this.indicatorWidth * (clampedPct / 100);
    
    // Update position and text
    indicator.style.left = `${xPos}%`;
    const percentageSpan = indicator.querySelector('.progress-percentage');
    if (percentageSpan) {
      percentageSpan.textContent = `${Math.round(clampedPct)} %`;
    }
    
    // Update mask to reveal progress_full.png up to the left edge of indicator
    if (mask) {
      // Add 2% offset to account for border-radius of indicator (8px ≈ 1.5% of 544px)
      const borderRadiusOffset = 2;
      const rightInset = 100 - xPos - borderRadiusOffset; // How much to hide from the right
      
      // Vertical bounds for each bar (top, bottom calculated from indicator center ± half height)
      // Indicator height is 17.672%, so half = 8.836%
      const verticalBounds = {
        recorrido: { top: 19.184, bottom: 63.144 },      // center 28.02% ± 8.836%
        subacuatico: { top: 42.024, bottom: 40.304 },    // center 50.86% ± 8.836%
        isla: { top: 64.444, bottom: 17.884 }            // center 73.28% ± 8.836%
      };
      
      const bounds = verticalBounds[barName];
      if (bounds) {
        mask.style.clipPath = `inset(${bounds.top}% ${rightInset}% ${bounds.bottom}% 0)`;
      }
    }
  }
  
  /**
   * Update all progress bars from localStorage
   */
  updateAllProgress() {
    // Get progress from localStorage/State
    const recorridoProgress = this.getRecorridoProgress();
    const subacuaticoProgress = this.getSubacuaticoProgress();
    const islaProgress = this.getIslaProgress();
    
    this.updateProgress('recorrido', recorridoProgress);
    this.updateProgress('subacuatico', subacuaticoProgress);
    this.updateProgress('isla', islaProgress);
  }
  
  /**
   * Calculate recorrido progress (based on species discovered)
   */
  getRecorridoProgress() {
    try {
      const speciesData = localStorage.getItem('deltaPlus.speciesProgress.v1');
      if (!speciesData) return 0;
      
      const progress = JSON.parse(speciesData);
      const totalSpecies = 30; // Fixed: 6 species per round × 5 rounds
      
      // foundSpeciesIds is an array
      const discoveredCount = progress.foundSpeciesIds ? progress.foundSpeciesIds.length : 0;
      return (discoveredCount / totalSpecies) * 100;
    } catch (e) {
      console.warn('Error calculating recorrido progress:', e);
      return 0;
    }
  }
  
  /**
   * Calculate subacuático progress (based on completed stages)
   */
  getSubacuaticoProgress() {
    try {
      const rioState = localStorage.getItem('deltaPlus.rio.state');
      if (!rioState) return 0;
      
      const state = JSON.parse(rioState);
      const completedStages = state.completedStages || [];
      const totalStages = 8; // Actual number of species in RioScene
      
      return (completedStages.length / totalStages) * 100;
    } catch (e) {
      console.warn('Error calculating subacuático progress:', e);
      return 0;
    }
  }
  
  /**
   * Calculate isla progress (based on completed mini-games)
   */
  getIslaProgress() {
    try {
      const simuladorState = localStorage.getItem('deltaPlus.simulador.state');
      if (!simuladorState) return 0;
      
      const state = JSON.parse(simuladorState);
      const completedGames = state.completedGames || [];
      const totalGames = 3; // Adjust based on actual number of games
      
      return (completedGames.length / totalGames) * 100;
    } catch (e) {
      console.warn('Error calculating isla progress:', e);
      return 0;
    }
  }
  
  /**
   * Show or hide the progress overlay
   * @param {boolean} visible - Whether to show or hide
   * @param {boolean} immediate - If true, skip transitions and hide immediately
   */
  setVisible(visible, immediate = false) {
    if (this.overlay) {
      this.overlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
      
      if (immediate) {
        // Force immediate display change without transitions
        this.overlay.style.transition = 'none';
        this.overlay.style.display = 'none';
        this.overlay.style.opacity = '0';
        // Force reflow
        void this.overlay.offsetHeight;
      } else {
        this.overlay.style.display = visible ? 'block' : 'none';
      }
    }
  }
}

// Create global progress manager instance
window.progressManager = new ProgressOverlayManager();
// Hide by default
window.progressManager.setVisible(false);

// Show/hide progress overlay based on scene and update progress
EventBus.on('scene:changed', (sceneName) => {
  // Handle both string and object formats
  const actualSceneName = typeof sceneName === 'string' ? sceneName : sceneName?.name;
  console.log('[ProgressOverlay] Scene changed to:', actualSceneName);
  
  if (window.progressManager) {
    // Menu scene handles its own progress overlay fade-in after loading screen
    // For other scenes, hide immediately (especially transitions)
    const shouldShow = false; // MenuScene will handle showing manually
    console.log('[ProgressOverlay] Should show:', shouldShow);
    
    // Force immediate hide for all non-menu scenes
    if (actualSceneName !== 'menu') {
      window.progressManager.setVisible(false, true); // Force immediate hide
    }
  }
});

// Also expose manual update function
window.updateProgressOverlay = () => {
  if (window.progressManager) {
    window.progressManager.updateAllProgress();
  }
};
