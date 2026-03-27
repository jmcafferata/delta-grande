import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import { AssetLoader } from '../core/AssetLoader.js';
import { State } from '../core/State.js';
import { UI } from '../core/UI.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { SpeciesManager } from '../core/SpeciesManager.js';
import { CursorRadarModule } from './CursorRadarModule.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GamerLUTPass } from '../core/GamerLUTPass.js';
import { getVideoSource, browserInfo } from '../core/VideoSupport.js';

// 👇 Control the starting scene here (0=escena01, 1=escena02, 2=escena03, etc.)
// Ronda 1, Ambiente 1 = escena 0
const STARTING_SCENE = 0;
const TOTAL_ROUNDS = 5;

const _orbitCenter = new THREE.Vector3();
const _orbitPos = new THREE.Vector3();
const _orbitLook = new THREE.Vector3();
const _orbitHelper = new THREE.Vector3();
const _orbitAhead = new THREE.Vector3();
const _orbitVel = new THREE.Vector3();

const EFEDRA_OVERLAY_THEME = {
  fontKitHref: 'https://use.typekit.net/vmy8ypx.css',
  fonts: {
    family: `"new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`,
    speciesMaxPx: 20,
    numbersMaxPx: 22
  },
  colors: {
    speciesText: '#FFC96A',
    numbersTotalFill: '#FFC96A',
    numbersFoundStroke: '#FFC96A',
    silhouetteDefault: '#2B6CB0',
    silhouetteSelected: '#FFD400'
  }
};

const EFEDRA_FONT_LINK_ID = 'efedra-font-kit';
const EFEDRA_STYLE_ID = 'efedra-text-overlay-style';

function ensureEfedraOverlayAssets() {
  // Assets (font + CSS) are now provided statically in `index.html`.
  // This helper ensures the overlay element exists and returns it.
  const overlayId = 'efedra-text-overlay';
  let el = document.getElementById(overlayId);
  if (!el) {
    el = document.createElement('div');
    el.id = overlayId;
    el.style.display = 'none';
    // Do NOT append here. Caller (addTextOverlay) will append to the correct parent
    // to avoid a brief flash at document.body's origin (top-left).
  }
  return el;
}


export class RecorridoScene extends BaseScene {
  constructor(app) {
    super(app); this.name = 'recorrido';
    this.current = STARTING_SCENE; this.stages = [];
    this.mouseNDC = new THREE.Vector2(0, 0);
    this.velLon = 0; this.velLat = 0; this.isAutoLook = false;
    this.cameraLocked = true; // 👈 Restringe la cámara al eje horizontal hasta descubrir especie
    this.use3DInventory = false; // 👈 switch inicial
    this.inventoryModel = null;
    this.inventoryOverlay = null;
    this.mapOverlayEl = null;
    this._mapOverlayClickHandler = null;
    this._mapOverlayPrevPointerEvents = '';
    this._mapOverlayPrevCursor = '';
    this.overlayRoot = app?.root || document.body;
    this.stageLoadingOverlay = null;
    this._stageLoadingHideTimeout = null;

    this.metadataOverlayAudio = null;

    // 👇 Initialize CursorRadarModule
    this.cursorRadar = new CursorRadarModule({
      cursor: {
        src: '/game-assets/recorrido/interfaz/cursor.png',
        scale: 0.15
      },
      radar: {
        enabled: true,
        scale: 0.22
      }
    });
    this.metadataCloseAudio = null;
    this.transitionAudio = null;
    this.sceneStartAudio = null;

    // 🎨 Post-processing
    this.composer = null;
    this.gamerLUTPass = null;
    this.useGamerLUT = true; // Toggle para activar/desactivar
    this.isLUTReady = false;
    this.lutLoadingOverlay = null;
    this.fadeOverlay = null;
    this._lutReadyRaf = null;
    this._lutOverlayTimeout = null;
    this._fadeOverlayTimeout = null;
    this._tempClearColor = new THREE.Color(); this.lon = 0; this.lat = 0; // grados

    this.stageModel = null;
    this.gltfAnimations = [];

    // 👇 NEW: Species management system
    this.speciesManager = new SpeciesManager();
    this.currentSpecies = null;

    this.raycaster = new THREE.Raycaster();
    this.glitchObject = null;
    this.rastroObject = null;
    this.flechaObject = null;
    this.flechaAnimationMixer = null;
    this.flechaAnimationAction = null;
    this.flechaMasterMixer = null;
    this.flechaClicked = false; // 👈 Previene clicks dobles
    this.speciesClickDisabled = false; // 👈 Desactiva clicks en especies por 3s después de descubrir

    // 🐟 Carpa mesh and animation
    this.carpaObject = null;
    this.carpaAnimationMixer = null;
    this.carpaAnimationAction = null;

    // 🐟 Carpa3D hover and rotation animation
    this.carpa3dObject = null;
    this.carpa3dHover = {
      enabled: false,
      time: 0,
      amplitude: 0.08,      // Altura del movimiento (muy sutil)
      frequency: 1.2,       // Velocidad del hover
      baseY: 0              // Posición Y inicial
    };
    this.carpa3dRotation = {
      enabled: false,
      noiseOffsetX: Math.random() * 1000,
      noiseOffsetY: Math.random() * 1000,
      noiseOffsetZ: Math.random() * 1000,
      amplitude: 0.02,      // Amplitud de rotación (muy sutil, ~1 grado)
      speed: 0.5            // Velocidad del noise
    };

    // 🎬 Animation mixer for stage model (handles all glitch/rastro animations)
    this.stageAnimationMixer = null;
    this.glitchAnimationAction = null;
    this.rastroAnimationAction = null;
    this.videoElement = null;
    this.currentVideoTexture = null; // For cleanup
    this._glitchCanvas = null;       // Canvas bridge for HEVC alpha in Safari WebGL
    this._glitchCanvasCtx = null;
    this.envTexture = null; // For cleanup
    this.currentStageModelUrl = null; // Track current model URL
    this.sunObject = null;
    this.lensflare = null;
    this.sunLight = null;
    this.lensflareTextures = [];

    // 🔥 Memory tracking
    this.loadedTextures = new Set(); // Track all textures we create
    this.sceneLoadCount = 0; // Track how many scenes we've loaded
    this._flareDebug = { created: false, frameLogged: false };
    this.butterfly = null;
    this.butterflyMixer = null;
    this.butterflyAction = null;
    this.butterflyOrbit = {
      angle: 15,
      radius: 2.55,
      height: 0.35,
      verticalAmp: 0.08,
      speed: 0.9,
      lookAhead: 0.35,
      wave: {
        amplitude: 0.52,
        frequency: 4.1,
        phase: 0
      }
    };

    this.glitchFlashState = null;
    // Usa un flash liviano por defecto para evitar repaints costosos
    this.glitchFlashLeanMode = true;
    this.prefersReducedMotion = (typeof window !== 'undefined' && window.matchMedia)?.('(prefers-reduced-motion: reduce)').matches || false;

    // 🔊 Spatial audio system for species
    this.speciesAudio = null; // Audio element for current species
    this.audioContext = null; // Web Audio API context
    this.audioSource = null; // Audio source node
    this.stereoPanner = null; // Stereo panner for left/right positioning
    this.gainNode = null; // Gain node for volume control
    this.spatialAudioConfig = {
      maxDistance: 100, // Maximum distance for audio falloff
      minVolume: 0.1,   // Minimum volume when far
      maxVolume: 2.0,   // Maximum volume when close
      fovAngle: 60      // Field of view angle in degrees (±60° = 120° total FOV)
    };

    this.config = {
      deadzone: 0.12,
      maxSpeed: { yaw: 80, pitch: 50 },
      damping: 0.12
    };

    // Zoom controls
    this.zoom = {
      currentFOV: 75,
      minFOV: 35,        // Maximum zoom in
      maxFOV: 85,        // Maximum zoom out  
      baseFOV: 75,       // Default FOV
      zoomSpeed: 1.2,    // Very slow zoom sensitivity
      lerpSpeed: 3.5,    // Smooth interpolation speed
      dampening: 0.75    // Strong dampening for very smooth zooming
    };

    // 🎯 Camera debug overlay
    this.cameraDebugOverlay = null;
    this.shaderMaterials = new Set();

    // 🔊 Voiceover non-overlap
    this._speciesVoiceoverTimer = null;
    this._currentSpeciesVOTimer = null;
    this._transitionVoiceoverTimer = null;
    this.transitionVoiceover = null;

    // 🧼 Completion overlay lifecycle
    this.completionOverlayEl = null;
    this._completionOverlayAudioHintTimeout = null;
  }

  hideCompletionOverlay({ immediate = false } = {}) {
    const overlay = this.completionOverlayEl || document.getElementById('completion-overlay');
    if (!overlay) {
      this.completionOverlayEl = null;
      return;
    }

    if (this._completionOverlayAudioHintTimeout) {
      clearTimeout(this._completionOverlayAudioHintTimeout);
      this._completionOverlayAudioHintTimeout = null;
    }

    const removeNow = () => {
      try { overlay.remove(); } catch { }
      if (this.completionOverlayEl === overlay) this.completionOverlayEl = null;
    };

    if (immediate) {
      removeNow();
      return;
    }

    try { overlay.style.opacity = '0'; } catch { }
    setTimeout(removeNow, 500);
  }

  _stopVoiceAudio(audio) {
    if (!audio) return;
    try { audio.pause(); } catch (e) { /* ignore */ }
    try { audio.currentTime = 0; } catch (e) { /* ignore */ }
  }

  stopRecorridoVoiceovers(except = null) {
    if (this._speciesVoiceoverTimer) {
      clearTimeout(this._speciesVoiceoverTimer);
      this._speciesVoiceoverTimer = null;
    }
    if (this._currentSpeciesVOTimer) {
      clearTimeout(this._currentSpeciesVOTimer);
      this._currentSpeciesVOTimer = null;
    }
    if (this._transitionVoiceoverTimer) {
      clearTimeout(this._transitionVoiceoverTimer);
      this._transitionVoiceoverTimer = null;
    }

    if (this.speciesVoiceover && this.speciesVoiceover !== except) {
      this._stopVoiceAudio(this.speciesVoiceover);
      this.speciesVoiceover = null;
    }
    if (this.currentSpeciesVO && this.currentSpeciesVO !== except) {
      this._stopVoiceAudio(this.currentSpeciesVO);
      this.currentSpeciesVO = null;
    }
    if (this.transitionVoiceover && this.transitionVoiceover !== except) {
      this._stopVoiceAudio(this.transitionVoiceover);
      this.transitionVoiceover = null;
    }
  }

  // --- ADD: campos nuevos en la clase
  overlayScene = new THREE.Scene();
  overlayCam = null;
  screenSize = new THREE.Vector2();

  // Touch-drag joystick for camera control
  touchActive = false;
  touchStart = new THREE.Vector2();
  touchCurrent = new THREE.Vector2();
  touchMaxDistance = 200; // pixels for full input
  touchSensitivity = 1.0;
  touchTapThreshold = 12; // pixels: tap if drag < threshold


  showIncompatibleBrowserOverlay() {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.95)';
    overlay.style.zIndex = '100000';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.color = '#ffffff';
    overlay.style.fontFamily = 'monospace';
    overlay.style.textAlign = 'center';
    overlay.style.padding = '20px';

    const title = document.createElement('h2');
    title.innerText = 'Tu navegador no es compatible';
    title.style.marginBottom = '20px';
    title.style.fontSize = '2rem';

    const message = document.createElement('p');
    message.innerText = 'Esta experiencia requiere soporte de video WebM con transparencia.';
    message.style.marginBottom = '10px';
    message.style.fontSize = '1.2rem';

    const recommendation = document.createElement('p');
    recommendation.innerText = 'Recomendamos usar Chrome, Firefox o Edge en escritorio o Android.';
    recommendation.style.marginBottom = '30px';
    recommendation.style.fontSize = '1rem';
    recommendation.style.color = '#ccc';

    const backButton = document.createElement('button');
    backButton.innerText = 'Volver al Menú';
    backButton.style.padding = '12px 24px';
    backButton.style.fontSize = '1.2rem';
    backButton.style.cursor = 'pointer';
    backButton.style.backgroundColor = '#FFFFFF';
    backButton.style.color = '#000000';
    backButton.style.border = 'none';
    backButton.style.borderRadius = '4px';
    
    backButton.addEventListener('mouseenter', () => {
      backButton.style.backgroundColor = '#DDDDDD';
    });
    backButton.addEventListener('mouseleave', () => {
      backButton.style.backgroundColor = '#FFFFFF';
    });

    backButton.addEventListener('click', () => {
      overlay.remove();
      window.location.hash = 'menu';
    });

    overlay.appendChild(title);
    overlay.appendChild(message);
    overlay.appendChild(recommendation);
    overlay.appendChild(backButton);
    document.body.appendChild(overlay);
  }

  async mount() {
    const { isSafari, isIOS, supportsWebMAlpha } = browserInfo;

    // 👇 Limpiar cualquier overlay del menú que haya quedado abierto
    const menuOverlays = document.querySelectorAll('body > div');
    menuOverlays.forEach(overlay => {
      const zIndex = window.getComputedStyle(overlay).zIndex;
      if (zIndex === '10000') {

        overlay.remove();
      }
    });

    // 👇 Ocultar el videoOverlay al inicio para evitar que bloquee clicks/cámara
    UI.hideVideo();


    // 👇 Hide system cursor immediately
    document.documentElement.style.cursor = 'none';
    document.body.style.cursor = 'none';

    // 👇 Mostrar elementos específicos de RecorridoScene (inventory panel y zócalo)
    const inventoryPanel = document.getElementById('inventoryPanel');
    const zocaloVideo = document.getElementById('zocaloVideo');
    if (inventoryPanel) inventoryPanel.style.display = 'block';
    if (zocaloVideo) zocaloVideo.style.display = 'block';

    // Mostrar overlays de recorrido (mapa y metadata)
    const mapOverlay = document.querySelector('.map-overlay');
    const metadataOverlay = document.querySelector('.metadata-overlay');
    if (mapOverlay) {
      mapOverlay.style.display = 'block';
      this.setupMapOverlayShortcut(mapOverlay);
    }
    if (metadataOverlay) metadataOverlay.style.display = 'block';

    this.isLUTReady = false;
    this.showLUTLoadingOverlay();

    // 🎬 Fade desde negro al inicio
    this.showFadeOverlay();

    // Cámara
    this.camera.fov = 75; this.camera.updateProjectionMatrix();
    this.camera.position.set(0, 0, 0.1);

    // Input
    this._onMouseMove = (e) => this.onMouseMove(e);
    this._onLeave = () => this.mouseNDC.set(0, 0);
    this._onClick = (e) => this.onClick(e);
    this._onKeyDown = (e) => this.onKeyDown(e);
    this._onKeyUp = (e) => this.onKeyUp(e);
    this._onWheel = (e) => this.onWheel(e);
    this.app.canvas.addEventListener('mousemove', this._onMouseMove);
    this.app.canvas.addEventListener('mouseleave', this._onLeave);
    this.app.canvas.addEventListener('click', this._onClick);
    this.app.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    this.setupOverlay();

    // 👇 Initialize CursorRadarModule
    await this.cursorRadar.init();

    // 👇 Load species data
    await this.speciesManager.load();


    // 🎮 DEBUGGING: Exponer funciones globales para cambiar ronda/ambiente desde la consola
    window.setRonda = (round, stage) => {
      if (this.speciesManager.setRoundAndStage(round, stage)) {
        // Las 6 escenas se reciclan para todas las rondas, así que usamos módulo 6
        const sceneIndex = (stage - 1) % 6;

        this.loadStage(sceneIndex);
      }
    };

    window.verRonda = () => {
      const progress = this.speciesManager.getProgress();
    };


    // Cargar config JSON
    const conf = await fetch('./data/recorrido.json', { cache: 'no-store' }).then(r => r.json());
    this.stages = conf.stages || [];

    this.initInventoryCanvas();

    // 👇 Calcular el índice de escena correcto basado en el progreso del SpeciesManager
    // Las 6 escenas se reciclan para todas las rondas, así que usamos módulo 6
    const progress = this.speciesManager.getProgress();
    // Calculate scene index: stage 1-6 within any round maps to scene 0-5
    const sceneIndex = (progress.stage - 1) % 6;


    // Load the stage - loadStage will recalculate round/stage from sceneIndex
    // But we need to ensure SpeciesManager is already at the correct round/stage
    await this.loadStage(sceneIndex);

    // 🔊 Reproducir sonido de inicio de escenario (escena inicial)
    this.sceneStartAudio = new Audio('/game-assets/recorrido/sonido/Transicion inicio de escenarios.mp3');
    this.sceneStartAudio.volume = 0.2;
    this.sceneStartAudio.play().catch(e => console.error("Scene start audio play failed:", e));

    // 🎬 Reproducir zócalo de la escena inicial
    this.playZocalo();

    // Cámara
    this.camera.fov = 75;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, 0, 0.1);

    // 👇 MUY IMPORTANTE: meter la cámara en la escena
    this.scene.add(this.camera);


    // directional light
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(0, 10, 90);
    this.scene.add(dirLight);

    // ambient light
    const ambLight = new THREE.AmbientLight(0xffffff, 1);
    this.scene.add(ambLight);


    this.setupNoiseOverlay();

    // 🎵 Background music - plays continuously at 30% volume
    this.backgroundMusic = AssetLoader.audio('/game-assets/recorrido/musica.mp3');
    this.backgroundMusic.loop = true;
    this.backgroundMusic.volume = 0.08;
    this.backgroundMusic.play().catch(err => {
      console.warn('[RecorridoScene] Background music autoplay prevented. Will play on first user interaction.', err);
      // Retry on first user click/tap
      const startMusic = () => {
        this.backgroundMusic.play().catch(() => { });
        document.removeEventListener('click', startMusic);
        document.removeEventListener('touchstart', startMusic);
      };
      document.addEventListener('click', startMusic, { once: true });
      document.addEventListener('touchstart', startMusic, { once: true });
    });

    // 🎨 Setup post-processing
    this.setupPostProcessing();
    // Register touch joystick handlers
    this.setupInputHandlers();
  }

  setupPostProcessing() {
    if (!this.app?.renderer) {
      console.warn('[RecorridoScene] Cannot setup post-processing: renderer not available');
      this.isLUTReady = true;
      this.hideLUTLoadingOverlay({ immediate: true });
      return;
    }



    this.isLUTReady = false;
    if (this._lutReadyRaf) {
      cancelAnimationFrame(this._lutReadyRaf);
      this._lutReadyRaf = null;
    }

    // Crear composer
    this.composer = new EffectComposer(this.app.renderer);


    // Pass principal de renderizado
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);


    // GamerLUTPass con valores sutiles para el Delta (al final para que pueda renderizar a pantalla)
    this.gamerLUTPass = new GamerLUTPass({
      intensity: 0.0,        // Intensidad muy reducida
      saturation: 0,       // Saturación mínima
      contrast: 1.02,         // Contraste muy sutil
      brightness: 1.01,       // Brillo casi neutro
      vignetteStrength: 0.1   // Viñeta muy suave
    });
    this.gamerLUTPass.enabled = false; // Deshabilitado por defecto (se activa con tecla L)
    this.gamerLUTPass.renderToScreen = true;
    //this.composer.addPass(this.gamerLUTPass);




    // 🔍 Debug function para verificar estado del post-processing
    window.debugPostProcessing = () => {






      if (this.discoveryFilterPass) {



      }
      if (this.gamerLUTPass) {


      }


    };

    // Exponer funciones globales para debugging y control del LUT
    window.toggleGamerLUT = () => {
      this.useGamerLUT = !this.useGamerLUT;

    };

    window.setLUTIntensity = (value) => {
      if (this.gamerLUTPass) {
        this.gamerLUTPass.setIntensity(value);

      }
    };

    window.lutPresetCyberpunk = () => {
      if (this.gamerLUTPass) {
        this.gamerLUTPass.presetCyberpunk();

      }
    };

    window.lutPresetCompetitive = () => {
      if (this.gamerLUTPass) {
        this.gamerLUTPass.presetCompetitive();

      }
    };

    window.lutPresetCinematic = () => {
      if (this.gamerLUTPass) {
        this.gamerLUTPass.presetCinematic();

      }
    };

    window.lutReset = () => {
      if (this.gamerLUTPass) {
        this.gamerLUTPass.reset();

      }
    };

    this.queueLUTReady();
  }



  initInventoryCanvas() {
    // Switch to DOM-based inventory image (div+img in index.html)
    this.inventoryEl = document.getElementById('inventoryPanel');
    this.inventoryImgEl = document.getElementById('inventoryImage');

    if (!this.inventoryEl || !this.inventoryImgEl) {
      // Fallback to the canvas-based approach if DOM elements are missing
      this.inventoryCanvas = document.getElementById("inventoryCanvas");
      if (!this.inventoryCanvas) return;
      this.inventoryCtx = this.inventoryCanvas.getContext("2d");
      this.resizeInventoryCanvas();
      window.addEventListener("resize", () => this.resizeInventoryCanvas());

      // Se crea el objeto imagen, pero su 'src' se asignará dinámicamente
      this.inventoryImg = new Image();
      // Cuando la imagen cargue, redibujar manteniendo su aspect ratio
      this.inventoryImg.onload = () => this.drawInventoryPanel();
      return;
    }

    // Ensure the image is not blocking pointer events and is initially visible
    this.inventoryEl.style.pointerEvents = 'none';
    this.inventoryImgEl.style.pointerEvents = 'none';
  }

  setInventoryImage() {
    // If using DOM image, update its src and ensure visibility
    const panelPath = this.speciesManager.getPanelPath();


    if (this.inventoryImgEl) {
      this.inventoryImgEl.src = panelPath || this.inventoryImgEl.src;
      this.inventoryEl.style.display = panelPath ? 'block' : 'none';
      // ensure it re-evaluates layout
      this.inventoryImgEl.decode?.().catch(() => {});
      return;
    }

    // Fallback to canvas flow
    if (!this.inventoryImg) return;
    this.inventoryImg.src = panelPath;
  }


  resizeInventoryCanvas() {
    if (!this.inventoryCanvas) return;
    const w = this.app?.BASE_WIDTH ?? window.innerWidth;
    const h = this.app?.BASE_HEIGHT ?? window.innerHeight;
    this.inventoryCanvas.width = w;
    this.inventoryCanvas.height = h;
    // If using a canvas fallback, redraw after resize
    if (this.inventoryImg && this.inventoryImg.naturalWidth) {
      this.drawInventoryPanel();
    }
  }

  showOverlayVideo(src) {
    const overlay = document.getElementById("videoOverlay");
    const video = document.getElementById("speciesDataVideo");

    video.src = src;
    overlay.style.display = "block";
    video.currentTime = 0;
    video.play();

    // ocultar cuando termine
    video.onended = () => {
      overlay.style.display = "none";
      video.pause();
      video.src = "";
    };
  }




  async loadInventoryCanvas() {
    // crear canvas y agregarlo al DOM si no existe
    const parent = this.overlayRoot || document.body;
    let canvas = parent.querySelector ? parent.querySelector('#inventoryCanvas') : document.getElementById("inventoryCanvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "inventoryCanvas";
      const w = this.app?.BASE_WIDTH ?? window.innerWidth;
      const h = this.app?.BASE_HEIGHT ?? window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      canvas.style.position = "absolute";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.pointerEvents = "none"; // no bloquea clicks en la escena 3D
      parent.appendChild(canvas);
    }
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.pointerEvents = "none";

    this.inventoryCanvas = canvas;
    this.inventoryCtx = canvas.getContext("2d");
    this.resizeInventoryCanvas();

    // dibujar contenido inicial usando this.inventoryImg (mantiene aspect ratio)
    this.inventoryImg = this.inventoryImg || new Image();
    this.inventoryImg.onload = () => this.drawInventoryPanel();
    this.inventoryImg.src = this.inventoryImg.src || "/game-assets/recorrido/paneles/paneles_entero.png";
  }

  drawInventoryPanel() {
    if (!this.inventoryCanvas || !this.inventoryCtx || !this.inventoryImg || !this.inventoryImg.naturalWidth) return;

    const canvas = this.inventoryCanvas;
    const ctx = this.inventoryCtx;

    // Clear previous drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Compute aspect-fit dimensions within reasonable screen fraction
    const maxW = canvas.width * 0.6; // occupy up to 60% width
    const maxH = canvas.height * 0.25; // occupy up to 25% height

    const imgW = this.inventoryImg.naturalWidth;
    const imgH = this.inventoryImg.naturalHeight;
    const imgAspect = imgW / imgH;

    let drawW = maxW;
    let drawH = drawW / imgAspect;
    if (drawH > maxH) {
      drawH = maxH;
      drawW = drawH * imgAspect;
    }

    const x = (canvas.width - drawW) / 2;
    const y = canvas.height - drawH - 40; // 40px margin from bottom

    try {
      ctx.drawImage(this.inventoryImg, x, y, drawW, drawH);
    } catch (e) {
      console.warn('[RecorridoScene] drawInventoryPanel failed:', e);
    }
  }

  // limpiar/remover
  removeInventoryCanvas() {
    if (this.inventoryCanvas) {
      this.inventoryCanvas.remove();
      this.inventoryCanvas = null;
      this.inventoryCtx = null;
    }
  }

  applyHuePingPongShader(mat) {
    mat.onBeforeCompile = (shader) => {
      // Guardamos la referencia para poder actualizar el tiempo después
      mat.userData.shader = shader;
      this.shaderMaterials?.add(mat);

      // Agregamos el uniform para el tiempo
      shader.uniforms.uTime = { value: 0.0 };

      // Inyectamos la función de conversión de color y el uniform al fragment shader
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `
        uniform float uTime;

        vec3 hsv2rgb(vec3 c) {
          vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }

        void main() {
        `
      );

      // Inyectamos la lógica del ping-pong justo después de que se calcule el color emisivo del video
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `
        #include <emissivemap_fragment>

        // --- LÓGICA DEL PING-PONG ---
        // 1. Onda sinusoidal para la oscilación suave (controla la velocidad con el multiplicador)
        float sineWave = sin(uTime * 30.8);

        // 2. Mapeamos de [-1, 1] a [0, 1]
        float pingPongT = (sineWave + 1.0) * 0.5;

        // 3. Calculamos el HUE actual. Puedes cambiar 0.0 y 0.33 para otros rangos de color.
        float currentHue = mix(0.2, 0.30, pingPongT);
        
        // 4. Convertimos a RGB
        vec3 pingPongColor = hsv2rgb(vec3(currentHue, 1.0, 1.0));

        // 5. Mezclamos el color original del video (totalEmissiveRadiance) con nuestro color animado.
        //    El último valor (0.7) controla la intensidad de la mezcla. 1.0 sería reemplazarlo por completo.
        totalEmissiveRadiance = mix(totalEmissiveRadiance, pingPongColor, 0.7);
        `
      );
    };
    mat.needsUpdate = true;
  }


  // toggle
  toggleInventory(useCanvas) {
    if (useCanvas) {
      this.loadInventoryCanvas();
      return;
    }

    // Default: use DOM-based inventory panel if available
    if (this.inventoryEl) {
      this.inventoryEl.style.display = 'block';
      // ensure image has latest src
      this.setInventoryImage();
    } else {
      // Fallback to canvas
      this.loadInventoryCanvas();
    }
  }

  // --- ADD: helpers
  setupOverlay() {
    // cámara ortográfica en píxeles de pantalla
    this.app.renderer.getSize(this.screenSize);
    const w = this.screenSize.x, h = this.screenSize.y;
    this.overlayCam = new THREE.OrthographicCamera(0, w, h, 0, -10, 10);
    this.overlayCam.position.z = 5;

    window.addEventListener('resize', () => this.onResizeOverlay());

    // 🎯 Create camera debug overlay
    //this.setupCameraDebugOverlay();
  }

  // Allow the HUD map to act as the ESC/pause shortcut while this scene is active
  setupMapOverlayShortcut(mapOverlay) {
    if (!mapOverlay) return;
    // Avoid reattaching if we're already wired up
    if (this.mapOverlayEl === mapOverlay && this._mapOverlayClickHandler) return;

    this.mapOverlayEl = mapOverlay;
    this._mapOverlayPrevPointerEvents = mapOverlay.style.pointerEvents;
    this._mapOverlayPrevCursor = mapOverlay.style.cursor;

    mapOverlay.style.pointerEvents = 'auto';
    mapOverlay.style.cursor = 'pointer';

    this._mapOverlayClickHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (typeof window.showPauseMenu === 'function') {
        window.showPauseMenu();
        return;
      }

      // Fallback: emulate Escape key press if global helper is unavailable
      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true
      });
      window.dispatchEvent(escapeEvent);
    };

    mapOverlay.addEventListener('pointerup', this._mapOverlayClickHandler);
  }

  teardownMapOverlayShortcut() {
    if (!this.mapOverlayEl) return;

    if (this._mapOverlayClickHandler) {
      this.mapOverlayEl.removeEventListener('pointerup', this._mapOverlayClickHandler);
    }

    this.mapOverlayEl.style.pointerEvents = this._mapOverlayPrevPointerEvents || '';
    this.mapOverlayEl.style.cursor = this._mapOverlayPrevCursor || '';

    this.mapOverlayEl = null;
    this._mapOverlayClickHandler = null;
    this._mapOverlayPrevPointerEvents = '';
    this._mapOverlayPrevCursor = '';
  }

  // --- Input handlers (touch joystick)
  setupInputHandlers() {
    // Bind handlers so we can add/remove listeners reliably
    this._onTouchStart = (e) => this.onTouchStart(e);
    this._onTouchMove = (e) => this.onTouchMove(e);
    this._onTouchEnd = (e) => this.onTouchEnd(e);

    const canvas = this.app?.canvas;
    if (!canvas) return;

    // We use passive: false so we can preventDefault and avoid page scroll
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', this._onTouchEnd, { passive: false });
  }

  onTouchStart(e) {
    if (!e.touches || e.touches.length === 0) return;
    e.preventDefault();
    const t = e.touches[0];
    this.touchActive = true;
    this.touchStart.set(t.clientX, t.clientY);
    this.touchCurrent.set(t.clientX, t.clientY);
  }

  onTouchMove(e) {
    if (!this.touchActive) return;
    if (!e.touches || e.touches.length === 0) return;
    e.preventDefault();
    const t = e.touches[0];
    this.touchCurrent.set(t.clientX, t.clientY);
  }

  onTouchEnd(e) {
    // End touch control; let velocities decay naturally
    if (!this.touchActive) return;
    // Determine if this was a tap (short move) and synthesize a click
    const dx = this.touchCurrent.x - this.touchStart.x;
    const dy = this.touchCurrent.y - this.touchStart.y;
    const distSq = dx * dx + dy * dy;
    const thr = (this.touchTapThreshold || 12);
    if (distSq <= thr * thr) {
      // Treat as tap -> call onClick with a minimal event-like object
      try {
        this.onClick({ clientX: this.touchCurrent.x, clientY: this.touchCurrent.y });
      } catch (err) {
        // swallow errors to avoid breaking teardown
        console.warn('[RecorridoScene] Synthesized touch click failed:', err);
      }
    }

    this.touchActive = false;
  }

  queueLUTReady() {
    if (this._lutReadyRaf) {
      cancelAnimationFrame(this._lutReadyRaf);
    }
    this._lutReadyRaf = requestAnimationFrame(() => {
      this._lutReadyRaf = null;
      this.isLUTReady = true;
      this.hideLUTLoadingOverlay();
      // 🎬 Iniciar fade desde negro cuando todo esté listo
      this.hideFadeOverlay();
    });
  }

  collectShaderMaterials(root) {
    if (!root) return;
    const toArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);
    root.traverse((child) => {
      const materials = toArray(child.material);
      for (const mat of materials) {
        const shader = mat?.userData?.shader;
        if (shader?.uniforms?.uTime) {
          this.shaderMaterials.add(mat);
        }
      }
    });
  }

  showLUTLoadingOverlay() {
    if (this.lutLoadingOverlay || !this.overlayRoot) return;

    const overlay = document.createElement('div');
    overlay.className = 'lut-loading-overlay';
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      background: #000;
      pointer-events: none;
      opacity: 1;
      transition: opacity 0.45s ease;
      z-index: 9999;
    `;

    this.overlayRoot.appendChild(overlay);
    this.lutLoadingOverlay = overlay;

    if (this._lutOverlayTimeout) {
      clearTimeout(this._lutOverlayTimeout);
      this._lutOverlayTimeout = null;
    }
  }

  showFadeOverlay() {
    if (this.fadeOverlay || !this.overlayRoot) return;

    const overlay = document.createElement('div');
    overlay.className = 'fade-overlay';
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      background: #000;
      pointer-events: none;
      opacity: 1;
      transition: opacity 1.2s ease-out;
      z-index: 10000;
    `;

    this.overlayRoot.appendChild(overlay);
    this.fadeOverlay = overlay;

    // Iniciar fade out después de que todos los recursos estén cargados
    // Se llamará desde queueLUTReady() cuando todo esté listo
  }

  hideFadeOverlay({ immediate = false } = {}) {
    const overlay = this.fadeOverlay;
    if (!overlay) return;

    if (this._fadeOverlayTimeout) {
      clearTimeout(this._fadeOverlayTimeout);
      this._fadeOverlayTimeout = null;
    }

    const cleanup = () => {
      overlay.removeEventListener('transitionend', cleanup);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      if (this.fadeOverlay === overlay) {
        this.fadeOverlay = null;
      }
    };

    if (immediate) {
      cleanup();
      return;
    }

    requestAnimationFrame(() => {
      overlay.style.opacity = '0';
    });

    overlay.addEventListener('transitionend', cleanup, { once: true });
    this._fadeOverlayTimeout = setTimeout(cleanup, 1400);
  }

  hideLUTLoadingOverlay({ immediate = false } = {}) {
    const overlay = this.lutLoadingOverlay;
    if (!overlay) return;

    if (this._lutOverlayTimeout) {
      clearTimeout(this._lutOverlayTimeout);
      this._lutOverlayTimeout = null;
    }

    const cleanup = () => {
      overlay.removeEventListener('transitionend', cleanup);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      if (this.lutLoadingOverlay === overlay) {
        this.lutLoadingOverlay = null;
      }
    };

    if (immediate) {
      cleanup();
      return;
    }

    requestAnimationFrame(() => {
      overlay.style.opacity = '0';
    });

    overlay.addEventListener('transitionend', cleanup, { once: true });
    this._lutOverlayTimeout = setTimeout(cleanup, 700);
  }

  showStageLoadingOverlay(message = 'Cargando escena...') {
    if (this.stageLoadingOverlay || !this.overlayRoot) return;

    // Si la animación de loading box o la transición barrida están activas,
    // no mostramos el fondo negro para que no tape la UI de transición.
    const seqOverlay = document.getElementById('sequenceOverlay');
    const transitionActive = seqOverlay && seqOverlay.style.display !== 'none' && seqOverlay.getAttribute('aria-hidden') !== 'true';
    const bg = transitionActive
      ? 'transparent'
      : 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.06), rgba(0,0,0,0.9))';

    const overlay = document.createElement('div');
    overlay.className = 'stage-loading-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      gap: 12px;
      padding-bottom: max(24px, 6vh);
      background: ${bg};
      color: #fff;
      font-family: "new-science", 'New Science', system-ui, -apple-system, 'Segoe UI', Roboto, Inter, Arial, sans-serif;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      text-shadow: 0 0 12px rgba(0,0,0,0.35);
      pointer-events: none;
      z-index: 10020;
      opacity: 1;
      transition: opacity 0.3s ease;
    `;

    const spinner = document.createElement('div');
    spinner.style.cssText = `
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.25);
      border-top-color: #fff;
      animation: stageLoadingSpin 0.9s linear infinite;
      box-shadow: 0 0 18px rgba(0,0,0,0.35);
      flex-shrink: 0;
    `;

    const textEl = document.createElement('div');
    textEl.textContent = message || 'Cargando...';

    const styleEl = document.createElement('style');
    styleEl.textContent = `@keyframes stageLoadingSpin { to { transform: rotate(360deg); } }`;

    overlay.appendChild(styleEl);
    overlay.appendChild(spinner);
    overlay.appendChild(textEl);

    this.overlayRoot.appendChild(overlay);
    this.stageLoadingOverlay = overlay;

    if (this._stageLoadingHideTimeout) {
      clearTimeout(this._stageLoadingHideTimeout);
      this._stageLoadingHideTimeout = null;
    }
  }

  hideStageLoadingOverlay({ immediate = false } = {}) {
    const overlay = this.stageLoadingOverlay;
    if (!overlay) return;

    if (this._stageLoadingHideTimeout) {
      clearTimeout(this._stageLoadingHideTimeout);
      this._stageLoadingHideTimeout = null;
    }

    const cleanup = () => {
      overlay.removeEventListener('transitionend', cleanup);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      if (this.stageLoadingOverlay === overlay) {
        this.stageLoadingOverlay = null;
      }
    };

    if (immediate) {
      cleanup();
      return;
    }

    requestAnimationFrame(() => {
      overlay.style.opacity = '0';
    });

    overlay.addEventListener('transitionend', cleanup, { once: true });
    this._stageLoadingHideTimeout = setTimeout(cleanup, 600);
  }

  setupCameraDebugOverlay() {
    // Create HTML overlay element
    this.cameraDebugOverlay = document.createElement('div');
    this.cameraDebugOverlay.id = 'camera-debug-overlay';
    this.cameraDebugOverlay.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: #00ff00;
      font-family: monospace;
      font-size: 14px;
      padding: 10px;
      border: 1px solid #00ff00;
      border-radius: 4px;
      z-index: 10000;
      pointer-events: none;
      min-width: 200px;
    `;
    document.body.appendChild(this.cameraDebugOverlay);
  }

  onResizeOverlay() {
    this.app.renderer.getSize(this.screenSize);
    const w = this.screenSize.x, h = this.screenSize.y;
    this.overlayCam.left = 0; this.overlayCam.right = w; this.overlayCam.bottom = h; this.overlayCam.top = 0;
    this.overlayCam.updateProjectionMatrix();
  }

  initHUDVideo() {
    this.hudVideo = document.getElementById("hudVideo");
    this.hudCanvas = document.getElementById("hudCanvas");
    this.hudCtx = this.hudCanvas.getContext("2d");

    const w = this.app?.BASE_WIDTH ?? window.innerWidth;
    const h = this.app?.BASE_HEIGHT ?? window.innerHeight;
    this.hudCanvas.width = w;
    this.hudCanvas.height = h;
  }

  playHUDVideo() {
    if (!this.hudVideo) this.initHUDVideo();
    this.hudVideo.currentTime = 0;
    this.hudVideo.play();

    const draw = () => {
      if (this.hudVideo.paused || this.hudVideo.ended) return;

      this.hudCtx.clearRect(0, 0, this.hudCanvas.width, this.hudCanvas.height);
      this.hudCtx.drawImage(this.hudVideo, 0, 0, this.hudCanvas.width, this.hudCanvas.height);

      // key out blacks
      const frame = this.hudCtx.getImageData(0, 0, this.hudCanvas.width, this.hudCanvas.height);
      const data = frame.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const luma = (r + g + b) / 3; // brillo promedio

        // umbrales
        const low = 2;   // todo más oscuro que esto = 100% transparente
        const high = 80;  // todo más brillante que esto = 100% opaco

        // alpha suavizado (0..255)
        let alpha;
        if (luma <= low) alpha = 0;
        else if (luma >= high) alpha = 255;
        else {
          const t = (luma - low) / (high - low); // 0..1
          alpha = Math.floor(t * 255);
        }

        data[i + 3] = alpha;
      }
      this.hudCtx.putImageData(frame, 0, 0);

      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  stopHUDVideo() {
    if (!this.hudVideo) return;

    this.hudVideo.pause();
    this.hudVideo.currentTime = 0;
    // limpiar canvas
    if (this.hudCtx && this.hudCanvas) {
      this.hudCtx.clearRect(0, 0, this.hudCanvas.width, this.hudCanvas.height);
    }
  }



  async unmount() {

    // 🧼 Ensure completion overlay never leaks across scenes
    this.hideCompletionOverlay({ immediate: true });

    // 🔇 Ensure no voiceovers keep playing across scenes
    this.stopRecorridoVoiceovers();

    // 👇 Ocultar elementos específicos de RecorridoScene (inventory panel y zócalo)
    const inventoryPanel = document.getElementById('inventoryPanel');
    const zocaloVideo = document.getElementById('zocaloVideo');
    if (inventoryPanel) inventoryPanel.style.display = 'none';
    if (zocaloVideo) {
      zocaloVideo.style.display = 'none';
      zocaloVideo.style.opacity = '0';
      zocaloVideo.pause();
      zocaloVideo.src = '';
    }

    // Ocultar video overlay si está visible
    const videoOverlay = document.getElementById('videoOverlay');
    if (videoOverlay) {
      videoOverlay.style.display = 'none';
      // Pausar el video si está reproduciéndose
      const speciesDataVideo = document.getElementById('speciesDataVideo');
      if (speciesDataVideo) {
        speciesDataVideo.pause();
        speciesDataVideo.currentTime = 0;
        
        // Optimización Móvil: Liberar completamente el recurso actual para aliviar RAM
        if (browserInfo.isMobile) {
          try { speciesDataVideo.removeAttribute('src'); } catch(e) {}
          try { speciesDataVideo.load(); } catch(e) {}
        }
      }
    }

    // Ocultar overlays de recorrido (mapa y metadata)
    const mapOverlay = document.querySelector('.map-overlay');
    const metadataOverlay = document.querySelector('.metadata-overlay');
    if (mapOverlay) mapOverlay.style.display = 'none';
    this.teardownMapOverlayShortcut();
    if (metadataOverlay) metadataOverlay.style.display = 'none';

    if (this._lutReadyRaf) {
      cancelAnimationFrame(this._lutReadyRaf);
      this._lutReadyRaf = null;
    }
    if (this._lutOverlayTimeout) {
      clearTimeout(this._lutOverlayTimeout);
      this._lutOverlayTimeout = null;
    }
    if (this._fadeOverlayTimeout) {
      clearTimeout(this._fadeOverlayTimeout);
      this._fadeOverlayTimeout = null;
    }
    this.hideLUTLoadingOverlay({ immediate: true });
    this.hideFadeOverlay({ immediate: true });
    this.hideStageLoadingOverlay({ immediate: true });
    this.isLUTReady = false;

    this.app.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.app.canvas.removeEventListener('mouseleave', this._onLeave);
    this.app.canvas.removeEventListener('click', this._onClick);
    this.app.canvas.removeEventListener('wheel', this._onWheel);
    this.app.canvas.removeEventListener('touchstart', this._onTouchStart);
    this.app.canvas.removeEventListener('touchmove', this._onTouchMove);
    this.app.canvas.removeEventListener('touchend', this._onTouchEnd);
    this.app.canvas.removeEventListener('touchcancel', this._onTouchEnd);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);

    // 👇 Destroy CursorRadarModule
    if (this.cursorRadar) {
      this.cursorRadar.destroy();
    }

    // 🎯 Remove camera debug overlay
    if (this.cameraDebugOverlay) {
      this.cameraDebugOverlay.remove();
      this.cameraDebugOverlay = null;
    }

    // Stop scene-specific audio
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }

    // Stop background music
    if (this.backgroundMusic) {
      this.backgroundMusic.pause();
      this.backgroundMusic.currentTime = 0;
      this.backgroundMusic = null;
    }

    // Stop transition audio
    if (this.transitionAudio) {
      this.transitionAudio.pause();
      this.transitionAudio.currentTime = 0;
      this.transitionAudio = null;
    }

    // Stop scene start audio
    if (this.sceneStartAudio) {
      this.sceneStartAudio.pause();
      this.sceneStartAudio.currentTime = 0;
      this.sceneStartAudio = null;
    }

    // Clean up video texture
    if (this.currentVideoTexture) {
      this.currentVideoTexture.dispose();
      this.currentVideoTexture = null;
    }
    
    // 🔥 Clean up environment texture
    if (this.envTexture) {
      this.envTexture.dispose();
      this.envTexture = null;
    }

    // 👇 OPTIMIZACIÓN: Limpiar caché de shaders flash
    if (this._flashShaderCache) {
      this._flashShaderCache.forEach(shader => {
        try { shader.dispose(); } catch { }
      });
      this._flashShaderCache.clear();
      this._flashShaderCache = null;
    }

    if (this.stageModel) {
      this.stageModel.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose?.();
          
          const disposeMat = (mat) => {
            if (mat.map) { mat.map.dispose(); this.loadedTextures.delete(mat.map); mat.map = null; }
            if (mat.emissiveMap) { mat.emissiveMap.dispose(); this.loadedTextures.delete(mat.emissiveMap); mat.emissiveMap = null; }
            if (mat.normalMap) { mat.normalMap.dispose(); this.loadedTextures.delete(mat.normalMap); mat.normalMap = null; }
            if (mat.roughnessMap) { mat.roughnessMap.dispose(); this.loadedTextures.delete(mat.roughnessMap); mat.roughnessMap = null; }
            if (mat.metalnessMap) { mat.metalnessMap.dispose(); this.loadedTextures.delete(mat.metalnessMap); mat.metalnessMap = null; }
            if (mat.aoMap) { mat.aoMap.dispose(); this.loadedTextures.delete(mat.aoMap); mat.aoMap = null; }
            if (mat.alphaMap) { mat.alphaMap.dispose(); this.loadedTextures.delete(mat.alphaMap); mat.alphaMap = null; }
            if (mat.envMap) { mat.envMap.dispose(); this.loadedTextures.delete(mat.envMap); mat.envMap = null; }
            if (mat.userData?.shader) { mat.userData.shader = null; }
            mat.dispose();
          };

          const material = child.material;
          if (Array.isArray(material)) {
            material.forEach(mat => disposeMat(mat));
          } else {
            if (material) disposeMat(material);
          }
          
          child.material = null; // Break reference
        }
      });
      
      // Remove from scene immediately
      this.scene.remove(this.stageModel);
      
      // Break all references in the graph
      this.stageModel.clear();
      this.stageModel = null;
    }
    this.shaderMaterials.clear();

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement = null;
    }
    this._glitchCanvas = null;
    this._glitchCanvasCtx = null;

    // Clean up preloaded data video
    if (this.preloadedDataVideo) {
      try {
        this.preloadedDataVideo.pause();
        try { this.preloadedDataVideo.removeAttribute('src'); } catch (err) {}
        try { this.preloadedDataVideo.load(); } catch (err) {}
      } catch (e) {
        console.warn('Error limpiando video precargado en unmount:', e);
      }
      this.preloadedDataVideo = null;
    }
    // Disconnect efedra resize observer / listeners if any
    try {
      if (this._efedraResizeObserver) {
        this._efedraResizeObserver.disconnect();
        this._efedraResizeObserver = null;
      }
      if (this._efedraFallbackResize) {
        window.removeEventListener('resize', this._efedraFallbackResize);
        this._efedraFallbackResize = null;
      }
    } catch (e) { }

  }

  async loadStage(i, options = {}) {
    this.showStageLoadingOverlay();
    this.current = i;
    const st = this.stages[i];
    if (!st) {
      this.hideStageLoadingOverlay({ immediate: true });
      return;
    }

    // 👇 NO resetear flechaClicked aquí - se resetea después de la transición completa

    // 👇 Rehabilitar clicks de especie al entrar a un stage nuevo
    this.speciesClickDisabled = false;

    // 👇 Asegurar que el videoOverlay esté oculto al cargar un nuevo stage
    const videoOverlay = document.getElementById('videoOverlay');
    if (videoOverlay) {
      videoOverlay.style.display = 'none';
      const speciesDataVideo = document.getElementById('speciesDataVideo');
      if (speciesDataVideo) {
        speciesDataVideo.pause();
        speciesDataVideo.currentTime = 0;
        // Optimización Móvil: Liberar memoria al purgar el source activamente si es teléfono
        if (browserInfo.isMobile && speciesDataVideo.getAttribute('src')) {
          try { speciesDataVideo.removeAttribute('src'); } catch(e) {}
          try { speciesDataVideo.load(); } catch(e) {}
        }
      }
    }

    // Detener audio de transición si está reproduciéndose (solo si no estamos en modo preload)
    if (this.transitionAudio && !options.keepTransitionAudio) {
      this.transitionAudio.pause();
      this.transitionAudio = null;
    }

    // 👇 Update SpeciesManager stage based on scene index
    // Scene index 0-5 always maps to stages 1-6
    // Round is preserved from SpeciesManager's current state
    const round = this.speciesManager.currentRound;
    const stage = (i % 6) + 1;

    // 👇 Bloquear cámara en ronda 1 hasta que se descubra la especie de esta escena específica
    if (round === 1) {
      this.cameraLocked = true;
      this.lat = 0;
      this.velLat = 0;

    } else {
      this.cameraLocked = false;

    }

    // Update SpeciesManager (this will save to localStorage)
    this.speciesManager.setRoundAndStage(round, stage);

    // 👇 Get current species from SpeciesManager
    this.currentSpecies = this.speciesManager.getCurrentSpecies();
    const currentSpeciesDiscovered = this.currentSpecies?.id ? this.speciesManager.isSpeciesFound(this.currentSpecies.id) : false;

    // 🔍 LOG: Información detallada de la escena y especie







    if (this.currentSpecies) {







    } else {

    }


    this.setInventoryImage();

    // Clean up previous stage's video and model
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.removeAttribute('src');
      this.videoElement.load();
      this.videoElement = null;
    }
    this._glitchCanvas = null;
    this._glitchCanvasCtx = null;

    if (this.currentVideoTexture) {
      this.currentVideoTexture.dispose();
      this.currentVideoTexture = null;
    }

    if (this.preloadedDataVideo) {
      try {
        this.preloadedDataVideo.pause();
        this.preloadedDataVideo.removeAttribute('src');
        this.preloadedDataVideo.load();
      } catch (e) {}
      this.preloadedDataVideo = null;
    }

    // 🔥 Clean up environment texture from previous stage
    if (this.envTexture) {
      this.envTexture.dispose();
      this.loadedTextures.delete(this.envTexture);
      this.envTexture = null;
    }
    
    // Clear tracked model URL
    this.currentStageModelUrl = null;

    if (this.stageModel) {
      this.stageModel.traverse(object => {
        if (object.isMesh) {
          object.geometry.dispose();
          
          const disposeMat = (mat) => {
            if (mat.map) { mat.map.dispose(); this.loadedTextures.delete(mat.map); mat.map = null; }
            if (mat.emissiveMap) { mat.emissiveMap.dispose(); this.loadedTextures.delete(mat.emissiveMap); mat.emissiveMap = null; }
            if (mat.normalMap) { mat.normalMap.dispose(); this.loadedTextures.delete(mat.normalMap); mat.normalMap = null; }
            if (mat.roughnessMap) { mat.roughnessMap.dispose(); this.loadedTextures.delete(mat.roughnessMap); mat.roughnessMap = null; }
            if (mat.metalnessMap) { mat.metalnessMap.dispose(); this.loadedTextures.delete(mat.metalnessMap); mat.metalnessMap = null; }
            if (mat.aoMap) { mat.aoMap.dispose(); this.loadedTextures.delete(mat.aoMap); mat.aoMap = null; }
            if (mat.alphaMap) { mat.alphaMap.dispose(); this.loadedTextures.delete(mat.alphaMap); mat.alphaMap = null; }
            if (mat.envMap) { mat.envMap.dispose(); this.loadedTextures.delete(mat.envMap); mat.envMap = null; }
            if (mat.userData?.shader) { mat.userData.shader = null; }
            mat.dispose();
          };

          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach(mat => disposeMat(mat));
            } else {
              disposeMat(object.material);
            }
          }
          object.material = null;
        }
      });
      
      // Remove from scene immediately
      this.scene.remove(this.stageModel);
      
      // Break all references in the graph
      this.stageModel.clear();
      this.stageModel = null;
    }
    this.shaderMaterials.clear();

    // Clean up animation mixers
    // 👇 Limpiar todos los mixers de flechas
    if (this.flechaAnimationMixers) {
      this.flechaAnimationMixers.forEach(mixer => {
        mixer?.stopAllAction?.();
      });
      this.flechaAnimationMixers = [];
      this.flechaAnimationActions = [];
    }
    this.flechaMasterMixer = null;

    // 🐟 Clean up carpa animation mixer
    if (this.carpaAnimationMixer) {
      this.carpaAnimationMixer.stopAllAction();
      this.carpaAnimationMixer = null;
      this.carpaAnimationAction = null;
    }

    // 🐟 Clean up carpa3d references
    this.carpa3dObject = null;
    this.carpa3dHover.enabled = false;
    this.carpa3dRotation.enabled = false;

    if (this.stageAnimationMixer) {
      this.stageAnimationMixer.stopAllAction();
      this.stageAnimationMixer = null;
      this.glitchAnimationAction = null;
      this.rastroAnimationAction = null;
    }

    this.gltfAnimations = [];
    this.glitchObject = null;
    this.rastroObject = null;
    this.flechaObject = null;
    this.flechaObjects = []; // 👈 Array para múltiples flechas
    this.flechaAnimationMixers = []; // 👈 Array de mixers
    this.flechaAnimationActions = []; // 👈 Array de actions
    this.carpaObject = null; // 🐟 Limpiar referencia de carpa
    this.carpa3dObject = null; // 🐟 Limpiar referencia de carpa3d
    this.glitchFlashState = null;

    // 🔊 Clean up species audio
    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
    }
    if (this.stereoPanner) {
      this.stereoPanner.disconnect();
      this.stereoPanner = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    if (this.speciesAudio) {
      this.speciesAudio.pause();
      this.speciesAudio.src = '';
      this.speciesAudio = null;
    }

    if (this.butterflyMixer) {
      try { this.butterflyMixer.stopAllAction(); } catch { }
      this.butterflyMixer = null;
      this.butterflyAction = null;
    }
    if (this.butterfly) {
      this.butterfly.parent?.remove(this.butterfly);
      this.butterfly = null;
    }
    if (this.butterflyOrbit) {
      this.butterflyOrbit.angle = 0;
    }

    // Clean up lens flare
    if (this.lensflare && this.sunLight) {
      this.sunLight.remove(this.lensflare);
    }
    this.lensflare = null;
    if (this.lensflareTextures?.length) {
      this.lensflareTextures.forEach(tex => tex.dispose?.());
    }
    this.lensflareTextures = [];
    if (this.sunLight) {
      console.debug('[RecorridoScene] Removing sun light and lens flare');
      this.scene.remove(this.sunLight);
      this.sunLight.dispose?.();
      this.sunLight = null;
    }
    this.sunObject = null;
    this._flareDebug = { created: false, frameLogged: false };

    // 👇 Force GC cycle hint by waiting a frame
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // Force a render of the empty scene to clear GPU buffers
    if (this.app && this.app.renderer) {
      this.app.renderer.render(this.scene, this.camera);
      this.app.renderer.info.reset();
    }

    // 🔥 CRITICAL: Multiple GC cycles to clean up blob URLs from previous scene
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 150));
      THREE.Cache.clear();
    }
    
    this.sceneLoadCount++;
    console.log(`[RecorridoScene] Memory cleanup complete, loading scene #${this.sceneLoadCount}...`);
    console.log(`[RecorridoScene] Previous textures in memory: ${this.loadedTextures.size}`);
    
    // Log memory usage if available
    if (performance.memory) {
      const memMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
      const limitMB = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2);
      console.log(`[RecorridoScene] JS Heap: ${memMB} MB / ${limitMB} MB`);
    }

    // 🔥 Clear THREE.js texture cache to prevent memory accumulation
    THREE.Cache.clear();

    // Load panorama: prioritize GLB, fallback to photo
    if (st.model) {
      // Use a fresh loader instance to avoid memory retention
      const loader = new GLTFLoader();
      
      // Optional: Configure Draco if needed (uncomment if you have Draco files)
      // const dracoLoader = new DRACOLoader();
      // dracoLoader.setDecoderPath('/draco/');
      // loader.setDRACOLoader(dracoLoader);

      let gltf;
      try {
        gltf = await loader.loadAsync(st.model);
        
        // 🔥 CRITICAL: Wait for all textures to upload to GPU before proceeding
        // GLTFLoader creates internal blob URLs for embedded textures that need time to process
        await this.waitForTexturesReady(gltf.scene);
        
      } catch (err) {
        console.error('[RecorridoScene] Error loading GLB:', err);
        this.hideStageLoadingOverlay({ immediate: true });
        return;
      }
      
      this.stageModel = gltf.scene;

    // 👇 FIX: Load environment texture from st.photo if available
    let envTexture = null;
    let envTextureUsed = false;

    // 🔥 Dispose previous environment texture if it exists
    if (this.envTexture) {
      this.envTexture.dispose();
      this.envTexture = null;
    }

    if (st.photo) {
      try {
        // 🔥 Optimización Móvil: Cargar variante de baja resolución si es teléfono.
        let photoPath = st.photo;
        if (browserInfo.isMobile && typeof photoPath === 'string') {
          photoPath = photoPath.replace(/\.(jpg|jpeg|png)$/i, '_mobile.$1');
        }
        
        // Load texture with a fresh loader to ensure no caching issues
        const texLoader = new THREE.TextureLoader();
        envTexture = await new Promise((resolve, reject) => {
          texLoader.load(photoPath, resolve, undefined, reject);
        });
        envTexture.colorSpace = THREE.SRGBColorSpace;
          envTexture.flipY = false; 
        } catch (e) {
          console.warn('Could not load environment texture:', e);
        }
      }

      // Store animations for later use
      this.gltfAnimations = gltf.animations || [];

      // � Store current stage model URL for later blob cleanup
      this.currentStageModelUrl = st.model;

      // �🔍 LOG: Información del GLB cargado





      const meshList = [];
      this.stageModel.traverse(child => {
        if (child.isMesh) {
          meshList.push(child.name);

          // 👇 FIX: Apply environment texture to sphere
          if (envTexture && (child.name.toLowerCase().includes('sphere') || child.name.toLowerCase().includes('esfera'))) {
             // Dispose old material if it exists
             if (child.material) {
               if (child.material.map) child.material.map.dispose();
               child.material.dispose();
             }

             child.material = new THREE.MeshBasicMaterial({
               map: envTexture,
               side: THREE.DoubleSide
             });
             envTextureUsed = true;
          }
        }
      });
      
      // Store or dispose environment texture
      if (envTexture && envTextureUsed) {
        // Store reference for later disposal
        this.envTexture = envTexture;
      } else if (envTexture && !envTextureUsed) {
        // If texture was loaded but not used, dispose it immediately to free memory
        envTexture.dispose();
        envTexture = null;
      }

      if (this.gltfAnimations.length > 0) {
        this.gltfAnimations.forEach((anim, idx) => {

        });
      }

      // Check if expected meshes are present
      if (this.currentSpecies) {
        const expectedGlitch = this.currentSpecies.meshNames.glitch;
        const expectedRastro = this.currentSpecies.meshNames.rastro;
        const hasGlitch = meshList.includes(expectedGlitch);
        const hasRastro = meshList.includes(expectedRastro);





        if (!hasGlitch) {
          console.warn(`⚠️ PROBLEMA: No se encontró el mesh "${expectedGlitch}" en el GLB`);
          console.warn('   Meshes disponibles:', meshList.join(', '));
        }
      }


      this.stageModel.traverse(child => {
        if (child.isMesh) {
          // 👇 Detectar TODAS las especies en el GLB (no solo la actual del turno)
          const meshName = child.name;

          // 👇 FIX: Apply environment texture to sphere
          if (envTexture && (meshName.toLowerCase().includes('sphere') || meshName.toLowerCase().includes('esfera'))) {
             child.material = new THREE.MeshBasicMaterial({
               map: envTexture,
               side: THREE.DoubleSide
             });
          }

          // Verificar si este mesh es un glitch o rastro de alguna especie
          const isGlitchMesh = meshName.endsWith('_glitch');
          const isRastroMesh = meshName.endsWith('_rastro');

          if (isGlitchMesh || isRastroMesh) {
            // Extraer ID de especie del nombre del mesh (ej: "yarara_glitch" -> "yarara")
            const speciesId = meshName.replace(/_glitch$|_rastro$/, '');

            // Buscar datos de esta especie en el SpeciesManager
            const speciesData = this.speciesManager.speciesData?.species?.find(s => s.id === speciesId);

            if (!speciesData) {
              console.warn(`⚠️ Especie no encontrada en datos: ${speciesId} (mesh: ${meshName})`);
              child.visible = false;
              return;
            }

            // Verificar si esta especie YA fue descubierta (en cualquier ronda anterior)
            const wasDiscovered = this.speciesManager.isSpeciesFound(speciesId);

            // ═══════════════════════════════════════════════════════
            // GLITCH MESH
            // ═══════════════════════════════════════════════════════
            if (isGlitchMesh) {
              // Solo asignar como glitchObject si es la especie ACTUAL del turno
              const isCurrentSpecies = this.currentSpecies && speciesId === this.currentSpecies.id;

              if (isCurrentSpecies) {
                this.glitchObject = child;






                if (wasDiscovered) {
                  // Ya fue descubierta -> ocultar glitch
                  child.visible = false;

                } else {
                  // No descubierta -> mostrar glitch con video
                  child.visible = true;

                  // Setup video texture
                  if (this.videoElement) {
                    this.videoElement.pause();
                    this.videoElement.src = '';
                  }

                  if (this.currentVideoTexture) {
                    this.currentVideoTexture.dispose();
                    this.currentVideoTexture = null;
                  }

                  this.videoElement = document.createElement('video');
                  const glitchSrc = getVideoSource(speciesData.assets.glitchVideo, {
                    fallback: speciesData.assets.glitchVideoFallback || null
                  });
                  this.videoElement.src = glitchSrc || speciesData.assets.glitchVideo;
                  this.videoElement.crossOrigin = 'anonymous';
                  this.videoElement.loop = true;
                  this.videoElement.muted = true;
                  this.videoElement.playsInline = true;
                  this.videoElement.setAttribute('webkit-playsinline', 'true');
                  this.videoElement.preload = 'auto';
                  this.videoElement.playbackRate = speciesData.glitchVideoSpeed || 0.25;
                  this.videoElement.play().catch(e => console.error("Video play failed:", e));

                  let videoTexture;
                  if (!browserInfo.supportsWebMAlpha) {
                    // Safari: HEVC alpha is not exposed through WebGL texImage2D.
                    // Use a canvas bridge: draw each video frame to a 2D canvas and
                    // upload that canvas as texture — 2D canvas drawImage preserves alpha.
                    // Canvas stays at a fixed large size; video is drawn scaled down each frame.
                    // Do NOT resize the canvas dynamically (clearing it causes invisible frames).
                    const canvas = document.createElement('canvas');
                    canvas.width = 1024;
                    canvas.height = 1024;
                    this._glitchCanvas = canvas;
                    this._glitchCanvasCtx = canvas.getContext('2d');
                    videoTexture = new THREE.CanvasTexture(canvas);
                  } else {
                    videoTexture = new THREE.VideoTexture(this.videoElement);
                  }
                  videoTexture.generateMipmaps = false;
                  videoTexture.minFilter = THREE.LinearFilter;
                  videoTexture.magFilter = THREE.LinearFilter;
                  videoTexture.format = THREE.RGBAFormat;
                  videoTexture.wrapS = THREE.ClampToEdgeWrapping;
                  videoTexture.wrapT = THREE.RepeatWrapping;
                  videoTexture.repeat.set(1, -1);
                  videoTexture.offset.set(0, 1);
                  this.currentVideoTexture = videoTexture;

                  if (child.material && child.material.emissiveMap) {
                    child.material.emissiveMap.dispose();
                  }

                  child.material.side = THREE.DoubleSide;
                  child.material.color.set(0xffffff);
                  child.material.map = videoTexture;
                  child.material.transparent = true;
                  child.material.depthWrite = false;
                  child.material.emissive.set(0x000000);
                  child.material.needsUpdate = true;


                }
              } else {
                // NO es la especie actual del turno




                if (wasDiscovered) {
                  // Ya descubierta en otro turno -> ocultar glitch
                  child.visible = false;

                } else {
                  // No descubierta aún -> ocultar todo (sin glitch, sin rastro, sin sonido)
                  child.visible = false;

                }
              }
            }

            // ═══════════════════════════════════════════════════════
            // RASTRO MESH
            // ═══════════════════════════════════════════════════════
            else if (isRastroMesh) {
              // Solo asignar como rastroObject si es la especie ACTUAL del turno
              const isCurrentSpecies = this.currentSpecies && speciesId === this.currentSpecies.id;

              if (isCurrentSpecies) {
                this.rastroObject = child;
                if (child.material) {
                  child.material.transparent = true;
                }
              }






              if (wasDiscovered) {
                // Ya descubierta -> mostrar rastro
                child.visible = true;

              } else {
                // No descubierta -> ocultar rastro
                child.visible = false;

              }
            }

          } else if (child.name) {
            const lowerName = child.name.toLowerCase();

            if (lowerName === 'flecha_empty') {
              this.flechaObject = child;
              if (child.visible) {

              }
              child.visible = false;
              return;
            }

            if (lowerName === 'flecha' || lowerName.startsWith('flecha.') || lowerName.match(/^flecha\d+$/)) {
              // 👇 Detectar todas las flechas (flecha, flecha.001, flecha.002, flecha1, flecha2, flecha3, etc.)
              if (!this.flechaObject && child.parent && child.parent.name && child.parent.name.toLowerCase() === 'flecha_empty') {
                this.flechaObject = child.parent;
                this.flechaObject.visible = false;
              } else if (!this.flechaObject && child.parent && child.parent !== this.stageModel) {
                this.flechaObject = child.parent;
                this.flechaObject.visible = false;
              } else if (!this.flechaObject) {
                this.flechaObject = child;
              }

              if (child.isMesh && !this.flechaObjects.includes(child)) {
                this.flechaObjects.push(child);
              }

              // 🔍 LOG: Mesh flecha detectado

              child.visible = false;


              // Set up flecha animation mixer and action
              if (child.isMesh && this.gltfAnimations && this.gltfAnimations.length > 0) {
                if (!this.flechaMasterMixer && this.stageModel) {
                  this.flechaMasterMixer = new THREE.AnimationMixer(this.stageModel);
                  this.flechaAnimationMixers.push(this.flechaMasterMixer);
                }

                const childNameLower = child.name.toLowerCase();
                const parentNameLower = child.parent?.name?.toLowerCase?.() || '';
                const ancestorNameLower = child.parent?.parent?.name?.toLowerCase?.() || '';

                // Build candidate names: original + variations
                const baseNames = [childNameLower, parentNameLower, ancestorNameLower].filter(Boolean);
                const candidateNames = new Set(baseNames);

                // Add variations: flecha.001 -> flecha, flecha1
                baseNames.forEach(name => {
                  // Remove .NNN suffix -> "flecha"
                  const withoutDotSuffix = name.replace(/\.\d+$/u, '');
                  if (withoutDotSuffix !== name) {
                    candidateNames.add(withoutDotSuffix);
                  }
                  // Extract digit and create flechaN variant: flecha.001 -> flecha1
                  const digitMatch = name.match(/\.(\d+)$/);
                  if (digitMatch && withoutDotSuffix) {
                    const digitStr = parseInt(digitMatch[1], 10).toString(); // "001" -> "1"
                    candidateNames.add(`${withoutDotSuffix}${digitStr}`);
                  }
                });

                let matchedTrackNode = null;
                let flechaAnimation = null;

                // 1) Buscar por las pistas del clip: matchea el nodo que anima
                for (const anim of this.gltfAnimations) {
                  for (const track of anim.tracks) {
                    const nameStr = track.name || '';
                    // Track format: "nodeName.property" or "parent|child.property"
                    const lastDot = nameStr.lastIndexOf('.');
                    const rawNode = lastDot >= 0 ? nameStr.substring(0, lastDot) : nameStr;
                    const trackNodeName = rawNode.includes('|') ? rawNode.split('|').pop() : rawNode;
                    const trackNodeLower = trackNodeName.replace(/\\\./g, '.').toLowerCase();

                    if (candidateNames.has(trackNodeLower)) {
                      flechaAnimation = anim;
                      matchedTrackNode = trackNodeName;
                      break;
                    }
                  }
                  if (flechaAnimation) break;
                }

                // 2) Fallback: buscar por nombre del clip (Action, Action.001, etc.)
                if (!flechaAnimation) {
                  const suffixMatch = child.name.match(/(\.\d+)?$/);
                  const suffix = (suffixMatch?.[1] || '').toLowerCase();
                  const desiredAnimName = `action${suffix}`;
                  flechaAnimation = this.gltfAnimations.find(anim =>
                    (anim.name || '').toLowerCase() === desiredAnimName
                  ) || null;
                }

                // 3) Último recurso: heurística por contenido del nombre
                if (!flechaAnimation) {
                  flechaAnimation = this.gltfAnimations.find(anim => {
                    const animNameLower = anim.name?.toLowerCase?.() || '';
                    return animNameLower.includes('flecha') ||
                      animNameLower.includes('arrow') ||
                      Array.from(candidateNames).some(c => animNameLower.includes(c));
                  }) || null;
                }

                if (!flechaAnimation && this.gltfAnimations.length > 0) {
                  flechaAnimation = this.gltfAnimations[0];
                }

                if (!flechaAnimation) {
                  console.warn(`   ⚠️ No se encontró animación para ${child.name}`);
                }

                if (flechaAnimation && this.flechaMasterMixer) {
                  try {
                    const action = this.flechaMasterMixer.clipAction(flechaAnimation);
                    action.setLoop(THREE.LoopRepeat);
                    action.clampWhenFinished = false;
                    action.enabled = true;
                    action.setEffectiveWeight(1.0);
                    action.setEffectiveTimeScale(1.0);
                    action.reset();

                    // 2-frame offset per arrow, reversed order (assuming 30fps)
                    const flechaIndex = this.flechaObjects.indexOf(child);
                    if (flechaIndex >= 0) {
                      const reverseIndex = (this.flechaObjects.length - 1) - flechaIndex;
                      const frameOffset = reverseIndex * 2; // Last arrow = 0, first arrow = most offset
                      const timeOffset = frameOffset / 30; // Convert to seconds
                      action.time = timeOffset;
                    }

                    action.play();

                    this.flechaAnimationActions.push(action);
                    const logTrack = matchedTrackNode ? ` (track: ${matchedTrackNode})` : '';

                  } catch (error) {
                    console.error(`   ❌ Error al configurar animación:`, error);
                    this.flechaAnimationActions.push(null);
                  }
                } else {
                  if (!this.flechaMasterMixer) {
                    console.warn('   ⚠️ No se pudo crear flechaMasterMixer (stageModel ausente)');
                  }
                  this.flechaAnimationActions.push(null);
                }
              } else if (child.isMesh) {
                this.flechaAnimationActions.push(null);
              }
            }
          } else if (child.name === 'carpa' || child.name.toLowerCase().includes('carpa')) {
            // 🐟 Detectar mesh de la carpa
            this.carpaObject = child;
            child.visible = true; // 👈 La carpa siempre es visible



            // 🐟 Detectar si es carpa3d para animación de hover
            const isCarpa3D = child.name === 'carpa3d';
            if (isCarpa3D) {
              this.carpa3dObject = child;
              this.carpa3dHover.baseY = child.position.y;
              this.carpa3dHover.enabled = true;
              this.carpa3dRotation.enabled = true;


            }

            // Set up carpa animation mixer and action
            if (this.gltfAnimations && this.gltfAnimations.length > 0) {
              this.carpaAnimationMixer = new THREE.AnimationMixer(child);

              // Buscar animación que contenga 'carpa' en el nombre
              let carpaAnimation = this.gltfAnimations.find(anim =>
                anim.name.toLowerCase().includes('carpa')
              );

              // Si no se encuentra por nombre, buscar en los tracks
              if (!carpaAnimation) {
                carpaAnimation = this.gltfAnimations.find(anim =>
                  anim.tracks.some(track =>
                    track.name.toLowerCase().includes('carpa') ||
                    track.name.includes(child.name) ||
                    track.name.includes(child.uuid)
                  )
                );
              }

              if (carpaAnimation) {
                try {
                  this.carpaAnimationAction = this.carpaAnimationMixer.clipAction(carpaAnimation);
                  this.carpaAnimationAction.setLoop(THREE.LoopRepeat); // Loop continuo
                  this.carpaAnimationAction.clampWhenFinished = false;
                  this.carpaAnimationAction.play();

                } catch (error) {
                  console.error('🐟 Error al iniciar animación de carpa:', error);
                  this.carpaAnimationAction = null;
                }
              } else {
                console.warn('🐟 No se encontró animación para la carpa');
              }
            }
          }
        } else if (child.name === 'Sun' || child.name === 'sun') {
          this.sunObject = child;
          if (!child.parent) {
            console.warn('[RecorridoScene] Sun object has no parent in GLTF scene graph.');
          }
          const sunWorld = child.getWorldPosition(new THREE.Vector3());
          console.debug('[RecorridoScene] Sun null found', {
            localPosition: child.position.toArray(),
            worldPosition: sunWorld.toArray()
          });
        }
      });

      // 🎬 Set up animations for the entire stage model (play once and stop)
      if (this.gltfAnimations && this.gltfAnimations.length > 0 && this.stageModel) {



        // Create a single mixer for the entire stage model
        this.stageAnimationMixer = new THREE.AnimationMixer(this.stageModel);

        // Get animation speed from current species data (default: 1.0)
        const animSpeed = this.currentSpecies?.animationSpeed ?? 1.0;

        this.gltfAnimations.forEach((anim, idx) => {


          // Check if this animation targets glitch or rastro objects
          const isGlitchAnim = anim.name.toLowerCase().includes('glitch');
          const isRastroAnim = anim.name.toLowerCase().includes('rastro');

          if (isGlitchAnim || isRastroAnim) {
            const action = this.stageAnimationMixer.clipAction(anim);
            action.setLoop(THREE.LoopOnce); // Play once
            action.clampWhenFinished = true; // Stay at last frame
            action.setEffectiveTimeScale(animSpeed); // 👈 Velocidad según especie
            action.play();

            const realDuration = anim.duration / animSpeed;


            // Store action references
            if (isGlitchAnim) {
              this.glitchAnimationAction = action;
            }
            if (isRastroAnim) {
              this.rastroAnimationAction = action;
            }
          }
          // 🐟 Las animaciones de carpa se manejan en su propio mixer (carpaAnimationMixer)
        });

        if (!this.glitchAnimationAction && !this.rastroAnimationAction) {

          // Clean up mixer if no animations were set up
          this.stageAnimationMixer = null;
        }
      }

      // Create lens flare if Sun object was found
      if (this.sunObject) {
        await this.createLensFlare();
      } else {
        console.warn('[RecorridoScene] No Sun null found in stage model; lens flare skipped.');
      }

      this.scene.add(this.stageModel);
      this.collectShaderMaterials(this.stageModel);

      // 👇 IMPORTANTE: Asegurar que todas las flechas estén ocultas al inicio
      // Hacemos un traverse adicional para capturar cualquier flecha que se haya escapado
      this.stageModel.traverse(child => {
        if (!child.name) {
          return;
        }

        const lowerName = child.name.toLowerCase();

        if (lowerName === 'flecha_empty') {
          child.visible = false;
          if (!this.flechaObject) {
            this.flechaObject = child;
          }
          return;
        }

        if (child.isMesh && (lowerName === 'flecha' || lowerName.startsWith('flecha.') || lowerName.match(/^flecha\d+$/))) {
          const wasVisible = child.visible;
          child.visible = false;
          if (wasVisible) {

          }

          // Asegurarnos de que esté en el array
          if (!this.flechaObjects.includes(child)) {
            console.warn(`⚠️ Flecha ${child.name} no estaba en flechaObjects, agregándola`);
            this.flechaObjects.push(child);
            this.flechaAnimationActions.push(null);
          }
        }
      });

      if (this.flechaObjects && this.flechaObjects.length > 0) {

      }

      await this.spawnButterflyNearGlitch();
    } else if (st.photo) {
      const sphereGeo = new THREE.SphereGeometry(500, 64, 48).scale(-1, 1, 1);
      
      let photoPath = st.photo;
      if (browserInfo.isMobile && typeof photoPath === 'string') {
        photoPath = photoPath.replace(/\.(jpg|jpeg|png)$/i, '_mobile.$1');
      }
      
      const tex = await AssetLoader.texture(photoPath);
      const sphereMat = new THREE.MeshBasicMaterial({
        map: tex,
        fog: false,
        lights: false
      });
      this.stageModel = new THREE.Mesh(sphereGeo, sphereMat);
      this.stageModel.receiveShadow = false;
      this.stageModel.castShadow = false;
      this.scene.add(this.stageModel);
      this.collectShaderMaterials(this.stageModel);
    }

    // 👀 Si la especie de este stage ya fue descubierta, mostrar la flecha de inmediato
    if (currentSpeciesDiscovered && this.flechaObjects && this.flechaObjects.length > 0) {
      this.flechaClicked = false;
      if (this.flechaObject) {
        this.flechaObject.visible = true;
      }
      this.flechaObjects.forEach((flechaObj, index) => {
        flechaObj.visible = true;
        const action = this.flechaAnimationActions[index];
        if (action) {
          action.reset();
          const reverseIndex = (this.flechaObjects.length - 1) - index;
          const frameOffset = reverseIndex * 2;
          action.time = frameOffset / 30;
          action.play();
        }
      });
    }


    if (st.forward) {
      this.lon = st.forward.yaw;
      this.lat = st.forward.pitch;
    }

    // Stage-specific audio (different from background music)
    // Keep ambience continuous: crossfade instead of hard-stop.
    const prevStageAudio = this.audio;
    const targetStageVolume = 0.8;

    if (st.audio) {
      const nextStageAudio = AssetLoader.audio(st.audio);
      nextStageAudio.loop = true;
      nextStageAudio.volume = 0;
      this.audio = nextStageAudio;

      // Try to start immediately (if blocked, the previous audio keeps playing)
      nextStageAudio.play().catch(() => { });

      const fadeMs = 1000;
      const t0 = performance.now();
      const prevStartVol = (prevStageAudio && typeof prevStageAudio.volume === 'number') ? prevStageAudio.volume : 0;

      const tick = () => {
        const t = Math.min(1, (performance.now() - t0) / fadeMs);

        try { nextStageAudio.volume = targetStageVolume * t; } catch (e) { /* ignore */ }

        if (prevStageAudio && prevStageAudio !== nextStageAudio) {
          try { prevStageAudio.volume = prevStartVol * (1 - t); } catch (e) { /* ignore */ }
        }

        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          if (prevStageAudio && prevStageAudio !== nextStageAudio) {
            try { prevStageAudio.pause(); } catch (e) { /* ignore */ }
          }
          try { nextStageAudio.volume = targetStageVolume; } catch (e) { /* ignore */ }
        }
      };
      requestAnimationFrame(tick);
    } else {
      if (this.audio) {
        try { this.audio.pause(); } catch (e) { /* ignore */ }
        this.audio = null;
      }
    }

    // 🔊 Load species spatial audio - SOLO si la especie NO ha sido descubierta
    if (this.currentSpecies?.id) {
      const wasDiscovered = currentSpeciesDiscovered;

      if (!wasDiscovered) {
        // Solo reproducir audio si la especie NO ha sido descubierta
        const audioPath = `/game-assets/recorrido/criaturas/${this.currentSpecies.id}/${this.currentSpecies.id}_sonido.mp3`;
        this.speciesAudio = new Audio(audioPath);
        this.speciesAudio.loop = true;
        this.speciesAudio.crossOrigin = 'anonymous';

        // 👇 Manejar error de carga del audio (404, formato inválido, etc) - SILENCIOSO
        this.speciesAudio.addEventListener('error', (e) => {
          // Limpiar nodos Web Audio si fueron creados
          if (this.audioSource) {
            try { this.audioSource.disconnect(); } catch { }
            this.audioSource = null;
          }
          if (this.stereoPanner) {
            try { this.stereoPanner.disconnect(); } catch { }
            this.stereoPanner = null;
          }
          if (this.gainNode) {
            try { this.gainNode.disconnect(); } catch { }
            this.gainNode = null;
          }
          this.speciesAudio = null;
          // No mostrar error - es normal que algunas especies no tengan audio espacial
        }, { once: true });

        // Create Web Audio API context and nodes for stereo panning
        if (!this.audioContext) {
          this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // 👇 Solo crear nodos si el audio se carga exitosamente
        this.speciesAudio.addEventListener('canplaythrough', () => {
          if (!this.speciesAudio) return; // Ya fue limpiado por error

          try {
            // Create audio nodes
            this.audioSource = this.audioContext.createMediaElementSource(this.speciesAudio);
            this.stereoPanner = this.audioContext.createStereoPanner();
            this.gainNode = this.audioContext.createGain();

            // Connect: source -> panner -> gain -> destination
            this.audioSource.connect(this.stereoPanner);
            this.stereoPanner.connect(this.gainNode);
            this.gainNode.connect(this.audioContext.destination);

            // Start with volume at 0 (will be updated when in view)
            this.gainNode.gain.value = 0;
            this.stereoPanner.pan.value = 0;



            // Try to play the audio
            this.speciesAudio.play().catch((err) => {
              // Silencioso - es normal que el autoplay esté bloqueado
            });
          } catch (err) {
            console.warn(`Error configurando Web Audio API (se ignorará):`, err.message);
            this.speciesAudio = null;
          }
        }, { once: true });
      } else {

      }
    }

    // 📺 Precargar video de data de la especie para evitar lag al hacer click
    // En móviles suprimimos la precarga para ahorrar límite de memoria/streams en navegadores móviles.
    if (this.currentSpecies?.assets?.dataVideo && !browserInfo.isMobile) {
      const dataVideoSrc = getVideoSource(this.currentSpecies.assets.dataVideo, {
        fallback: this.currentSpecies.assets.dataVideoFallback || null
      });
      // Limpiar video anterior si existe
      if (this.preloadedDataVideo) {
        try {
          this.preloadedDataVideo.pause();
          // Explicitly remove src and call load() to reliably abort network fetch
          try { this.preloadedDataVideo.removeAttribute('src'); } catch (err) {}
          try { this.preloadedDataVideo.load(); } catch (err) {}
        } catch (e) {
          console.warn('Error limpiando video precargado:', e);
        }
        this.preloadedDataVideo = null;
      }

      // Crear nuevo video y precargarlo (modo silencioso - no bloquear si falla)
      try {
        // Create element and capture it in a local const to avoid races with
        // subsequent calls that may replace `this.preloadedDataVideo`.
        const v = document.createElement('video');
        v.src = dataVideoSrc || this.currentSpecies.assets.dataVideo;
        v.muted = true; // Muted para permitir precarga sin interacción del usuario
        v.preload = 'metadata'; // Cambiar a 'metadata' en lugar de 'auto' para cargar menos datos
        v.playsInline = true;

        // Esperar a que se carguen los metadatos
        v.addEventListener('loadedmetadata', () => {
          // 👇 Verificar que el video sigue siendo válido antes de acceder a duration
          if (v && v.duration) {
            // metadata available; nothing else required here
          }
        }, { once: true });

        // Manejar errores de carga - NO BLOQUEAR la funcionalidad
        const self = this;
        v.addEventListener('error', function onErr(e) {
          console.warn('⚠️ No se pudo precargar video de data (se cargará bajo demanda):', self.currentSpecies?.assets?.dataVideo);
          // Limpieza segura del elemento local
          try { v.removeAttribute('src'); } catch (err) {}
          try { v.load(); } catch (err) {}
          // If the currently stored preloadedDataVideo points to this element, clear it
          if (self.preloadedDataVideo === v) {
            self.preloadedDataVideo = null;
          }
        }, { once: true });

        this.preloadedDataVideo = v;
      } catch (e) {
        console.warn('⚠️ Error creando elemento de precarga de video (se ignorará):', e);
        this.preloadedDataVideo = null;
      }
    }

    this.hideStageLoadingOverlay();

    // �🔍 LOG: Resumen de carga completada













  }

  onMouseMove(e) {
    // 👇 Permitir mouse move siempre para la cámara
    const rect = this.app.canvas.getBoundingClientRect();
    this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNDC.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    // 👇 Detectar si el mouse está sobre el glitch para cambiar color del cursor
    if (this.glitchObject && this.cursorRadar && this.cursorRadar.cursorEl) {
      this.raycaster.setFromCamera(this.mouseNDC, this.camera);
      const hits = this.raycaster.intersectObject(this.glitchObject, true);

      if (hits.length > 0) {
        // Mouse sobre el glitch - cursor verde
        this.cursorRadar.cursorEl.style.filter = 'sepia(1) saturate(5) hue-rotate(70deg) brightness(1.2)';
      } else {
        // Mouse fuera del glitch - cursor normal
        this.cursorRadar.cursorEl.style.filter = 'none';
      }
    }
  }

  onKeyDown(e) {
    // 👇 Bloquear SPACE si el data overlay está visible
    const videoOverlay = document.getElementById('videoOverlay');
    const isOverlayVisible = videoOverlay && videoOverlay.style.display === 'block';

    // 🔄 REMOVED: Space bar zoom functionality - now using scroll wheel
    // if (e.code === 'Space' && !this.zoom.isZooming && !isOverlayVisible) {
    //   e.preventDefault();
    //   this.zoom.isZooming = true;
    // }

    // 🎮 DEBUG: Atajos de teclado para cambiar de ambiente/ronda
    // Teclas 1-6: Cambiar ambiente dentro de la ronda actual
    if (e.code >= 'Digit1' && e.code <= 'Digit6') {
      e.preventDefault();
      const newStage = parseInt(e.code.replace('Digit', ''));
      const round = this.speciesManager.currentRound;
      if (this.speciesManager.setRoundAndStage(round, newStage)) {
        const sceneIndex = (newStage - 1) % 6; // Scenes 0-5 for stages 1-6

        this.loadStage(sceneIndex);
      }
    }

    // Teclas Q, W, E, R, T: Cambiar ronda (mantiene el ambiente actual)
    const roundKeys = { 'KeyQ': 1, 'KeyW': 2, 'KeyE': 3, 'KeyR': 4, 'KeyT': 5 };
    if (roundKeys[e.code]) {
      e.preventDefault();
      const newRound = roundKeys[e.code];
      const stage = this.speciesManager.currentStage;
      if (this.speciesManager.setRoundAndStage(newRound, stage)) {
        const sceneIndex = (stage - 1) % 6; // Scenes 0-5 for stages 1-6

        this.loadStage(sceneIndex);
      }
    }

    // Tecla I: Mostrar info de ronda/ambiente actual
    if (e.code === 'KeyI') {
      e.preventDefault();
      window.verRonda();
    }

    // 🎨 Tecla L: Toggle Gamer LUT
    if (e.code === 'KeyL') {
      e.preventDefault();
      this.useGamerLUT = !this.useGamerLUT;

    }
  }

  onKeyUp(e) {
    // 👇 Bloquear SPACE si el data overlay está visible
    const videoOverlay = document.getElementById('videoOverlay');
    const isOverlayVisible = videoOverlay && videoOverlay.style.display === 'block';

    // 🔄 REMOVED: Space bar zoom functionality - now using scroll wheel
    // if (e.code === 'Space' && this.zoom.isZooming && !isOverlayVisible) {
    //   e.preventDefault();
    //   this.zoom.isZooming = false;
    // }
  }

  onWheel(e) {
    // 🔍 Scroll wheel zoom functionality
    const videoOverlay = document.getElementById('videoOverlay');
    const isOverlayVisible = videoOverlay && videoOverlay.style.display === 'block';

    // Also block zoom if Efedra species overlay is visible
    const efedraWrapper = document.querySelector('.efedra-wrapper');
    const isEfedraVisible = efedraWrapper && efedraWrapper.style.display !== 'none';

    // Don't zoom if video overlay is visible
    if (isOverlayVisible || isEfedraVisible) return;

    e.preventDefault();

    // Get wheel delta (normalized) - make it even slower
    const delta = e.deltaY > 0 ? 1 : -1;

    // Apply very small zoom change with dampening for smooth, slow zooming
    const zoomChange = delta * this.zoom.zoomSpeed * 0.8; // Extra dampening multiplier
    const targetFOV = (this.zoom.targetFOV || this.zoom.currentFOV) + zoomChange;

    // Clamp to min/max FOV values
    this.zoom.targetFOV = THREE.MathUtils.clamp(targetFOV, this.zoom.minFOV, this.zoom.maxFOV);
  }

  onClick(e) {
    // 👇 Bloquear todos los clicks durante la transición
    if (this.flechaClicked) {
      return;
    }

    // 👇 Bloquear clicks en especies durante 3s después de descubrir
    if (this.speciesClickDisabled) {
      return;
    }

    // 👇 Start cursor click animation
    if (this.cursorRadar) {
      this.cursorRadar.startCursorClick(e.clientX, e.clientY);
    }

    // 👇 Prevent clicks when video overlay is visible
    const videoOverlay = document.getElementById('videoOverlay');
    if (videoOverlay && videoOverlay.style.display === 'block') {
      return; // Don't process clicks on the 3D scene while overlay is open
    }

    // 👇 Prevent clicks when Efedra (species) overlay is visible
    const efedraWrapper = document.querySelector('.efedra-wrapper');
    if (efedraWrapper && efedraWrapper.style.display !== 'none') {
      return;
    }

    // Calculate mouse position with 200px x 200px hitbox
    const rect = this.app.canvas.getBoundingClientRect();
    const hitboxSize = 200; // 200px x 200px hitbox
    const halfSize = hitboxSize / 2;

    // Test multiple points in the hitbox area (grid pattern)
    const testPoints = [];
    const gridSize = 5; // 5x5 grid = 25 test points
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const offsetX = (i / (gridSize - 1) - 0.5) * hitboxSize;
        const offsetY = (j / (gridSize - 1) - 0.5) * hitboxSize;
        const testX = e.clientX + offsetX;
        const testY = e.clientY + offsetY;

        const ndc = new THREE.Vector2();
        ndc.x = ((testX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -(((testY - rect.top) / rect.height) * 2 - 1);
        testPoints.push(ndc);
      }
    }

    // Use center point as the primary raycaster position
    const ndc = new THREE.Vector2();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(ndc, this.camera);

    // Check flecha click first (test all points in hitbox) - TODAS las flechas
    if (this.flechaObjects && this.flechaObjects.length > 0 && !this.flechaClicked) {
      for (const flechaObj of this.flechaObjects) {
        if (flechaObj.visible) {
          for (const testNDC of testPoints) {
            this.raycaster.setFromCamera(testNDC, this.camera);
            const flechaHits = this.raycaster.intersectObject(flechaObj, true);
            if (flechaHits.length > 0) {
              this.onFlechaClick();
              return;
            }
          }
        }
      }
    }

    // Check ALL rastro objects (especies ya descubiertas) - SOLO punto exacto de clic
    // 👇 BLOQUEAR clicks en rastros hasta que se descubra el glitch de la escena actual
    const currentSpeciesDiscovered = this.currentSpecies?.id ?
      this.speciesManager.isSpeciesFound(this.currentSpecies.id) : true;

    if (this.stageModel && currentSpeciesDiscovered) {
      let bestRastroHit = null;
      let bestRastroMesh = null;
      let clickedSpeciesData = null;

      // 👇 Recolectar TODOS los meshes rastro visibles una sola vez
      const rastroMeshes = [];
      this.stageModel.traverse(child => {
        if (child.isMesh && child.visible && child.name.includes('_rastro')) {
          const speciesId = child.name.replace('_rastro', '');
          const wasDiscovered = this.speciesManager.isSpeciesFound(speciesId);
          if (wasDiscovered) {
            rastroMeshes.push(child);
          }
        }
      });

      // 👇 Buscar hits SOLO en el punto exacto de clic (sin hitbox)
      this.raycaster.setFromCamera(ndc, this.camera);

      for (const rastroMesh of rastroMeshes) {
        const hits = this.raycaster.intersectObject(rastroMesh, true);

        if (hits.length > 0) {
          const hit = hits[0];

          // Guardar el hit más cercano
          if (!bestRastroHit || hit.distance < bestRastroHit.distance) {
            bestRastroHit = hit;
            bestRastroMesh = rastroMesh;
          }
        }
      }

      // 👇 Solo analizar el pixel del MEJOR hit (el más cercano)
      if (bestRastroHit && bestRastroMesh) {
        const isTransparent = this.isRastroPixelTransparent(bestRastroHit, bestRastroMesh);

        if (!isTransparent) {
          // Extraer ID de especie y buscar datos
          const speciesId = bestRastroMesh.name.replace('_rastro', '');
          clickedSpeciesData = this.speciesManager.speciesData?.species?.find(s => s.id === speciesId);
        }
      }

      if (clickedSpeciesData) {








        // 👇 Desactivar clicks en especies por 3 segundos
        this.speciesClickDisabled = true;
        setTimeout(() => {
          this.speciesClickDisabled = false;
        }, 3000);

        // Play radar animation at click position
        if (this.cursorRadar) {
          this.cursorRadar.playRadarAt(e.clientX, e.clientY);
        }

        // Trigger alpha flash on the rastro mesh
        this.triggerRastroAlphaFlash(clickedSpeciesData.id);

        // Guardar temporalmente la especie clickeada para mostrar su popup
        const previousSpecies = this.currentSpecies;
        this.currentSpecies = clickedSpeciesData;

        // Mostrar el popup de datos
        this.playDataOverlayVideo();

        // Restaurar la especie actual después de un frame
        setTimeout(() => {
          this.currentSpecies = previousSpecies;
        }, 100);

        return;
      }
    } else if (this.stageModel && !currentSpeciesDiscovered) {

    }

    // Then check glitch object (test all points in hitbox)
    if (!this.glitchObject) {
      // 🔧 Fallback: intentar reasignar el glitch si no quedó seteado
      const fallbackName = this.currentSpecies?.meshNames?.glitch;
      if (fallbackName && this.stageModel) {
        let found = null;
        this.stageModel.traverse(child => {
          if (!found && child.isMesh && child.name === fallbackName) {
            found = child;
          }
        });
        if (found) {
          this.glitchObject = found;
          // Si estaba invisible por error, mostrarlo
          this.glitchObject.visible = true;
          console.warn('[RecorridoScene] glitchObject se reasignó por fallback', fallbackName);
        }
      }

      if (!this.glitchObject) return;
    }

    let bestHit = null;

    // Test all points in the hitbox area
    for (const testNDC of testPoints) {
      this.raycaster.setFromCamera(testNDC, this.camera);
      const hits = this.raycaster.intersectObject(this.glitchObject, true);

      if (hits.length > 0) {
        const hit = hits[0];

        // Keep the closest hit
        if (!bestHit || hit.distance < bestHit.distance) {
          bestHit = hit;
        }
      }
    }

    // console.log('🔍 DEBUG CLICK:', {
    //   tieneGlitchObject: !!this.glitchObject,
    //   glitchVisible: this.glitchObject?.visible,
    //   hitboxTestPoints: testPoints.length,
    //   encontradoHit: !!bestHit,
    //   especieActual: this.currentSpecies?.commonName || 'ninguna'
    // });

    if (bestHit) {
      // 👇 Desbloquear cámara para permitir movimiento libre
      this.cameraLocked = false;

      // 👇 Desactivar clicks en especies por 3 segundos
      this.speciesClickDisabled = true;
      setTimeout(() => {
        this.speciesClickDisabled = false;
      }, 3000);

      // Play radar animation at click position (lightweight)
      if (this.cursorRadar) {
        this.cursorRadar.playRadarAt(e.clientX, e.clientY);
      }

      // 👇 LOG simplificado (menos líneas = menos carga)
      if (this.currentSpecies) {

      }

      // 👇 OPTIMIZACIÓN: Ejecutar efectos visuales de forma escalonada para evitar lag
      // Primero: efectos rápidos y ligeros
      this.triggerGlitchFlash(); // Solo DOM + CSS (0.5s)

      // Segundo: marcar especie (no visual, sin lag)
      if (this.currentSpecies) {
        this.speciesManager.markSpeciesFound(this.currentSpecies.id);
        // 👇 Actualizar progress overlay
        if (window.progressManager) {
          window.progressManager.updateAllProgress();
        }
        // 👇 El panel se actualizará cuando el usuario cierre el overlay
      }

      // Tercero: efectos pesados con delay mínimo para permitir que el primer frame se renderice
      requestAnimationFrame(() => {
        this.triggerGlobalGlitch(1500); // DOM + CSS

        // Cuarto: video overlay (lo más pesado) con un frame extra de delay
        requestAnimationFrame(() => {
          this.playDataOverlayVideo();

          // Quinto: white flash (shader intensivo) después del video para no competir
          setTimeout(() => {
            this.startGlitchWhiteFlash();
          }, 50);
        });
      });
    }
  }

  /**
   * Check if a pixel at the intersection point is transparent
   * @param {THREE.Intersection} intersection - The raycaster intersection
   * @returns {boolean} - True if transparent (alpha < threshold), false otherwise
   */
  isPixelTransparent(intersection) {
    if (!intersection.uv || !this.glitchObject || !this.glitchObject.material) {
      return false;
    }

    const material = this.glitchObject.material;
    const alphaMap = material.alphaMap || material.map;

    if (!alphaMap || !alphaMap.image) {
      return false;
    }

    // Get UV coordinates at the intersection point
    const uv = intersection.uv;

    // Create a canvas to read pixel data from the texture
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const image = alphaMap.image;

    // For video textures
    if (image instanceof HTMLVideoElement) {
      if (image.readyState < 2) {
        // Video not ready, ignore click (treat as transparent)
        return true;
      }
      canvas.width = image.videoWidth;
      canvas.height = image.videoHeight;
    } else {
      // For image textures
      canvas.width = image.width;
      canvas.height = image.height;
    }

    context.drawImage(image, 0, 0);

    // Calculate pixel position from UV coordinates
    const x = Math.floor(uv.x * canvas.width);
    const y = Math.floor((1 - uv.y) * canvas.height); // Flip Y coordinate

    // Get pixel data (RGBA)
    const pixelData = context.getImageData(x, y, 1, 1).data;
    const alpha = pixelData[3]; // Alpha channel

    // Consider pixels with alpha < 128 as transparent
    const alphaThreshold = 128;
    const isTransparent = alpha < alphaThreshold;

    return isTransparent;
  }

  /**
   * Check if a pixel at the intersection point on a rastro mesh is transparent
   * @param {THREE.Intersection} intersection - The raycaster intersection
   * @param {THREE.Mesh} rastroMesh - The rastro mesh object
   * @returns {boolean} - True if transparent (alpha < threshold), false otherwise
   */
  isRastroPixelTransparent(intersection, rastroMesh) {
    if (!intersection.uv || !rastroMesh || !rastroMesh.material) {
      return false;
    }

    const material = rastroMesh.material;
    const alphaMap = material.alphaMap || material.map;

    if (!alphaMap || !alphaMap.image) {
      return false;
    }

    // Get UV coordinates at the intersection point
    const uv = intersection.uv;

    // Create a canvas to read pixel data from the texture
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const image = alphaMap.image;

    // For video textures
    if (image instanceof HTMLVideoElement) {
      if (image.readyState < 2) {
        // Video not ready, ignore click (treat as transparent)
        return true;
      }
      canvas.width = image.videoWidth;
      canvas.height = image.videoHeight;
    } else {
      // For image textures
      canvas.width = image.width;
      canvas.height = image.height;
    }

    context.drawImage(image, 0, 0);

    // Calculate pixel position from UV coordinates
    const x = Math.floor(uv.x * canvas.width);
    const y = Math.floor((1 - uv.y) * canvas.height); // Flip Y coordinate

    // Get pixel data (RGBA)
    const pixelData = context.getImageData(x, y, 1, 1).data;
    const alpha = pixelData[3]; // Alpha channel

    // Consider pixels with alpha < 128 as transparent
    const alphaThreshold = 128;
    const isTransparent = alpha < alphaThreshold;

    return isTransparent;
  }

  /**
   * Check if a pixel at the click position on a video overlay is transparent
   * @param {HTMLVideoElement} videoElement - The video element
   * @param {MouseEvent} event - The click event
   * @returns {boolean} - True if transparent (alpha < threshold), false otherwise
   */
  isVideoPixelTransparent(videoElement, event) {
    if (!videoElement || videoElement.readyState < 2) {
      return false; // Video not ready, don't consider transparent
    }

    // Get click position relative to the video overlay
    const rect = videoElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Create canvas to read pixel data
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    // Draw current video frame
    context.drawImage(videoElement, 0, 0);

    // Calculate pixel position (scale from display size to video size)
    const scaleX = videoElement.videoWidth / rect.width;
    const scaleY = videoElement.videoHeight / rect.height;
    const pixelX = Math.floor(x * scaleX);
    const pixelY = Math.floor(y * scaleY);

    // Get pixel data (RGBA)
    const pixelData = context.getImageData(pixelX, pixelY, 1, 1).data;
    const alpha = pixelData[3]; // Alpha channel

    // Consider pixels with alpha < 128 as transparent
    const alphaThreshold = 128;
    return alpha < alphaThreshold;
  }

  onResize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // No llamar a setSize aquí - lo maneja App.js
    this.onResizeOverlay();

    // 🎨 Actualizar tamaño del composer
    if (this.composer) {
      this.composer.setSize(w, h);
    }
  }

  smoothLookForward(onDone) {
    const st = this.stages[this.current]; const target = st.forward || { yaw: 0, pitch: 0 };
    const startLon = this.lon, startLat = this.lat; const start = performance.now(); const duration = 2000; this.isAutoLook = true;
    const anim = () => {
      const t = Math.min((performance.now() - start) / duration, 1);
      this.lon = THREE.MathUtils.lerp(startLon, target.yaw, t);
      this.lat = THREE.MathUtils.lerp(startLat, target.pitch, t);
      if (t < 1) requestAnimationFrame(anim); else { this.isAutoLook = false; onDone?.(); }
    }; anim();
  }

  playZocalo() {
    const st = this.stages[this.current];
    const zocaloVideo = document.getElementById('zocaloVideo');


    if (zocaloVideo && st.zocalo) {
      // Primero ocultar el zócalo
      zocaloVideo.style.opacity = '0';

      // Remove any previous event listeners to avoid duplicates
      zocaloVideo.onended = null;
      zocaloVideo.ontimeupdate = null;
      zocaloVideo.onloadedmetadata = null;

      zocaloVideo.src = getVideoSource(st.zocalo);
      zocaloVideo.currentTime = 0;

      // 👇 Configurar playbackRate DESPUÉS de que se carguen los metadatos
      zocaloVideo.onloadedmetadata = function () {
        this.playbackRate = 1.4; // 👈 Velocidad de reproducción 1.7x

      };

      zocaloVideo.load();

      // Play video
      zocaloVideo.play()
        .catch(e => console.warn('❌ Zócalo video autoplay prevented:', e));

      // Mostrar el zócalo con fade in después de un breve delay
      setTimeout(() => {
        zocaloVideo.style.transition = 'opacity 0.5s ease-in';
        zocaloVideo.style.opacity = '1';

      }, 100);

      // Pause at second 3 before reaching the end (ajustado por velocidad 1.7x)
      zocaloVideo.ontimeupdate = function () {
        if (this.currentTime >= 3 && !this.paused) {
          this.currentTime = 3;
          this.pause();

        }
      };
    } else {
      console.warn('⚠️ No se puede reproducir zócalo:', {
        elementoExiste: !!zocaloVideo,
        rutaZocalo: st?.zocalo
      });
    }
  }

  playTransition(onEnded) {
    // 👉 detener HUD overlay
    this.stopHUDVideo();
    const st = this.stages[this.current];
    if (!st || !st.transition) { onEnded?.(); return; }

    // Usamos la UI para overlay full-screen y sin controles
    import('../core/UI.js').then(({ UI }) => {
      UI.showVideo({
        src: st.transition,
        controls: false,   // sin botones
        muted: false,      // poné true si querés forzar sin sonido
        onended: () => { onEnded?.(); }
      });
    });

    // Recompensa (inventario) al iniciar la transición
    if (st.reward) { State.addItem(st.reward); }
  }

  playRoundCompletionVideo() {
    return new Promise((resolve) => {


      // 👇 NO mostrar video de la carpa, ir directo al menú principal
      location.hash = '#menu';

      resolve();
    });
  }

  nextStage(options = {}) {
    // 👇 Advance stage in SpeciesManager
    const hasMoreStages = this.speciesManager.advanceStage();

    if (!hasMoreStages) {
      // Completed round, advance to next round
      const progressBefore = this.speciesManager.getProgress();

      const hasMoreRounds = this.speciesManager.advanceRound();

      const progressAfter = this.speciesManager.getProgress();

      if (!hasMoreRounds) {
        // TODO: Handle game completion
      }

      // 🎬 Play carpa_flota video when completing a round
      // El video se encargará de navegar al laboratorio
      // La próxima vez que se vuelva al recorrido, ya estará en el round 2
      return this.playRoundCompletionVideo();
    }

    // Continue to next stage in current round: preload and stay in RecorridoScene
    const nextIndex = (this.current + 1) % 6;
    return this.loadStage(nextIndex, options);
  }

  // Waits until all textures in a scene graph have their image data ready
  async waitForTexturesReady(root) {
    if (!root) return;

    const textures = [];
    root.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        if (!mat) return;
        ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'envMap'].forEach((key) => {
          const tex = mat[key];
          if (tex && tex.isTexture && !textures.includes(tex)) {
            textures.push(tex);
          }
        });
      });
    });

    if (!textures.length) return;

    const waiters = textures.map((tex) => new Promise((resolve) => {
      const img = tex.image;
      if (!img) return resolve();

      // Image element
      if (img instanceof HTMLImageElement) {
        if (img.complete && img.naturalWidth > 0) return resolve();
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
        return;
      }

      // Video element
      if (img instanceof HTMLVideoElement) {
        if (img.readyState >= 2) return resolve();
        img.addEventListener('loadeddata', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
        return;
      }

      // Canvas / ImageBitmap / others assumed ready
      resolve();
    }));

    await Promise.all(waiters);

    // Give a couple of frames for GPU upload
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  }

  update(dt) {
    // 👇 Update cursor and radar animations
    if (this.cursorRadar) {
      this.cursorRadar.update();
    }

    if (!this.isAutoLook) {
      const { deadzone, maxSpeed, damping } = this.config;

      // Input source: touch joystick takes precedence over mouse NDC
      let inputX = this.mouseNDC.x;
      let inputY = this.mouseNDC.y;

      if (this.touchActive) {
        const dx = this.touchCurrent.x - this.touchStart.x;
        const dy = this.touchCurrent.y - this.touchStart.y;
        const max = this.touchMaxDistance || 200;
        inputX = THREE.MathUtils.clamp((dx / max) * this.touchSensitivity, -1, 1);
        // Invert vertical touch drag so dragging up/down feels natural
        // (user requested inverted vertical control for touch-drag)
        inputY = THREE.MathUtils.clamp((-dy / max) * this.touchSensitivity, -1, 1);
      }

      const ax = this.axis(inputX, deadzone);
      const ay = this.axis(inputY, deadzone);
      const vx = ax * maxSpeed.yaw;
      const vy = this.cameraLocked ? 0 : ay * maxSpeed.pitch; // 👈 Bloquea movimiento vertical si cameraLocked
      this.velLon += (vx - this.velLon) * damping;
      this.velLat += (vy - this.velLat) * damping;
      this.lon += this.velLon * dt;
      this.lat += this.velLat * dt;
      this.lat = Math.max(-85, Math.min(85, this.lat));

      // 👇 Mantener lat en 0 si la cámara está bloqueada
      if (this.cameraLocked) {
        this.lat = 0;
        this.velLat = 0;
      }
    } else {
      // relajar
      this.velLon += (0 - this.velLon) * this.config.damping;
      this.velLat += (0 - this.velLat) * this.config.damping;
    }

    const phi = THREE.MathUtils.degToRad(90 - this.lat);
    const theta = THREE.MathUtils.degToRad(this.lon);
    this.camera.lookAt(
      500 * Math.sin(phi) * Math.cos(theta),
      500 * Math.cos(phi),
      500 * Math.sin(phi) * Math.sin(theta)
    );

    // 👇 Actualiza el tiempo para shaders registrados sin recorrer todo el modelo
    if (this.shaderMaterials?.size) {
      const time = performance.now() * 0.001;
      for (const mat of this.shaderMaterials) {
        const shader = mat?.userData?.shader;
        if (shader?.uniforms?.uTime) {
          shader.uniforms.uTime.value = time;
        }
      }
    }

    if (this.noiseOverlay && this.noiseOverlay.material.uniforms) {
      this.noiseOverlay.material.uniforms.uTime.value = performance.now() * 0.001;
    }

    // Update animation mixers - TODAS las flechas
    if (this.flechaAnimationMixers && this.flechaAnimationMixers.length > 0) {
      this.flechaAnimationMixers.forEach(mixer => {
        if (mixer && typeof mixer.update === 'function') {
          mixer.update(dt);
        }
      });
    }

    // 🐟 Update carpa animation mixer
    if (this.carpaAnimationMixer) {
      this.carpaAnimationMixer.update(dt);
    }

    if (this.stageAnimationMixer) {
      this.stageAnimationMixer.update(dt);
    }

    if (this.butterflyMixer) {
      this.butterflyMixer.update(dt);
    }

    this.updateButterflyOrbit(dt);

    // Update zoom
    this.updateZoom(dt);

    // Update lens flare light to follow the Sun object
    if (this.sunLight && this.sunObject) {
      this.sunLight.position.copy(this.sunObject.getWorldPosition(new THREE.Vector3()));
      if (!this._flareDebug.frameLogged) {
        const lightPos = this.sunLight.position.toArray();
        const camPos = this.camera.position.toArray();
        console.debug('[RecorridoScene] Lens flare update tick', {
          lightPos,
          camPos,
          distance: this.sunLight.position.distanceTo(this.camera.position)
        });
        this._flareDebug.frameLogged = true;
      }
    }

    // Update map rotation to match camera yaw
    this.updateMapRotation();

    // 🔊 Update spatial audio volume based on distance to glitch object
    this.updateSpatialAudio();

    this.updateInventoryCanvas();

    // 🐟 Update carpa3d hover and rotation
    this.updateCarpa3DHover(dt);

    // 🎨 Update post-processing
    if (this.gamerLUTPass) {
      // Enable/disable GamerLUTPass based on useGamerLUT flag
      this.gamerLUTPass.enabled = this.useGamerLUT;
      this.gamerLUTPass.update(dt);
    }

    this.updateGlitchFlash();

    // 🖼️ Canvas bridge: draw glitch video to canvas so Safari WebGL gets alpha
    // Uses try/catch instead of readyState check: drawImage throws InvalidStateError
    // if video has no data yet, which we suppress. Once video has frames, it draws fine.
    if (this._glitchCanvas && this._glitchCanvasCtx && this.videoElement && this.currentVideoTexture) {
      try {
        const ctx = this._glitchCanvasCtx;
        ctx.clearRect(0, 0, this._glitchCanvas.width, this._glitchCanvas.height);
        ctx.drawImage(this.videoElement, 0, 0, this._glitchCanvas.width, this._glitchCanvas.height);
        this.currentVideoTexture.needsUpdate = true;
      } catch (e) { /* video not yet decodable — silently wait */ }
    }

    // 🎯 Update camera debug overlay
    this.updateCameraDebugOverlay();
  }

  updateCameraDebugOverlay() {
    if (!this.cameraDebugOverlay) return;

    // Get camera direction vector
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);

    // Calculate pitch (elevation angle)
    const pitch = Math.asin(direction.y) * (180 / Math.PI);

    // Calculate yaw (azimuth angle)
    const yaw = Math.atan2(direction.x, direction.z) * (180 / Math.PI);

    // Update overlay content
    this.cameraDebugOverlay.innerHTML = `
      <div><strong>CAMERA DEBUG</strong></div>
      <div>Pitch: ${pitch.toFixed(2)}°</div>
      <div>Yaw: ${yaw.toFixed(2)}°</div>
      <div>Lat: ${this.lat.toFixed(2)}°</div>
      <div>Lon: ${this.lon.toFixed(2)}°</div>
      <div>FOV: ${this.camera.fov.toFixed(2)}°</div>
    `;
  }

  render(renderer, dt) {
    if (!this.isLUTReady) {
      const prevColor = renderer.getClearColor(this._tempClearColor);
      const prevAlpha = renderer.getClearAlpha();
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
      renderer.setClearColor(prevColor.getHex(), prevAlpha);
      return;
    }

    // Siempre usar composer si está disponible (incluye DiscoveryFilterPass)
    if (this.composer) {
      this.composer.render();
    } else {
      // Render normal (fallback solo si no hay composer)
      console.warn('[RecorridoScene] Composer not available, using direct render');
      renderer.render(this.scene, this.camera);
    }

    // Overlay scene (HUD, etc) - siempre renderiza después
    if (this.overlayScene && this.overlayCam) {
      renderer.clearDepth();
      renderer.render(this.overlayScene, this.overlayCam);
    }
  }

  updateZoom(dt) {
    // Initialize targetFOV if not set
    if (this.zoom.targetFOV === undefined) {
      this.zoom.targetFOV = this.zoom.baseFOV;
    }

    // Smoothly interpolate towards target FOV with dampening
    const lerpFactor = dt * this.zoom.lerpSpeed * this.zoom.dampening;
    this.zoom.currentFOV = THREE.MathUtils.lerp(this.zoom.currentFOV, this.zoom.targetFOV, lerpFactor);

    // Update camera FOV if there's a significant change
    if (Math.abs(this.zoom.currentFOV - this.camera.fov) > 0.01) {
      this.camera.fov = this.zoom.currentFOV;
      this.camera.updateProjectionMatrix();
    }
  }

  updateMapRotation() {
    const mapImg = document.querySelector('.map-overlay__map');
    if (mapImg) {
      // Use negative lon to rotate map opposite to camera view direction
      mapImg.style.transform = `rotate(${-this.lon}deg)`;
    }
  }

  updateSpatialAudio() {
    // Only update if we have species audio and glitch object
    if (!this.gainNode || !this.stereoPanner || !this.glitchObject) return;

    // Get glitch object world position
    const glitchPos = this.glitchObject.getWorldPosition(new THREE.Vector3());

    // Get camera look direction and position
    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);
    const cameraPos = this.camera.position;

    // Calculate vector from camera to glitch
    const toGlitch = new THREE.Vector3().subVectors(glitchPos, cameraPos).normalize();

    // Calculate angle between camera direction and glitch direction
    const angleToGlitch = Math.acos(cameraDirection.dot(toGlitch)) * (180 / Math.PI);

    // Check if glitch is within field of view
    const { fovAngle, maxDistance, minVolume, maxVolume } = this.spatialAudioConfig;
    const isInView = angleToGlitch <= fovAngle;

    if (!isInView) {
      // Fade out audio when not in view
      this.gainNode.gain.value = 0;
      return;
    }

    // Calculate distance from camera focal point
    const focalPoint = cameraPos.clone().add(cameraDirection.multiplyScalar(500));
    const distance = glitchPos.distanceTo(focalPoint);

    // Calculate volume based on distance (inverse relationship)
    const normalizedDistance = Math.min(distance / maxDistance, 1.0);
    const volume = THREE.MathUtils.lerp(maxVolume, minVolume, normalizedDistance);

    // Apply volume
    this.gainNode.gain.value = volume;

    // Calculate stereo panning based on horizontal angle
    // Use camera's right vector to determine left/right position
    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraDirection, this.camera.up).normalize();

    // Project glitch position onto camera's horizontal plane
    const horizontalOffset = toGlitch.dot(cameraRight);

    // Pan value ranges from -1 (left) to 1 (right)
    // Normalize by FOV angle to make panning more pronounced within the view
    const panValue = THREE.MathUtils.clamp(horizontalOffset * 2, -1, 1);
    this.stereoPanner.pan.value = panValue;
  }

  // 🐟 Simple noise function for smooth random movement
  simpleNoise(x) {
    // Simple smooth noise using sine waves with different frequencies
    return Math.sin(x * 1.3) * 0.5 +
      Math.sin(x * 2.7) * 0.25 +
      Math.sin(x * 5.1) * 0.125;
  }

  updateCarpa3DHover(dt) {
    if (!this.carpa3dObject || !this.carpa3dHover.enabled) return;

    // Update hover animation (up and down movement)
    this.carpa3dHover.time += dt * this.carpa3dHover.frequency;
    const hoverOffset = Math.sin(this.carpa3dHover.time) * this.carpa3dHover.amplitude;
    this.carpa3dObject.position.y = this.carpa3dHover.baseY + hoverOffset;

    // Update rotation with smooth noise (very subtle)
    if (this.carpa3dRotation.enabled) {
      const time = performance.now() * 0.001 * this.carpa3dRotation.speed;

      // Generate smooth noise for each axis
      const noiseX = this.simpleNoise(time + this.carpa3dRotation.noiseOffsetX);
      const noiseY = this.simpleNoise(time + this.carpa3dRotation.noiseOffsetY);
      const noiseZ = this.simpleNoise(time + this.carpa3dRotation.noiseOffsetZ);

      // Apply subtle rotation
      this.carpa3dObject.rotation.x = noiseX * this.carpa3dRotation.amplitude;
      this.carpa3dObject.rotation.y = noiseY * this.carpa3dRotation.amplitude;
      this.carpa3dObject.rotation.z = noiseZ * this.carpa3dRotation.amplitude;
    }
  }

  axis(a, deadzone) {
    if (Math.abs(a) <= deadzone) return 0;
    const t = (Math.abs(a) - deadzone) / (1 - deadzone);
    const s = Math.min(Math.max(t, 0), 1); const smooth = s * s * (3 - 2 * s);
    return Math.sign(a) * smooth;
  }



  updateInventoryCanvas() {
    if (!this.inventoryCtx || !this.inventoryImg) return;
    const ctx = this.inventoryCtx;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (this.inventoryImg.complete && this.inventoryImg.naturalWidth > 0) {
      // 👇 Use naturalWidth/naturalHeight to get actual image dimensions
      const w = this.inventoryImg.naturalWidth;
      const h = this.inventoryImg.naturalHeight;

      // Scale to fit canvas while maintaining aspect ratio
      const canvasWidth = ctx.canvas.width;
      const canvasHeight = ctx.canvas.height;

      // Calculate scale to fit width (with some margin)
      const maxWidth = canvasWidth * 0.9; // Use 90% of canvas width
      const scale = Math.min(1, maxWidth / w); // Don't upscale, only downscale

      const scaledW = w * scale;
      const scaledH = h * scale;

      // centrado en X, alineado abajo en Y
      const x = (canvasWidth - scaledW) / 2;
      const y = canvasHeight - scaledH - 20; // 20px margin from bottom

      ctx.drawImage(this.inventoryImg, x, y, scaledW, scaledH);
    }
  }

  setupNoiseOverlay() {
    const w = this.app.renderer.domElement.width;
    const h = this.app.renderer.domElement.height;

    // Quad de pantalla completa
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      uniforms: {
        uTime: { value: 0.0 },
        uOpacity: { value: 0.2 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uOpacity;

        // hash simple
        float rand(vec2 co){
          return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
        }

        void main(){
          float noise = rand(vUv * uTime * 200.0); // flickering rápido
          gl_FragColor = vec4(vec3(noise), noise * uOpacity);
        }
      `
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(w / 2, h / 2, 0); // centrar en cámara ortográfica
    this.overlayScene.add(mesh);

    this.noiseOverlay = mesh;
  }

  async createLensFlare() {
    if (!this.sunObject) return;

    const makeTexture = (radius, stops) => {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, radius);
      stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    };

    const mainTexture = makeTexture(256, [
      [0.0, 'rgba(255,255,255,0.85)'],
      [0.2, 'rgba(255,230,180,0.6)'],
      [0.6, 'rgba(255,160,60,0.25)'],
      [1.0, 'rgba(255,120,0,0)']
    ]);

    const streakTexture = makeTexture(256, [
      [0.0, 'rgba(255,255,255,0.6)'],
      [0.3, 'rgba(255,200,120,0.35)'],
      [1.0, 'rgba(255,120,0,0)']
    ]);

    this.lensflareTextures = [mainTexture, streakTexture];

    const sunWorld = this.sunObject.getWorldPosition(new THREE.Vector3());
    console.debug('[RecorridoScene] Creating lens flare at', sunWorld.toArray());

    this.sunLight = new THREE.PointLight(0xffffff, 1.6, 0);
    this.sunLight.castShadow = false;
    this.sunLight.position.copy(sunWorld);

    this.lensflare = new Lensflare();
    this.lensflare.addElement(new LensflareElement(mainTexture, 600, 0, new THREE.Color(0xffffff)));
    this.lensflare.addElement(new LensflareElement(streakTexture, 220, 0.35));
    this.lensflare.addElement(new LensflareElement(streakTexture, 120, 0.6));
    this.lensflare.addElement(new LensflareElement(streakTexture, 160, 1));

    this.sunLight.add(this.lensflare);
    this.scene.add(this.sunLight);

    this._flareDebug.created = true;
    this._flareDebug.frameLogged = false;
    console.debug('[RecorridoScene] Lens flare created', {
      intensity: this.sunLight.intensity,
      elementCount: Array.isArray(this.lensflare.lensFlares) ? this.lensflare.lensFlares.length : 'unknown'
    });
  }

  async spawnButterflyNearGlitch() {
    if (!this.stageModel || !this.glitchObject) return;

    try {
      const stageRef = this.stageModel;
      const glitchRef = this.glitchObject;
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync('/game-assets/recorrido/butter_flying.glb');
      if (stageRef !== this.stageModel || glitchRef !== this.glitchObject || !this.stageModel) {
        return;
      }
      const butterfly = gltf.scene || new THREE.Group();
      butterfly.name = 'butter_flying';

      butterfly.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;
          child.frustumCulled = false;
        }
      });

      butterfly.scale.setScalar(0.125);
      this.stageModel.add(butterfly);
      this.butterfly = butterfly;

      if (this.butterflyOrbit) {
        this.butterflyOrbit.angle = Math.random() * Math.PI * 2;
      }

      this.updateButterflyOrbit(0, true);

      if (gltf.animations?.length) {
        this.butterflyMixer = new THREE.AnimationMixer(butterfly);
        const clip = gltf.animations[0];
        this.butterflyAction = this.butterflyMixer.clipAction(clip);
        this.butterflyAction.setLoop(THREE.LoopRepeat);
        this.butterflyAction.clampWhenFinished = false;
        this.butterflyAction.play();
        this.butterflyAction.setEffectiveTimeScale(4);
      }

      console.debug('[RecorridoScene] Butterfly spawned', {
        position: butterfly.position.toArray(),
        hasAnimation: Boolean(this.butterflyAction)
      });
    } catch (error) {
      console.error('[RecorridoScene] Failed to load butterfly GLB', error);
    }
  }

  updateButterflyOrbit(dt = 0, snap = false) {
    if (!this.butterfly || !this.glitchObject || !this.stageModel || !this.butterflyOrbit) return;

    const orbit = this.butterflyOrbit;
    if (!snap) {
      orbit.angle = (orbit.angle + dt * orbit.speed) % (Math.PI * 2);
    } else {
      orbit.angle = orbit.angle % (Math.PI * 2);
    }

    if (orbit.wave) {
      orbit.wave.phase = (orbit.wave.phase + dt * orbit.wave.frequency) % (Math.PI * 2);
    }

    const stage = this.stageModel;
    stage.updateWorldMatrix(true, false);

    const centerWorld = this.glitchObject.getWorldPosition(_orbitCenter);

    const worldPos = _orbitPos.copy(centerWorld);
    worldPos.x += Math.cos(orbit.angle) * orbit.radius;
    worldPos.z += Math.sin(orbit.angle) * orbit.radius;
    let waveOffset = 0;
    if (orbit.wave) {
      waveOffset = Math.sin(orbit.wave.phase) * orbit.wave.amplitude;
    }

    worldPos.y += orbit.height + Math.sin(orbit.angle * 2) * orbit.verticalAmp + waveOffset;

    const localPos = _orbitHelper.copy(worldPos);
    stage.worldToLocal(localPos);
    this.butterfly.position.copy(localPos);

    const lookAhead = orbit.lookAhead ?? 0.25;
    const aheadAngle = orbit.angle + lookAhead;

    const aheadWorld = _orbitAhead.copy(centerWorld);
    aheadWorld.x += Math.cos(aheadAngle) * orbit.radius;
    aheadWorld.z += Math.sin(aheadAngle) * orbit.radius;
    const aheadWaveOffset = orbit.wave ? Math.sin(orbit.wave.phase + aheadAngle) * orbit.wave.amplitude : 0;
    aheadWorld.y += orbit.height + Math.sin(aheadAngle * 2) * orbit.verticalAmp + aheadWaveOffset;

    const lookTarget = _orbitLook.copy(aheadWorld);
    stage.worldToLocal(lookTarget);
    this.butterfly.lookAt(lookTarget);
  }

  // En lugar de un plano 3D, reproducimos el video como overlay DOM
  playDataOverlayVideo() {
    if (!this.currentSpecies) {
      console.error('[RecorridoScene] No current species to display');
      return;
    }

    // 👇 OPTIMIZACIÓN: Reutilizar audio en lugar de crear nuevo cada vez
    if (!this.metadataOverlayAudio) {
      this.metadataOverlayAudio = new Audio('/game-assets/recorrido/sonido/metadata_popup.mp3');
      this.metadataOverlayAudio.volume = 0.4;
    } else {
      this.metadataOverlayAudio.currentTime = 0;
    }
    this.metadataOverlayAudio.play().catch(e => console.error("Audio play failed:", e));

    // Reproducir voz en off de la especie
    if (this.currentSpeciesVO) {
      this.currentSpeciesVO.pause();
      this.currentSpeciesVO = null;
    }
    if (this._currentSpeciesVOTimer) {
      clearTimeout(this._currentSpeciesVOTimer);
      this._currentSpeciesVOTimer = null;
    }

    // Make sure only one voice is active
    this.stopRecorridoVoiceovers();

    const voPath = `/game-assets/recorrido/voiceovers/${this.currentSpecies.id}.mp3`;
    this.currentSpeciesVO = new Audio(voPath);
    this.currentSpeciesVO.volume = 1.0;
    // Delay voiceover playback by 3 seconds
    this._currentSpeciesVOTimer = setTimeout(() => {
      this._currentSpeciesVOTimer = null;
      if (this.currentSpeciesVO) {
        this.stopRecorridoVoiceovers(this.currentSpeciesVO);
        this.currentSpeciesVO.play().catch(e => console.warn('Species VO play failed', e));
      }
    }, 3000);

    import('../core/UI.js').then(({ UI }) => {
      const videoEl = document.getElementById('speciesDataVideo');
      const videoOverlay = document.getElementById('videoOverlay');

      const dataVideoSrc = getVideoSource(this.currentSpecies.assets.dataVideo, {
        fallback: this.currentSpecies.assets.dataVideoFallback || null
      });

      // 👇 OPTIMIZACIÓN: Usar directamente el video precargado sin crear nuevo src
      if (this.preloadedDataVideo && this.preloadedDataVideo.readyState >= 2) {
        // Si el video precargado está listo, transferir su src (ya está en cache del browser)
        videoEl.src = this.preloadedDataVideo.src;
      } else if (this.preloadedDataVideo) {
        // Video existe pero no está listo, usar de todas formas
        videoEl.src = this.preloadedDataVideo.src;
      } else {
        // Fallback: cargar ahora (no debería pasar si la precarga funciona)
        videoEl.src = dataVideoSrc || this.currentSpecies.assets.dataVideo;
      }

      videoEl.controls = false;
      videoEl.muted = false;
      videoEl.playsInline = true;
      videoEl.playbackRate = this.currentSpecies.dataVideoSpeed || 0.5;
      // Show only the efedra wrapper (video + text) instead of the whole #videoOverlay
      // Prefer attaching/reading the efedra-wrapper from a top-level overlay root
      // so it no longer depends on #videoOverlay being visible.
      const parent = this.overlayRoot || document.body;
      const efedraWrapper = (parent && parent.querySelector) ? parent.querySelector('.efedra-wrapper') : document.querySelector('.efedra-wrapper');

      if (efedraWrapper) {
        // Make sure the wrapper itself is visible and interactive.
        try { efedraWrapper.style.display = 'block'; } catch (e) {}
        try { efedraWrapper.style.pointerEvents = 'auto'; } catch (e) {}
        try { videoEl.style.pointerEvents = 'auto'; } catch (e) {}
      }

      // 🔄 Loop from second 3 when video ends
      videoEl.onended = () => {
        videoEl.currentTime = 3; // Jump to second 3
        videoEl.play().catch(e => console.error("Video loop failed:", e));
      };

      // Play when ready (reuse existing tryPlayVideo logic)
      const tryPlayVideo = () => {
        if (videoEl.readyState >= 3) {
          videoEl.play().catch(e => {
            console.error("Video autoplay failed:", e);
            requestAnimationFrame(() => {
              videoEl.play().catch(err => {
                console.error("Video play retry failed:", err);
                videoEl.controls = true;
              });
            });
          });
        } else {
          setTimeout(tryPlayVideo, 100);
        }
      };

      if (videoEl.readyState >= 3) tryPlayVideo(); else videoEl.addEventListener('canplay', tryPlayVideo, { once: true });

      // Click handler to close only the efedra wrapper when clicking on transparent pixels
      // 👇 Deshabilitar cierre por 4 segundos para permitir que el video se reproduzca
      let canClose = false;
      setTimeout(() => { canClose = true; }, 4000);
      
      const handleEfedraClick = (e) => {
        // If click was on a transparent pixel of the species video, close efedra UI
        if (canClose && this.isVideoPixelTransparent(videoEl, e)) {
          // Detener voz en off si está reproduciéndose
          if (this.currentSpeciesVO) {
            this.currentSpeciesVO.pause();
            this.currentSpeciesVO = null;
          }
          if (this._currentSpeciesVOTimer) {
            clearTimeout(this._currentSpeciesVOTimer);
            this._currentSpeciesVOTimer = null;
          }

          if (this.metadataOverlayAudio) {
            this.metadataOverlayAudio.pause();
            this.metadataOverlayAudio.currentTime = 0;
            this.metadataOverlayAudio = null;
          }

          if (!this.metadataCloseAudio) {
            this.metadataCloseAudio = new Audio('/game-assets/recorrido/sonido/metadata_cierre.mp3');
            this.metadataCloseAudio.volume = 0.5;
          } else {
            this.metadataCloseAudio.pause();
            this.metadataCloseAudio.currentTime = 0;
          }
          this.metadataCloseAudio.play().catch(e => console.error("Audio play failed:", e));

          // Close efedra widgets only (don't touch full video overlay or transition state)
          this.removeTextOverlay();

          // 👇 Actualizar panel AQUÍ cuando el usuario cierra el overlay
          requestAnimationFrame(() => {
            if (this.inventoryImg) {
              this.inventoryImg.src = this.speciesManager.getPanelPath();
            }
            if (this.inventoryImgEl) {
              this.inventoryImgEl.src = this.speciesManager.getPanelPath();
            }
          });

          // Hide efedra wrapper and stop species video
          try { if (efedraWrapper) { efedraWrapper.style.pointerEvents = 'none'; efedraWrapper.style.display = 'none'; } } catch (err) {}
          try { videoEl.pause(); videoEl.currentTime = 0; videoEl.src = ''; } catch (err) {}

          // Restore flechas and reset click flag
          this.flechaClicked = false;
          if (this.flechaObject) this.flechaObject.visible = true;
          if (this.flechaObjects && this.flechaObjects.length > 0) {
            this.flechaObjects.forEach((flechaObj, index) => {
              flechaObj.visible = true;
              const action = this.flechaAnimationActions[index];
              if (action) {
                action.reset();
                const reverseIndex = (this.flechaObjects.length - 1) - index;
                const frameOffset = reverseIndex * 2;
                action.time = frameOffset / 30;
                action.play();
              }
            });
          }

          // Remove listener
          if (efedraWrapper) efedraWrapper.removeEventListener('click', handleEfedraClick);
        }
      };

      if (efedraWrapper) efedraWrapper.addEventListener('click', handleEfedraClick);

      // Add text overlay inside the efedra wrapper
      this.addTextOverlay();
    });
  }

  addTextOverlay() {
    // Use the existing overlay element (styles moved to game/index.html CSS)
    const parent = this.overlayRoot || document.body;
    let textOverlay = document.getElementById('efedra-text-overlay');
    // Prefer placing the overlay inside the videoOverlay if present.
    const videoOverlayEl = document.getElementById('videoOverlay');

    if (!textOverlay) {
      // ensureEfedraOverlayAssets will create the element if missing
      textOverlay = ensureEfedraOverlayAssets();

      // Try to find an existing wrapper under the preferred parent first,
      // then fallback to document. If none exists, create it under `parent`.
      let wrapper = (parent && parent.querySelector) ? parent.querySelector('.efedra-wrapper') : null;
      if (!wrapper) wrapper = document.querySelector('.efedra-wrapper');
      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'efedra-wrapper';
        wrapper.setAttribute('aria-hidden', 'false');
        parent.appendChild(wrapper);
      }

      wrapper.appendChild(textOverlay);
    }

    // Reset content and make sure overlay is visible
    textOverlay.style.display = 'block';
    textOverlay.innerHTML = '';

    const textContent = document.createElement('div');
    textContent.style.minHeight = '100%';

    // 📝 Estilos para formateo HTML (párrafos y negritas)
    textContent.style.cssText = `
      min-height: 100%;
    `;

    // Agregar estilos globales para <p> y <strong> dentro del overlay
    const styleId = 'species-text-formatting';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #efedra-text-overlay p {
          margin: 0 0 0.8em 0;
          line-height: 1.5;
        }
        #efedra-text-overlay p:last-child {
          margin-bottom: 0;
        }
        #efedra-text-overlay strong {
          font-weight: 700;
          color: #D9DC77;
        }
      `;
      document.head.appendChild(style);
    }

    textOverlay.appendChild(textContent);
    // Ensure the overlay lives inside the efedra wrapper (now attached to `parent`)
    const wrapperAfter = (parent && parent.querySelector) ? parent.querySelector('.efedra-wrapper') : document.querySelector('.efedra-wrapper');
    const appendTarget = wrapperAfter || parent;
    if (textOverlay.parentNode !== appendTarget) {
      appendTarget.appendChild(textOverlay);
    }

    // --- Responsive font scaling based on wrapper height ---
    // Baseline: speciesMaxPx is font size at 1080px wrapper height
    const baselinePx = EFEDRA_OVERLAY_THEME.fonts?.speciesMaxPx || 20;

    const updateEfedraFontSize = () => {
      try {
        const currentWrapper = (parent && parent.querySelector) ? parent.querySelector('.efedra-wrapper') : document.querySelector('.efedra-wrapper');
        if (!currentWrapper || !textOverlay) return;
        const h = currentWrapper.clientHeight || currentWrapper.offsetHeight || window.innerHeight;
        // Scale linearly: font = baselinePx * (wrapperHeight / 1080)
        const newFont = Math.max(10, Math.round(baselinePx * (h / 1080)));
        textOverlay.style.fontSize = newFont + 'px';
      } catch (e) {
        // ignore
      }
    };

    // Use ResizeObserver when available to react to wrapper size changes
    if (typeof ResizeObserver !== 'undefined') {
      if (this._efedraResizeObserver) this._efedraResizeObserver.disconnect();
      this._efedraResizeObserver = new ResizeObserver(updateEfedraFontSize);
      const observedWrapper = (parent && parent.querySelector) ? parent.querySelector('.efedra-wrapper') : document.querySelector('.efedra-wrapper');
      if (observedWrapper) this._efedraResizeObserver.observe(observedWrapper);
    } else {
      // Fallback: update on window resize
      window.addEventListener('resize', updateEfedraFontSize);
      this._efedraFallbackResize = updateEfedraFontSize;
    }

    // Initial update (and again next frame to catch layout)
    updateEfedraFontSize();
    requestAnimationFrame(updateEfedraFontSize);

    // 👇 Use dynamic species text
    const fullText = this.currentSpecies?.text || "Texto no disponible";

    // Dejar vacío al abrir: el texto se muestra con delay (typewriter)
    // para que no aparezca instantáneamente al click.

    // Caracteres para el efecto glitch
    const glitchChars = "!@#$%^&*()_+-=[]{}|;':\",./<>?~`abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    // Función para obtener un caracter glitch aleatorio
    const getRandomGlitchChar = () => glitchChars[Math.floor(Math.random() * glitchChars.length)];

    // Función para extraer texto plano del HTML preservando estructura
    const getPlainTextLength = (html) => {
      const temp = document.createElement('div');
      temp.innerHTML = html;
      return temp.textContent.length;
    };

    // Función para reconstruir HTML hasta cierto número de caracteres
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

    // Voz en off: mantener delay, pero el texto se muestra ya
    if (this._speciesVoiceoverTimer) {
      clearTimeout(this._speciesVoiceoverTimer);
      this._speciesVoiceoverTimer = null;
    }
    this._speciesVoiceoverTimer = setTimeout(() => {
      this._speciesVoiceoverTimer = null;
      if (this.speciesVoiceover) {
        this.speciesVoiceover.pause();
        this.speciesVoiceover = null;
      }
      if (this.currentSpecies) {
        const voiceoverPath = `assets/audio/recorrido/${this.currentSpecies.id}.mp3`;
        this.speciesVoiceover = new Audio(voiceoverPath);
        this.speciesVoiceover.volume = 1.0;
        this.stopRecorridoVoiceovers(this.speciesVoiceover);
        this.speciesVoiceover.play().catch(e => console.warn("Voiceover play failed", e));
      }
    }, 3000);

    // Typewriter/glitch: esperar un poco antes de iniciar (para que no cargue "de golpe")
    try {
      const TYPEWRITER_START_DELAY_MS = 2000;
      const TYPEWRITER_STEP_MS = 12;
      const totalChars = getPlainTextLength(fullText);
      let currentIndex = 0;

      // Clear text so the effect is visible, but only after a short delay
      textContent.innerHTML = '';

      const startTypewriter = () => {
        const typewriterInterval = setInterval(() => {
          try {
            if (currentIndex <= totalChars) {
              let displayText = getPartialHTML(fullText, currentIndex);
              const glitchCount = Math.min(3, totalChars - currentIndex);
              for (let i = 0; i < glitchCount; i++) {
                displayText += `<span style="opacity: 0.6; animation: glitch-flicker 0.1s infinite;">${getRandomGlitchChar()}</span>`;
              }
              textContent.innerHTML = displayText;
              currentIndex++;
            } else {
              textContent.innerHTML = fullText;
              clearInterval(typewriterInterval);
              if (textOverlay) textOverlay._typewriterInterval = null;
            }
          } catch (e) {
            // If partial HTML reconstruction fails, show the full text and stop
            try { textContent.innerHTML = fullText; } catch (e2) { textContent.textContent = String(fullText); }
            clearInterval(typewriterInterval);
            if (textOverlay) textOverlay._typewriterInterval = null;
          }
        }, TYPEWRITER_STEP_MS);

        // Store for cleanup on close
        textOverlay._typewriterInterval = typewriterInterval;
      };

      // Delay the start by 2s
      textOverlay._typewriterTimer = setTimeout(() => {
        textOverlay._typewriterTimer = null;
        startTypewriter();
      }, TYPEWRITER_START_DELAY_MS);
    } catch (e) {
      // Worst-case fallback: keep full text visible
      try { textContent.innerHTML = fullText; } catch (e2) { textContent.textContent = String(fullText); }
    }

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

    // Agregar listener para cualquier tecla para cerrar el overlay
    const handleKeyPress = () => {
      if (this.metadataOverlayAudio) {
        this.metadataOverlayAudio.pause();
        this.metadataOverlayAudio.currentTime = 0;
        this.metadataOverlayAudio = null;
      }

      if (!this.metadataCloseAudio) {
        this.metadataCloseAudio = new Audio('/game-assets/recorrido/sonido/metadata_cierre.mp3');
        this.metadataCloseAudio.volume = 0.5;
      } else {
        this.metadataCloseAudio.pause();
        this.metadataCloseAudio.currentTime = 0;
      }

      this.metadataCloseAudio.play().catch(e => console.error("Audio play failed:", e));

      // Remove text overlay and hide efedra wrapper + stop species video
      this.removeTextOverlay();
      try {
        const parent = this.overlayRoot || document.body;
        const efedraWrapper = (parent && parent.querySelector) ? parent.querySelector('.efedra-wrapper') : document.querySelector('.efedra-wrapper');
        const speciesVideo = document.getElementById('speciesDataVideo');
        if (efedraWrapper) {
          efedraWrapper.style.pointerEvents = 'none';
          efedraWrapper.style.display = 'none';
        }
        if (speciesVideo) {
          try { speciesVideo.pause(); } catch {};
          try { speciesVideo.currentTime = 0; } catch {};
          try { speciesVideo.src = ''; } catch {};
        }
      } catch (err) { }

      // Mostrar TODAS las flechas después de cerrar el overlay y resetear flag
      this.flechaClicked = false;
      if (this.flechaObject) {
        this.flechaObject.visible = true;
      }
      if (this.flechaObjects && this.flechaObjects.length > 0) {
        this.flechaObjects.forEach((flechaObj, index) => {
          flechaObj.visible = true;

          // Start flecha animation if available
          const action = this.flechaAnimationActions[index];
          if (action) {
            action.reset();
            const reverseIndex = (this.flechaObjects.length - 1) - index;
            const frameOffset = reverseIndex * 2;
            const timeOffset = frameOffset / 30;
            action.time = timeOffset;
            action.play();
          } else if (this.gltfAnimations?.length) {
            console.info(`Flecha ${index} visible but no compatible animation clip was matched.`);
          }
        });
      }
      // Remover el listener
      document.removeEventListener('keydown', handleKeyPress);
    };

    document.addEventListener('keydown', handleKeyPress);

    // Guardar referencia al listener para limpieza
    textOverlay._keyPressHandler = handleKeyPress;

 

  }

  removeTextOverlay() {
    const textOverlay = document.getElementById('efedra-text-overlay');
    if (textOverlay) {
      if (textOverlay._typewriterTimer) {
        try { clearTimeout(textOverlay._typewriterTimer); } catch (e) { /* ignore */ }
        textOverlay._typewriterTimer = null;
      }
      if (textOverlay._typewriterInterval) {
        try { clearInterval(textOverlay._typewriterInterval); } catch (e) { /* ignore */ }
        textOverlay._typewriterInterval = null;
      }
      if (this.metadataOverlayAudio) {
        this.metadataOverlayAudio.pause();
        this.metadataOverlayAudio.currentTime = 0;
        this.metadataOverlayAudio = null;
      }

      if (this.speciesVoiceover) {
        this.speciesVoiceover.pause();
        this.speciesVoiceover = null;
      }

      if (textOverlay._keyPressHandler) {
        document.removeEventListener('keydown', textOverlay._keyPressHandler);
      }
      textOverlay.remove();
    }
    // Also hide efedra wrapper and stop species video. If there are no other
    // visible/playing videos inside #videoOverlay, hide that container too
    try {
      const videoOverlayEl = document.getElementById('videoOverlay');
      const efedraWrapper = (videoOverlayEl && videoOverlayEl.querySelector) ? videoOverlayEl.querySelector('.efedra-wrapper') : document.querySelector('.efedra-wrapper');
      if (efedraWrapper) {
        efedraWrapper.style.pointerEvents = 'none';
        efedraWrapper.style.display = 'none';
      }

      const speciesVideo = document.getElementById('speciesDataVideo');
      if (speciesVideo) {
        try { speciesVideo.pause(); } catch {}
        try { speciesVideo.currentTime = 0; } catch {}
        try { speciesVideo.src = ''; } catch {}
      }

      // Decide whether to hide the parent overlay. Keep it visible when any
      // other video element inside is currently playing or visible (e.g. transition).
      if (videoOverlayEl) {
        // Restore any sibling videos we hid when opening efedra
        if (this._efedraHiddenVideos && Array.isArray(this._efedraHiddenVideos)) {
          for (const item of this._efedraHiddenVideos) {
            try {
              if (item && item.el) {
                item.el.style.display = item.prevDisplay || '';
              }
            } catch (e) { }
          }
          this._efedraHiddenVideos = null;
        }

        const otherVideos = Array.from(videoOverlayEl.querySelectorAll('video'))
          .filter(v => v.id !== 'speciesDataVideo');

        let anyPlaying = false;
        for (const v of otherVideos) {
          try {
            if ((!v.paused && v.currentTime > 0) || (v.style && v.style.display && v.style.display !== 'none')) {
              anyPlaying = true;
              break;
            }
          } catch (e) { }
        }

        if (!anyPlaying) {
          try { videoOverlayEl.style.display = 'none'; } catch (e) { }
        }
      }
    } catch (e) { }
  }

  // Crea un overlay DOM con un flash "glitch" de hasta 0.5s usando la paleta dada
  triggerGlitchFlash() {
    // En modo liviano o cuando el usuario pide menos movimiento, usar overlay simple
    if (this.glitchFlashLeanMode || this.prefersReducedMotion) {
      this.triggerLeanGlitchFlash();
      return;
    }

    try {
      // 👇 OPTIMIZACIÓN: Reutilizar elementos existentes en lugar de crear nuevos
      if (this._glitchFlashEl) {
        // Si ya existe, solo reiniciar animación
        this._glitchFlashEl.style.animation = 'none';
        // Force reflow para reiniciar animación
        void this._glitchFlashEl.offsetWidth;
        this._glitchFlashEl.style.animation = 'dg-glitch-flash-move 0.5s ease-out forwards';
        return;
      }

      // 👇 Crear style solo una vez y dejarlo en el DOM (es lightweight)
      if (!this._glitchFlashStyle) {
        const style = document.createElement('style');
        style.textContent = `
          @keyframes dg-glitch-flash-move {
            0%   { opacity: 0; transform: translate3d(0,0,0) skewX(0deg); background-position: 0% 0%; }
            10%  { opacity: 1; transform: translate3d(-2px,1px,0) skewX(2deg); background-position: 100% 0%; }
            25%  { transform: translate3d(2px,-1px,0) skewX(-2deg); }
            45%  { background-position: 0% 100%; }
            70%  { transform: translate3d(-1px,0,0) skewX(1deg); }
            100% { opacity: 0; transform: translate3d(0,0,0) skewX(0deg); background-position: 100% 100%; }
          }
        `;
        document.head.appendChild(style);
        this._glitchFlashStyle = style;
      }

      const el = document.createElement('div');
      // 👇 Usar cssText para asignación en bloque (más rápido que propiedades individuales)
      el.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 10000;
        opacity: 0;
        background-image: repeating-linear-gradient(to bottom, #D9DC77 0%, #D9DC77 8%, #DBB28D 8%, #DBB28D 16%, #E4CF9D 16%, #E4CF9D 24%, #1F1F1F 24%, #1F1F1F 32%, #314B56 32%, #314B56 40%, #171930 40%, #171930 48%, #D9DC77 48%, #D9DC77 56%),
                          repeating-linear-gradient(to right, rgba(255,255,255,0.06) 0 2px, transparent 2px 4px);
        background-blend-mode: overlay, normal;
        background-size: 200% 200%, auto;
        animation: dg-glitch-flash-move 0.5s ease-out forwards;
        will-change: transform, opacity;
      `;

      document.body.appendChild(el);
      this._glitchFlashEl = el;

      // 👇 Limpiar después de animación pero mantener el style en DOM
      setTimeout(() => {
        try {
          if (this._glitchFlashEl === el) {
            el.remove();
            this._glitchFlashEl = null;
          }
        } catch { }
      }, 500);
    } catch { }
  }

  // Variante liviana: fade blanco breve sin bandas (menos pintura de toda la pantalla)
  triggerLeanGlitchFlash() {
    try {
      if (!this._glitchFlashLeanStyle) {
        const style = document.createElement('style');
        style.textContent = `
          .dg-glitch-flash-lean {
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 10000;
            background: linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.08) 100%);
            mix-blend-mode: screen;
            opacity: 0;
          }
        `;
        document.head.appendChild(style);
        this._glitchFlashLeanStyle = style;
      }

      const el = document.createElement('div');
      el.className = 'dg-glitch-flash-lean';
      document.body.appendChild(el);
      this._glitchFlashEl = el;

      const anim = el.animate([
        { opacity: 0 },
        { opacity: 0.32 },
        { opacity: 0 }
      ], {
        duration: 200,
        easing: 'ease-out'
      });

      anim.onfinish = () => {
        try {
          el.remove();
          if (this._glitchFlashEl === el) {
            this._glitchFlashEl = null;
          }
        } catch { }
      };
    } catch { }
  }

  // Flash blanco en el rastro cuando se hace click
  triggerRastroAlphaFlash(speciesId) {
    if (!this.stageModel) return;

    // Buscar el mesh rastro de esta especie
    let rastroMesh = null;
    this.stageModel.traverse(child => {
      if (child.isMesh && child.name === `${speciesId}_rastro`) {
        rastroMesh = child;
      }
    });

    if (!rastroMesh || !rastroMesh.material) return;



    // Guardar propiedades originales del material
    const originalMaterial = rastroMesh.material;
    const originalColor = originalMaterial.color.clone();
    const originalOpacity = originalMaterial.opacity !== undefined ? originalMaterial.opacity : 1.0;
    const originalTransparent = originalMaterial.transparent;

    // Flash instantáneo a blanco total
    originalMaterial.color.setHex(0xffffff);
    originalMaterial.opacity = 1.0;
    originalMaterial.transparent = true;
    originalMaterial.needsUpdate = true;

    // Restaurar después de 50ms
    setTimeout(() => {
      originalMaterial.color.copy(originalColor);
      originalMaterial.opacity = originalOpacity;
      originalMaterial.transparent = originalTransparent;
      originalMaterial.needsUpdate = true;

    }, 50);
  }

  // Glitch general sutil: cambios de color/brillo (1.5s por defecto)
  triggerGlobalGlitch(duration = 1500) {
    try {
      // 👇 OPTIMIZACIÓN: Reutilizar elementos y evitar recrear el DOM
      if (this._globalGlitchEl) {
        // Si ya existe un efecto activo, extender su duración en lugar de recrear
        return;
      }

      // 👇 Crear style solo una vez y reutilizarlo
      if (!this._globalGlitchStyle) {
        const style = document.createElement('style');
        style.textContent = `
          @keyframes dg-global-glitch-filter {
            0%   { filter: none; }
            10%  { filter: brightness(1.08) contrast(1.06) saturate(1.04) hue-rotate(6deg); }
            25%  { filter: brightness(0.94) contrast(1.05) saturate(0.98) hue-rotate(-6deg); }
            40%  { filter: brightness(1.03) contrast(1.08) saturate(1.02) hue-rotate(3deg); }
            60%  { filter: brightness(0.96) contrast(1.04) saturate(0.97) hue-rotate(-3deg); }
            80%  { filter: brightness(1.05) contrast(1.06) saturate(1.00) hue-rotate(2deg); }
            100% { filter: none; }
          }
          .dg-global-glitch-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            pointer-events: none;
            z-index: 9999;
            opacity: 0.09;
            mix-blend-mode: overlay;
            background-image: repeating-linear-gradient(to bottom, #D9DC77 0 3px, #DBB28D 3px 6px, #E4CF9D 6px 9px, #1F1F1F 9px 12px, #314B56 12px 15px, #171930 15px 18px),
                              repeating-linear-gradient(to right, rgba(255,255,255,0.05) 0 2px, transparent 2px 6px);
            background-size: 200% 200%, auto;
            will-change: background-position;
          }
        `;
        document.head.appendChild(style);
        this._globalGlitchStyle = style;
      }

      // 👇 Crear overlay con clase en lugar de inline styles (más eficiente)
      const ov = document.createElement('div');
      ov.className = 'dg-global-glitch-overlay';

      // 👇 Usar Web Animations API directamente (más eficiente que CSS animations para efectos únicos)
      document.body.appendChild(ov);
      document.body.style.animation = `dg-global-glitch-filter ${duration}ms ease-in-out`;

      // Animación de fondo
      ov.animate(
        [{ backgroundPosition: '0% 0%, 0 0' }, { backgroundPosition: '100% 100%, 20px 0' }],
        { duration, easing: 'ease-in-out' }
      );

      this._globalGlitchEl = ov;

      setTimeout(() => {
        try {
          if (this._globalGlitchEl === ov) {
            ov.remove();
            this._globalGlitchEl = null;
          }
          document.body.style.animation = '';
        } catch { }
      }, duration);
    } catch { }
  }

  startGlitchWhiteFlash() {
    if (!this.glitchObject) {
      this.completeGlitchReveal();
      return Promise.resolve();
    }



    const flashTargets = [];

    // Buscar todos los meshes del glitch object y crear shader materials
    this.glitchObject.traverse((child) => {
      if (!child.isMesh || !child.material) return;

      const originalMaterial = child.material;
      const alphaSource = originalMaterial.map || this.currentVideoTexture;

      if (!alphaSource) return;

      // Crear shader material blanco que respeta el alpha
      // También aplicar aquí repeat/offset de la textura (por ejemplo videoTexture.repeat.set(1, -1))
      const repeat = (alphaSource && alphaSource.repeat) ? alphaSource.repeat.clone() : new THREE.Vector2(1, 1);
      const offset = (alphaSource && alphaSource.offset) ? alphaSource.offset.clone() : new THREE.Vector2(0, 0);

      const flashMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uAlphaMap: { value: alphaSource },
          uRepeat: { value: repeat },
          uOffset: { value: offset }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uAlphaMap;
          uniform vec2 uRepeat;
          uniform vec2 uOffset;
          varying vec2 vUv;
          void main() {
            vec2 uv = vUv * uRepeat + uOffset;
            vec4 tex = texture2D(uAlphaMap, uv);
            float alpha = tex.a;
            if (alpha <= 0.0) discard;
            gl_FragColor = vec4(1.0, 1.0, 1.0, alpha); // Blanco con el alpha del texture
          }
        `
      });

      // Aplicar material flash
      child.material = flashMaterial;
      flashTargets.push({ child, originalMaterial, flashMaterial });
    });

    // Restaurar materiales originales después de 100ms
    setTimeout(() => {
      flashTargets.forEach(({ child, originalMaterial, flashMaterial }) => {
        child.material = originalMaterial;
        flashMaterial.dispose(); // Limpiar shader
      });


      // Completar reveal después del flash
      this.completeGlitchReveal();
    }, 100);

    return Promise.resolve();
  }

  updateGlitchFlash() {
    // Ya no es necesario - el flash ahora es instantáneo como en los rastros
  }

  finalizeGlitchFlash(state) {
    // Ya no es necesario - el flash ahora es instantáneo como en los rastros
  }

  completeGlitchReveal() {
    if (this.glitchObject) {
      this.glitchObject.visible = false;
    }

    if (this.videoElement) {
      try { this.videoElement.pause(); } catch { }
      try { this.videoElement.removeAttribute('src'); } catch { }
      try { this.videoElement.load(); } catch { }
      this.videoElement = null;
    }
    this._glitchCanvas = null;
    this._glitchCanvasCtx = null;

    if (this.currentVideoTexture) {
      try { this.currentVideoTexture.dispose(); } catch { }
      this.currentVideoTexture = null;
    }

    if (this.rastroObject) {
      this.rastroObject.visible = true;
    }
  }

  easeInCubic(t) {
    return t * t * t;
  }

  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  showCompletionOverlay({ isFinalRound = false } = {}) {
    const round = this.speciesManager.getProgress().round;
    const finalRound = isFinalRound || round >= TOTAL_ROUNDS;

    // Remove any previous instance (can otherwise leak across scene changes)
    this.hideCompletionOverlay({ immediate: true });

    const overlay = document.createElement('div');
    overlay.id = 'completion-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.9);
      z-index: 20000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: "new-science", 'New Science', system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial;
      color: #eef2f6;
      opacity: 0;
      transition: opacity 0.5s ease;
    `;

    const title = document.createElement('h2');
    title.textContent = finalRound
      ? '¡Completaste los 5 recorridos del Delta Grande!'
      : `Felicidades, terminaste el recorrido ${round}/${TOTAL_ROUNDS}`;
    title.style.cssText = `
      font-size: clamp(24px, 4vw, 36px);
      margin-bottom: 40px;
      text-align: center;
      font-weight: normal;
      letter-spacing: 0.05em;
    `;

    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = `
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      justify-content: center;
    `;

    const btnStyle = `
      font-family: "new-science", 'New Science', system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial;
      font-size: clamp(16px, 2vw, 20px);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #FBFE5E;
      background: transparent;
      border: 2px solid #FBFE5E;
      padding: 12px 32px;
      border-radius: 999px;
      cursor: pointer;
      outline: none;
      transition: transform 0.2s ease, background 0.2s ease, color 0.2s ease;
    `;
    if (!finalRound) {
      const btnContinue = document.createElement('button');
      btnContinue.textContent = 'Seguir descubriendo especies';
      btnContinue.style.cssText = btnStyle;
      btnContinue.onmouseover = () => {
        btnContinue.style.transform = 'translateY(-2px) scale(1.02)';
        btnContinue.style.background = 'rgba(251, 254, 94, 0.1)';
      };
      btnContinue.onmouseout = () => {
        btnContinue.style.transform = 'none';
        btnContinue.style.background = 'transparent';
      };
      btnContinue.onclick = () => {
        const advanced = this.speciesManager.advanceRound();
        this.hideCompletionOverlay();
        setTimeout(() => {
          if (advanced) {
            // Usar la transición dedicada antes de volver al recorrido
            location.hash = '#recorrido-transition';
          } else {
            location.hash = '#menu';
          }
        }, 520);
      };

      const btnMenu = document.createElement('button');
      btnMenu.textContent = 'Volver a la base';
      btnMenu.style.cssText = btnStyle;
      btnMenu.onmouseover = () => {
        btnMenu.style.transform = 'translateY(-2px) scale(1.02)';
        btnMenu.style.background = 'rgba(251, 254, 94, 0.1)';
      };
      btnMenu.onmouseout = () => {
        btnMenu.style.transform = 'none';
        btnMenu.style.background = 'transparent';
      };
      btnMenu.onclick = () => {
        this.hideCompletionOverlay();
        setTimeout(() => {
          location.hash = '#menu';
        }, 520);
      };

      buttonsContainer.appendChild(btnContinue);
      buttonsContainer.appendChild(btnMenu);
    } else {
      const btnLab = document.createElement('button');
      btnLab.textContent = 'Ir al laboratorio';
      btnLab.style.cssText = btnStyle;
      btnLab.onmouseover = () => {
        btnLab.style.transform = 'translateY(-2px) scale(1.02)';
        btnLab.style.background = 'rgba(251, 254, 94, 0.1)';
      };
      btnLab.onmouseout = () => {
        btnLab.style.transform = 'none';
        btnLab.style.background = 'transparent';
      };
      btnLab.onclick = () => {
        this.hideCompletionOverlay();
        setTimeout(() => {
          location.hash = '#menu';
        }, 520);
      };

      buttonsContainer.appendChild(btnLab);
    }
    overlay.appendChild(title);
    overlay.appendChild(buttonsContainer);

    const parent = this.overlayRoot || document.body;
    parent.appendChild(overlay);
    this.completionOverlayEl = overlay;

    // Fade in
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';

      // Crear botón para reproducir sonido si el autoplay está bloqueado
      const soundBtn = document.createElement('button');
      soundBtn.textContent = 'Reproducir sonido';
      soundBtn.style.cssText = `
        position: absolute;
        bottom: 36px;
        left: 50%;
        transform: translateX(-50%);
        font-family: "new-science", 'New Science', system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial;
        font-size: 16px;
        padding: 10px 18px;
        border-radius: 999px;
        border: 2px solid #FBFE5E;
        background: transparent;
        color: #FBFE5E;
        cursor: pointer;
        display: none; /* visible solo si autoplay falla */
        z-index: 20001;
      `;
      soundBtn.onclick = async () => {
        try { if (typeof AudioManager !== 'undefined' && AudioManager && typeof AudioManager.unlock === 'function') await AudioManager.unlock(); } catch (e) {}
        tryPlay();
        soundBtn.style.display = 'none';
      };
      overlay.appendChild(soundBtn);

      const preferredUrl = encodeURI(resolvePublicAsset('game-assets/recorrido/sonido/Victoria pez.mp3'));
      const fallbackUrl = encodeURI(resolvePublicAsset('game-assets/simulador/sound/Misión cumplida.mp3'));

      const tryPlay = () => {
        try {
          try { if (typeof AudioManager !== 'undefined' && AudioManager && typeof AudioManager.unlock === 'function') AudioManager.unlock(); } catch (e) {}
          // Intentar preferido
          let a = null;
          try { a = (typeof AudioManager !== 'undefined' && AudioManager) ? AudioManager.play(preferredUrl, { volume: 1 }) : null; } catch (e) { a = null; }
          if (!a) {
            try { a = (typeof AudioManager !== 'undefined' && AudioManager) ? AudioManager.play(fallbackUrl, { volume: 1 }) : null; } catch (e) { a = null; }
          }
          return a;
        } catch (e) {
          return null;
        }
      };

      // Intento automático inicial
      tryPlay();

      // Si a los 600ms no hay reproducción, mostrar el botón para que el usuario permita audio.
      this._completionOverlayAudioHintTimeout = setTimeout(() => {
        try {
          let playing = false;
          try {
            if (typeof AudioManager !== 'undefined' && AudioManager) {
              // Si hay un AudioContext y está en running, asumimos que sonó algo
              if (AudioManager.audioContext && AudioManager.audioContext.state === 'running') playing = true;
              // O si alguno de los elementos <audio> tiene .paused === false
              for (const k in AudioManager.audios) {
                const el = AudioManager.audios[k];
                if (el && typeof el.paused === 'boolean' && !el.paused) { playing = true; break; }
              }
            }
          } catch (e) { playing = false; }
          if (!playing) {
            soundBtn.style.display = 'inline-block';
          }
        } catch (e) {}
      }, 600);
    });
  }

  onFlechaClick() {
    // 👇 Previene clicks múltiples
    if (this.flechaClicked) return;
    this.flechaClicked = true;

    // 🔊 Reproducir sonido de pez agarrado
    const flechaClickAudio = new Audio('/game-assets/recorrido/sonido/Pez agarrado.mp3');
    flechaClickAudio.volume = 0.5;
    flechaClickAudio.play().catch(e => console.error("Flecha click audio play failed:", e));

    // 🔊 Reproducir sonido de barrida/transición INMEDIATO al click
    // (antes de imports/fetch/tweens para evitar demoras perceptibles)
    try {
      if (this.transitionAudio) {
        try { this.transitionAudio.pause(); } catch (e) { }
        try { this.transitionAudio.currentTime = 0; } catch (e) { }
      }
      this.transitionAudio = new Audio('/game-assets/recorrido/sonido/Transicion delta mas.mp3');
      this.transitionAudio.volume = 0.5;
      this.transitionAudio.play().catch(e => console.error("Transition audio play failed:", e));
    } catch (e) {
      console.warn('[RecorridoScene] Failed to start transition audio immediately', e);
    }

    // 🎵 Mantener el audio ambiente del stage durante la transición.
    // El crossfade al próximo ambiente se hace en loadStage().

    // 👇 Flash blanco y desaparición de la flecha
    const flechaMeshes = new Set();
    if (this.flechaObject) {
      this.flechaObject.traverse(child => {
        if (child.isMesh) {
          flechaMeshes.add(child);
        }
      });
    }
    if (flechaMeshes.size === 0 && this.flechaObjects?.length) {
      this.flechaObjects.forEach(mesh => {
        if (mesh?.isMesh) {
          flechaMeshes.add(mesh);
        }
      });
    }

    if (flechaMeshes.size > 0) {
      const flashTargets = [];
      let hasFlashTargets = false;

      flechaMeshes.forEach(mesh => {
        const originalMaterial = mesh.material;
        const originalList = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];

        let isValid = true;
        const shaderMaterials = originalList.map((mat) => {
          if (!mat) {
            isValid = false;
            return null;
          }

          const alphaSource = mat.alphaMap || mat.map;
          if (!alphaSource) {
            isValid = false;
            return null;
          }

          if (alphaSource.matrixAutoUpdate) {
            alphaSource.updateMatrix();
          }

          const shaderMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            uniforms: {
              uOpacity: { value: 0 },
              uAlphaMap: { value: alphaSource },
              uAlphaMapMatrix: { value: alphaSource.matrix ? alphaSource.matrix.clone() : new THREE.Matrix3() }
            },
            vertexShader: `
              varying vec2 vUv;
              void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `,
            fragmentShader: `
              uniform sampler2D uAlphaMap;
              uniform float uOpacity;
              uniform mat3 uAlphaMapMatrix;
              varying vec2 vUv;

              void main() {
                vec3 transformed = uAlphaMapMatrix * vec3(vUv, 1.0);
                vec4 tex = texture2D(uAlphaMap, transformed.xy);
                float alpha = tex.a * uOpacity;
                if (alpha <= 0.0) discard;
                gl_FragColor = vec4(vec3(1.0), alpha);
              }
            `
          });

          shaderMat.userData.alphaSource = alphaSource;
          return shaderMat;
        });

        if (!isValid || shaderMaterials.some(mat => !mat)) {
          shaderMaterials.forEach(mat => mat?.dispose?.());
          return;
        }

        hasFlashTargets = true;
        const replacement = Array.isArray(originalMaterial) ? shaderMaterials : shaderMaterials[0];
        mesh.material = replacement;
        if (Array.isArray(replacement)) {
          replacement.forEach(mat => mat && (mat.needsUpdate = true));
        } else if (replacement) {
          replacement.needsUpdate = true;
        }

        flashTargets.push({
          mesh,
          originalMaterial,
          flashMaterials: shaderMaterials
        });
      });

      const flashDuration = 200; // ms
      const startTime = performance.now();

      const animateFlash = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / flashDuration, 1);

        const opacity = 1 - progress;
        flashTargets.forEach(({ flashMaterials }) => {
          flashMaterials.forEach((mat) => {
            if (!mat?.uniforms?.uOpacity) return;
            const alphaSource = mat.userData?.alphaSource;
            if (alphaSource?.matrixAutoUpdate) {
              alphaSource.updateMatrix();
              if (alphaSource.matrix && mat.uniforms.uAlphaMapMatrix?.value instanceof THREE.Matrix3) {
                mat.uniforms.uAlphaMapMatrix.value.copy(alphaSource.matrix);
              }
            }
            mat.uniforms.uOpacity.value = opacity;
          });
        });

        if (progress < 1) {
          requestAnimationFrame(animateFlash);
        } else {
          if (this.flechaObject) {
            this.flechaObject.visible = false;
          }
          if (this.flechaObjects && this.flechaObjects.length > 0) {
            this.flechaObjects.forEach(flechaObj => {
              flechaObj.visible = false;
            });
          }

          flashTargets.forEach(({ mesh, originalMaterial, flashMaterials }) => {
            flashMaterials.forEach((mat) => {
              try { mat.dispose(); } catch { }
            });
            mesh.material = originalMaterial;
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach(mat => mat && (mat.needsUpdate = true));
            } else if (mesh.material) {
              mesh.material.needsUpdate = true;
            }
          });
        }
      };

      if (hasFlashTargets) {
        animateFlash();
      } else {
        if (this.flechaObject) {
          this.flechaObject.visible = false;
        }
        if (this.flechaObjects && this.flechaObjects.length > 0) {
          this.flechaObjects.forEach(flechaObj => {
            flechaObj.visible = false;
          });
        }
      }
    } else {
      if (this.flechaObject) {
        this.flechaObject.visible = false;
      }
      if (this.flechaObjects && this.flechaObjects.length > 0) {
        this.flechaObjects.forEach(flechaObj => {
          flechaObj.visible = false;
        });
      }
    }

    // 👇 Check if this is the last scene of the round
    const progress = this.speciesManager.getProgress();
    const isFinalRound = progress.round >= TOTAL_ROUNDS;
    const isLastStageOfRound = this.current === (this.stages.length - 1);
    if (isLastStageOfRound) {
      this.showCompletionOverlay({ isFinalRound });
      return;
    }

    // New transition system with barrida.webm overlay
    return import('../core/UI.js').then(({ UI }) => {
      // console.log('[RecorridoScene] Starting transition sequence');
      // 👇 Ocultar zócalo al iniciar la transición
      const zocaloVideo = document.getElementById('zocaloVideo');
      if (zocaloVideo) {
        zocaloVideo.style.opacity = '0';
      }

      // 🔊 Asegurar que el audio de transición ya esté sonando (se inicia en el click)
      // Nota: NO aplicamos delay acá; el delay corresponde al voiceover, no a la barrida.
      try {
        if (!this.transitionAudio) {
          this.transitionAudio = new Audio('/game-assets/recorrido/sonido/Transicion delta mas.mp3');
        }
        this.transitionAudio.volume = 0.5;
        // Si por alguna razón aún no arrancó, intentarlo ahora.
        if (this.transitionAudio.paused) {
          this.transitionAudio.play().catch(e => console.error("Transition audio play failed:", e));
        }
      } catch (e) {
        console.warn('[RecorridoScene] Failed to ensure transition audio is playing', e);
      }

      const nextSceneIndex = this.current + 1;

      // 📝 Cargar texto de transición desde JSON basado en round y stage
      let transitionText = null;
      const progress = this.speciesManager.getProgress();

      // El SpeciesManager aún NO se ha actualizado (se actualiza en nextStage())
      // Así que progress tiene el stage ACTUAL, no el próximo
      // Necesitamos calcular manualmente hacia dónde vamos
      const currentStage = progress.stage;
      const targetStage = (currentStage % 6) + 1; // Próximo stage (1-6, ciclando)
      const targetRound = (currentStage === 6) ? progress.round + 1 : progress.round; // Si completamos stage 6, avanzamos de ronda



      fetch('/game/data/transition_texts.json')
        .then(res => res.json())
        .then(data => {
          // Buscar transición que coincida con round y stage hacia donde vamos
          const transition = data.transitions.find(t =>
            t.round === targetRound && t.stage === targetStage
          );
          if (transition) {
            transitionText = transition;

          } else {

          }
          // Pause here for debugging when fetch completes so you can inspect values
          try {
         

          } catch (e) { /* noop in production */ }
          // If the overlay was requested before the fetch finished, trigger it now.
          try {
            if (barridaOverlay && barridaOverlay._textWanted) {

              // If showTextOverlay is defined at this point it will display the text.
              if (typeof showTextOverlay === 'function') showTextOverlay();
            }
          } catch (e) {
            console.warn('[RecorridoScene] Failed to auto-show transition text after load', e);
          }
        })
        .catch(e => console.error('Failed to load transition texts:', e));
      const transitionVideoSrc = `/game-assets/recorrido/transiciones_escenas/transicion${String(nextSceneIndex).padStart(2, '0')}.webm`;
      const FRAME_RATE = 30; // 👈 ajustar si el clip usa otro framerate
      const BARRIDA_TRIGGER_FRAME = 19; // 👈 Iniciar video de transición al frame 19 (barrida solo dura ~44 frames)



      // Create barrida overlay (top layer with alpha)
      const parent = this.overlayRoot || document.body;
      const barridaOverlay = document.createElement('div');
      // Use fixed positioning so barrida covers the whole viewport regardless of parent
      barridaOverlay.style.position = 'fixed';
      barridaOverlay.style.top = '0';
      barridaOverlay.style.left = '0';
      barridaOverlay.style.width = `100vw`;
      barridaOverlay.style.height = `100dvh`;
      barridaOverlay.style.zIndex = '10002';
      barridaOverlay.style.pointerEvents = 'none';
      barridaOverlay.style.display = 'flex';
      barridaOverlay.style.alignItems = 'center';
      barridaOverlay.style.justifyContent = 'center';
      barridaOverlay.style.opacity = '1';
      barridaOverlay.style.visibility = 'visible';
      barridaOverlay.style.transition = 'opacity 140ms ease-out';

      const barridaVideo = document.createElement('video');
      barridaVideo.style.cssText = `
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        background: transparent;
      `;
      barridaVideo.src = getVideoSource('/game-assets/recorrido/transiciones_escenas/barrida.webm');
      barridaVideo.muted = true; // 👈 Silenciar barrida para que solo suene transitionAudio
      barridaVideo.playsInline = true;
      barridaVideo.preload = 'auto'; // 👈 Precargar el video

      // 🔍 Log cuando el video carga sus metadatos
      barridaVideo.addEventListener('loadedmetadata', () => {

      });

      barridaOverlay.appendChild(barridaVideo);
      parent.appendChild(barridaOverlay);

      const showBarridaOverlay = () => {
        // Limpiar el texto anterior y resetear el video de loading box
        const textOverlay = document.getElementById('transition-text-overlay');
        const textEl = textOverlay?.querySelector('.transition-text-inner');
        if (textEl) {
          textEl.textContent = '';
        }
        
        const sequenceVideo = document.getElementById('sequenceOverlayVideo');
        const sequenceOverlay = document.getElementById('sequenceOverlay');
        if (sequenceVideo) {
          sequenceVideo.pause();
          sequenceVideo.currentTime = 0;
        }
        if (sequenceOverlay) {
          sequenceOverlay.style.display = 'none';
          sequenceOverlay.setAttribute('aria-hidden', 'true');
        }
        
        barridaOverlay.style.visibility = 'visible';
        barridaOverlay.style.opacity = '1';
      };

      const hideBarridaOverlay = () => {
        // console.log('[RecorridoScene] hideBarridaOverlay called');
        barridaOverlay.style.opacity = '0';
        barridaOverlay.style.visibility = 'hidden';
        
        // Make sure video overlay stays visible unless we intentionally cut the transition video
        if (!transitionVideoStopped) {
          const videoOverlay = document.getElementById('videoOverlay');
          if (videoOverlay) {
            // console.log('[RecorridoScene] Ensuring videoOverlay stays visible, current display:', videoOverlay.style.display);
            if (videoOverlay.style.display === 'none') {
              console.warn('[RecorridoScene] videoOverlay was hidden! Forcing display: block');
              videoOverlay.style.display = 'block';
            }
          }
        }
      };

      // Stop/hide the transition video cleanly while keeping audio playing
      const stopTransitionVideo = () => {
        if (!transitionVideoStarted || transitionVideoStopped) return;
        transitionVideoStopped = true;
        transitionVideoPlaying = false;

        if (this._keepVideoVisibleInterval) {
          clearInterval(this._keepVideoVisibleInterval);
          this._keepVideoVisibleInterval = null;
        }

        if (this._stopTransitionSequence) {
          this._stopTransitionSequence();
          this._stopTransitionSequence = null;
        }

        // Clear transition guard so hideVideo actually hides the overlay
        try { UI._transitionVideoActive = false; } catch (e) { /* ignore */ }
        // Hide the video overlay so the 3D scene is visible
        UI.hideVideo();

        // Restore z-index to default in case it was raised
        const videoOverlay = document.getElementById('videoOverlay');
        if (videoOverlay) {
          videoOverlay.style.zIndex = '9999';
        }

        const el = transitionVideoEl || document.getElementById('transition_video');
        if (el) {
          try { el.pause(); } catch (e) { /* ignore */ }
          try { el.currentTime = 0; } catch (e) { /* ignore */ }
        }
      };

      let transitionVideoStarted = false;
      let transitionVideoPlaying = false; // Track when the transition video is actually playing
      let transitionVideoStopped = false; // Stop the transition video once we cut it
      let secondBarridaStarted = false;
      let nextStagePromise = null;
      let textOverlayShown = false;
      let transitionVideoEl = null; // Keep a ref to the video element returned by UI.showVideo

      // 📝 Función para mostrar el texto overlay con efecto typewriter
      // Now backed by a static DOM element in `game/index.html` when available.
      const showTextOverlay = () => {
        if (textOverlayShown) return;
        // If transition text hasn't arrived yet, mark intent and exit.
        if (!transitionText) {
          try { barridaOverlay._textWanted = true; } catch (e) { /* ignore */ }
          return;
        }
        textOverlayShown = true;

        // 🔊 Play transition audio if available
        if (transitionText.round !== undefined && transitionText.stage !== undefined) {
          const audioPath = `/game-assets/transiciones/voiceovers/transition_r${transitionText.round}_s${transitionText.stage}.mp3`;
          const audio = new Audio(audioPath);
          audio.volume = 1.0;
          // Make sure only one voice is active
          this.stopRecorridoVoiceovers();
          this.transitionVoiceover = audio;

          // Delay voiceover playback by 3 seconds
          if (this._transitionVoiceoverTimer) {
            clearTimeout(this._transitionVoiceoverTimer);
            this._transitionVoiceoverTimer = null;
          }
          this._transitionVoiceoverTimer = setTimeout(() => {
            this._transitionVoiceoverTimer = null;
            this.stopRecorridoVoiceovers(audio);
            audio.play().catch(e => console.warn('[RecorridoScene] Transition audio play failed', e));
          }, 3000);

          barridaOverlay._audioDelayTimer = this._transitionVoiceoverTimer;
          barridaOverlay._audio = audio;
        }

        const parentEl = parent || document.body;
        let textOverlay = document.getElementById('transition-text-overlay');
        let created = false;

        if (!textOverlay) {
          // Fallback: create a minimal element if the static one is missing
          textOverlay = document.createElement('div');
          textOverlay.id = 'transition-text-overlay';
          textOverlay.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;height:240px;z-index:10003;pointer-events:none;display:flex;align-items:center;justify-content:center;padding:24px;opacity:0;transition:opacity 1s ease-in;';
          const inner = document.createElement('div');
          inner.className = 'transition-text-inner';
          inner.style.cssText = 'font-size:20px;font-weight:400;color:#FDFE63;text-shadow:0 0 18px rgba(0,0,0,0.6);letter-spacing:0.02em;line-height:1.4;';
          textOverlay.appendChild(inner);
          parentEl.appendChild(textOverlay);
          created = true;
        }

        // Use the inner element when present
        const textEl = textOverlay.querySelector('.transition-text-inner') || textOverlay;

        // Ensure visible and fade in
        textOverlay.style.display = 'flex';
        textOverlay.setAttribute('aria-hidden', 'false');
        setTimeout(() => { textOverlay.style.opacity = '1'; }, 800);

        // � Obtener el video de loading-text-box-animation
        const sequenceVideo = document.getElementById('sequenceOverlayVideo');
        const sequenceOverlay = document.getElementById('sequenceOverlay');
        
        const startTypewriter = () => {
          // 🖊️ Efecto typewriter mejorado - pre-calcula layout para evitar saltos
          const fullText = transitionText.text || transitionText.intro || '';
          
          // Primero, renderizar todo el texto de forma invisible para calcular el layout final
          textEl.textContent = fullText;
          textEl.style.visibility = 'hidden';
          
          // Forzar un reflow para que el navegador calcule el layout
          textEl.offsetHeight;
          
          // Ahora crear spans para cada carácter, preservando espacios y saltos de línea
          textEl.textContent = '';
          textEl.style.visibility = 'visible';
          textEl.style.whiteSpace = 'pre-wrap'; // Preservar saltos de línea y espacios
          
          const chars = fullText.split('');
          const charSpans = [];
          
          chars.forEach((char, index) => {
            const span = document.createElement('span');
            span.textContent = char;
            span.style.opacity = '0';
            span.style.display = 'inline'; // Forzar inline para evitar espacios extras
            textEl.appendChild(span);
            charSpans.push(span);
          });
          
          // Efecto typewriter: revelar caracteres uno por uno
          let currentIndex = 0;
          
          const typewriterInterval = setInterval(() => {
            if (currentIndex < charSpans.length) {
              charSpans[currentIndex].style.opacity = '1';
              charSpans[currentIndex].style.transition = 'opacity 0.05s ease-in';
              currentIndex++;
            } else {
              clearInterval(typewriterInterval);
            }
          }, 20);
          
          // Store references for cleanup
          barridaOverlay._typewriterInterval = typewriterInterval;
        };
        
        if (sequenceVideo && sequenceOverlay) {
          // Resetear el video al frame 0
          sequenceVideo.currentTime = 0;
          
          // Mostrar el overlay y reproducir el video
          sequenceOverlay.style.display = 'block';
          sequenceOverlay.setAttribute('aria-hidden', 'false');
          
          // Cuando llegue al segundo 2.2, pausar e iniciar el typewriter
          const checkTime = () => {
            if (sequenceVideo.currentTime >= 2.2) {
              sequenceVideo.pause();
              sequenceVideo.removeEventListener('timeupdate', checkTime);
              startTypewriter();
            }
          };
          
          sequenceVideo.addEventListener('timeupdate', checkTime);
          
          // Reproducir el video
          const playPromise = sequenceVideo.play();
          if (playPromise) {
            playPromise.catch(err => {
              console.warn('[RecorridoScene] Loading box animation play failed, starting typewriter anyway', err);
              sequenceVideo.removeEventListener('timeupdate', checkTime);
              startTypewriter();
            });
          }
        } else {
          // Si no hay video de loading box, iniciar el typewriter directamente
          startTypewriter();
        }

        // Store references for cleanup
        barridaOverlay._textOverlay = textOverlay;
        barridaOverlay._sequenceVideo = sequenceVideo;
        barridaOverlay._sequenceOverlay = sequenceOverlay;
        barridaOverlay._textShownTime = performance.now();

        // Auto-hide after configured duration; if element is static keep it in DOM and hide
        const textDuration = (this.current === 3 && nextSceneIndex === 4) ? 9000 : 10000;
        setTimeout(() => {
          if (barridaOverlay._textOverlay && !barridaOverlay._textRemoved) {
            barridaOverlay._textRemoved = true;
            if (barridaOverlay._typewriterInterval) clearInterval(barridaOverlay._typewriterInterval);

            if (barridaOverlay._audioDelayTimer) {
              try { clearTimeout(barridaOverlay._audioDelayTimer); } catch (e) { /* ignore */ }
              barridaOverlay._audioDelayTimer = null;
            }

            // 🛑 Stop Audio
            if (barridaOverlay._audio) {
              try {
                barridaOverlay._audio.pause();
                barridaOverlay._audio.currentTime = 0;
                barridaOverlay._audio = null;
              } catch (e) { /* ignore */ }
            }

            if (this.transitionVoiceover) {
              try {
                this.transitionVoiceover.pause();
                this.transitionVoiceover.currentTime = 0;
              } catch (e) { /* ignore */ }
              this.transitionVoiceover = null;
            }

            barridaOverlay._textOverlay.style.transition = 'opacity 0.3s ease-out';
            barridaOverlay._textOverlay.style.opacity = '0';
            
            // También ocultar el sequenceOverlay
            if (barridaOverlay._sequenceOverlay) {
              barridaOverlay._sequenceOverlay.style.display = 'none';
              barridaOverlay._sequenceOverlay.setAttribute('aria-hidden', 'true');
            }

            setTimeout(() => {
              try {
                if (barridaOverlay._textOverlay) {
                  // If the overlay was provided statically in HTML, keep it but hide it
                  if (barridaOverlay._textOverlay.getAttribute && barridaOverlay._textOverlay.getAttribute('data-static') === 'true') {
                    barridaOverlay._textOverlay.style.display = 'none';
                    barridaOverlay._textOverlay.setAttribute('aria-hidden', 'true');
                  } else {
                    // Otherwise remove the dynamically created node
                    barridaOverlay._textOverlay.remove();
                  }
                }
              } catch (e) {
                console.error('[RecorridoScene] Failed to remove/hide text overlay', e);
              }
            }, 300);
          }
        }, textDuration);
      };

      // 📺 Monitorear primera barrida para mostrar texto 2 segundos antes de que termine
      const monitorFirstBarrida = () => {
        if (barridaVideo.paused || barridaVideo.ended) return;

        const timeRemaining = barridaVideo.duration - barridaVideo.currentTime;

        // Mostrar texto 2 segundos antes de que termine la barrida
        if (!textOverlayShown && timeRemaining <= 1.0 && timeRemaining > 0) {

          showTextOverlay();
        }

        if (!barridaVideo.ended) {
          requestAnimationFrame(monitorFirstBarrida);
        }
      };


      const handleFirstBarridaEnd = () => {
        // console.log('[RecorridoScene] First barrida ended');


        hideBarridaOverlay();

        // Si el texto aún no se mostró (por algún error de timing), mostrarlo ahora
        if (!textOverlayShown) {
          showTextOverlay();
        }
      };
      barridaVideo.addEventListener('ended', handleFirstBarridaEnd, { once: true });      // Handle second barrida end - only remove after it finishes
      const handleSecondBarridaEnd = async () => {
        // console.log('[RecorridoScene] Second barrida ended');
        
        // Clear the interval that keeps video visible
        if (this._keepVideoVisibleInterval) {
          clearInterval(this._keepVideoVisibleInterval);
          this._keepVideoVisibleInterval = null;
        }


        if (this._stopTransitionSequence) {
          this._stopTransitionSequence();
        }

        // 👉 Ocultar el video overlay para desbloquear clicks y cámara
        UI.hideVideo();


        // � Restaurar z-index del video overlay
        const videoOverlay = document.getElementById('videoOverlay');
        if (videoOverlay) {
          videoOverlay.style.zIndex = '9999'; // Restaurar valor original
        }

        // �📝 Remover text overlay si aún existe (por si acaso no se removió antes)
        if (barridaOverlay._textOverlay && !barridaOverlay._textRemoved) {
          if (barridaOverlay._typewriterInterval) {
            clearInterval(barridaOverlay._typewriterInterval);
          }
          try {
            barridaOverlay._textOverlay.remove();
          } catch (e) {
            console.error('[RecorridoScene] Failed to remove text overlay', e);
          }
        }

        try {
          barridaOverlay.remove();
        } catch (e) {
          console.error('[RecorridoScene] Failed to remove barrida overlay', e);
        }

        // 👉 Esperar a que termine de cargar si aún no terminó
        if (nextStagePromise) {
          await nextStagePromise;
        }

        // 👉 Ahora SÍ detener el audio de transición
        if (this.transitionAudio) {
          this.transitionAudio.pause();
          this.transitionAudio = null;
        }



        // 🔊 Reproducir sonido de inicio de escenario (post barrida)
        if (this.sceneStartAudio) {
          this.sceneStartAudio.pause();
          this.sceneStartAudio.currentTime = 0;
        }
        this.sceneStartAudio = new Audio('/game-assets/recorrido/sonido/Transicion inicio de escenarios.mp3');
        this.sceneStartAudio.volume = 0.5;
        this.sceneStartAudio.play().catch(e => console.error("Scene start audio play failed:", e));

        // 🎬 Reproducir zócalo de la nueva escena
        this.playZocalo();

        // 👉 Resetear flechaClicked para permitir nuevos clicks
        this.flechaClicked = false;

      };

      // Start the transition video (guarded so we can call from multiple triggers)
      const startTransitionVideo = () => {
        // console.log('[RecorridoScene] startTransitionVideo called');
        if (transitionVideoStarted) return;
        transitionVideoStarted = true;

        // Set up interval to keep videoOverlay visible
        this._keepVideoVisibleInterval = setInterval(() => {
          const videoOverlay = document.getElementById('videoOverlay');
          if (videoOverlay && videoOverlay.style.display === 'none') {
            console.warn('[RecorridoScene] videoOverlay hidden by external code, restoring');
            videoOverlay.style.display = 'block';
          }
        }, 100);


        // 👇 Ajustar z-index del video overlay para que esté DEBAJO de la barrida
        const videoOverlay = document.getElementById('videoOverlay');
        if (videoOverlay) {
          videoOverlay.style.zIndex = '10000'; // Debajo de barrida (10002) pero encima del texto (10003 se usa solo para transition-text-overlay)

        }

        if (this._stopTransitionSequence) {
          this._stopTransitionSequence();
        }

        // Add error visibility hooks so we know if the media is missing or blocked
        const transitionEl = document.getElementById('transition_video');
        if (transitionEl && !transitionEl._recorridoErrorHook) {
          transitionEl._recorridoErrorHook = true;
          transitionEl.addEventListener('error', (err) => {
            console.error('[RecorridoScene] Transition video error', err?.message || err, {
              networkState: transitionEl.networkState,
              readyState: transitionEl.readyState,
              src: transitionEl.currentSrc || transitionEl.src
            });
          });
        }

        const showVideoPromise = UI.showVideo({
          src: transitionVideoSrc,
          controls: false,
          // Keep muted so autoplay isn't blocked; audio is handled separately
          muted: true,
          immersive: false,
          onended: () => {
            // console.log('[RecorridoScene] Transition video onended fired');
            // console.log('[RecorridoScene] Video currentTime:', transitionEl?.currentTime);
            // console.log('[RecorridoScene] Video duration:', transitionEl?.duration);
            // console.log('[RecorridoScene] Video ended:', transitionEl?.ended);
            // Ocultar el video cuando termina, la segunda barrida ya está encima
            if (this._stopTransitionSequence) {
              this._stopTransitionSequence();
            }
            UI.hideVideo();
          }
        });
        
        // console.log('[RecorridoScene] UI.showVideo promise:', showVideoPromise);
        
        showVideoPromise.then(async (transitionVideo) => {
          // console.log('[RecorridoScene] Transition video element:', transitionVideo);
          // console.log('[RecorridoScene] Video readyState:', transitionVideo.readyState);
          // console.log('[RecorridoScene] Video duration:', transitionVideo.duration);
          // console.log('[RecorridoScene] Video currentTime:', transitionVideo.currentTime);
          // console.log('[RecorridoScene] Video paused:', transitionVideo.paused);
          // console.log('[RecorridoScene] Video src:', transitionVideo.src);
          transitionVideoEl = transitionVideo;
          transitionVideoPlaying = !transitionVideo.paused && !transitionVideo.ended;

          // Track when playback actually starts
          transitionVideo.addEventListener('playing', () => {
            transitionVideoPlaying = true;
          });
          transitionVideo.addEventListener('pause', () => {
            transitionVideoPlaying = false;
          });

          // If autoplay was blocked for any reason, force a play attempt now
          const tryPlayTransition = () => {
            if (transitionVideoStopped) return;
            const playPromise = transitionVideo.play();
            if (playPromise && typeof playPromise.then === 'function') {
              playPromise.then(() => { transitionVideoPlaying = true; }).catch(err => {
                console.warn('[RecorridoScene] Transition video play retry failed', err);
              });
            }
          };

          // Initial play retry after ready
          tryPlayTransition();

          // Safety: retry once more shortly after
          setTimeout(() => {
            if (!transitionVideoPlaying && !transitionVideoStopped) {
              console.warn('[RecorridoScene] Transition video still paused, retrying play');
              tryPlayTransition();
            }
          }, 200);
          const videoOverlay = document.getElementById('videoOverlay');
          // console.log('[RecorridoScene] videoOverlay display after showVideo:', videoOverlay?.style.display);
          
          // Safety: Force display block if it's somehow hidden
          if (videoOverlay && videoOverlay.style.display === 'none') {
            console.warn('[RecorridoScene] videoOverlay was hidden, forcing display block');
            videoOverlay.style.display = 'block';
          }

          const videoOverlayEl = document.getElementById('videoOverlay');
          if (videoOverlayEl) {
            // 🎞️ Use a pre-created sequence overlay element when possible (added to game/index.html)
            const seqOverlayId = 'sequenceOverlay';
            const seqVideoId = 'sequenceOverlayVideo';

            // Try to find the elements inside the video overlay, then globally as fallback
            let sequenceOverlay = videoOverlayEl.querySelector(`#${seqOverlayId}`) || document.getElementById(seqOverlayId);
            let sequenceVideo = videoOverlayEl.querySelector(`#${seqVideoId}`) || document.getElementById(seqVideoId);

            // If not present (older builds), create them as a fallback and mark ownership
            if (!sequenceOverlay || !sequenceVideo) {
              sequenceOverlay = document.createElement('div');
              sequenceOverlay.id = seqOverlayId;
              sequenceOverlay.style.cssText = `position: absolute; inset: 0; pointer-events: none; z-index: 10001;`;

              sequenceVideo = document.createElement('video');
              sequenceVideo.id = seqVideoId;
              sequenceVideo.src = getVideoSource('/game-assets/recorrido/interfaz/loading-text-box-animation.webm');
              sequenceVideo.muted = true;
              sequenceVideo.loop = false;
              sequenceVideo.playsInline = true;
              sequenceVideo.style.cssText = `position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block;`;

              sequenceOverlay.appendChild(sequenceVideo);
              videoOverlayEl.appendChild(sequenceOverlay);
              sequenceOverlay._createdByScript = true;
            }

            // Ensure visible and ready
            sequenceOverlay.style.display = 'block';
            sequenceOverlay.style.visibility = 'visible';
            sequenceVideo.muted = true;
            sequenceVideo.loop = false;
            sequenceVideo.playsInline = true;
            if (!sequenceVideo.src) sequenceVideo.src = getVideoSource('/game-assets/recorrido/interfaz/loading-text-box-animation.webm');

            // Reproducir el video overlay y mantener en el último frame al terminar
            sequenceVideo.addEventListener('ended', () => {
              // Mantener el último frame visible (ya que loop=false)

            }, { once: true });

            // 👇 Esperar a que el video esté listo antes de reproducirlo
            const tryPlaySequenceVideo = () => {
              if (sequenceVideo.readyState >= 2) {
                const playPromise = sequenceVideo.play();
                if (playPromise) {
                  playPromise.catch(err => {
                    console.warn('[RecorridoScene] Transition overlay video play failed', err);
                  });
                }
              } else {
                sequenceVideo.addEventListener('loadeddata', () => {
                  const playPromise = sequenceVideo.play();
                  if (playPromise) {
                    playPromise.catch(err => {
                      console.warn('[RecorridoScene] Transition overlay video play failed', err);
                    });
                  }
                }, { once: true });
              }
            };
            tryPlaySequenceVideo();

            // Force a second attempt shortly after in case autoplay was blocked
            setTimeout(() => {
              if (sequenceVideo.paused && !transitionVideoStopped) {
                tryPlaySequenceVideo();
              }
            }, 200);

            const detachOverlay = () => {
              try {
                sequenceVideo.pause();
              } catch { }
              // If we created the element here, remove it entirely to free resources.
              if (sequenceOverlay._createdByScript) {
                try { sequenceVideo.removeAttribute('src'); sequenceVideo.load(); } catch { }
                try { sequenceOverlay.remove(); } catch { }
              } else {
                // Otherwise just hide it but keep the last frame loaded in the DOM
                try { sequenceOverlay.style.display = 'none'; } catch { }
              }
            };

            let handleVideoEnded = null;
            let handleVideoPause = null;

            const cleanupListeners = () => {
              if (handleVideoEnded) {
                transitionVideo.removeEventListener('ended', handleVideoEnded);
                handleVideoEnded = null;
              }
              if (handleVideoPause) {
                transitionVideo.removeEventListener('pause', handleVideoPause);
                handleVideoPause = null;
              }
            };

            const stopSequence = () => {
              cleanupListeners();
              detachOverlay();
            };

            handleVideoEnded = () => {
              stopSequence();
              this._stopTransitionSequence = null;
            };

            handleVideoPause = () => {
              if (videoOverlayEl.style.display === 'none') {
                stopSequence();
                this._stopTransitionSequence = null;
              }
            };

            transitionVideo.addEventListener('ended', handleVideoEnded, { once: true });
            transitionVideo.addEventListener('pause', handleVideoPause);

            this._stopTransitionSequence = () => {
              stopSequence();
              this._stopTransitionSequence = null;
            };
          }

          // 👇 Si es la tercera sección (nextSceneIndex === 3), agregar listener para ir a InstruccionesTransitionScene
          // if (nextSceneIndex === 3) {
          //   const handleVideoClick = () => {
          //

          //     // Limpiar todo
          //     if (this.transitionAudio) {
          //       this.transitionAudio.pause();
          //       this.transitionAudio = null;
          //     }

          //     // Remover listeners
          //     transitionVideo.removeEventListener('click', handleVideoClick);

          //     // Limpiar overlays
          //     try {
          //       barridaOverlay.remove();
          //     } catch (e) {
          //       console.error('[RecorridoScene] Failed to remove barrida overlay', e);
          //     }

          //     // Ocultar video
          //     import('../core/UI.js').then(({ UI }) => {
          //       UI.hideVideo();
          //     });

          //     // Navegar a InstruccionesTransitionScene
          //     this.app.router.goTo('instrucciones-transition');
          //   };

          //   transitionVideo.addEventListener('click', handleVideoClick);
          //
          // }

          // �👉 Precargar la siguiente escena INMEDIATAMENTE (sin pausar transitionAudio)

          nextStagePromise = this.nextStage({ keepTransitionAudio: true });

          // Monitor transition video to trigger second barrida 19 frames before end
          const monitorTransition = () => {
            if (transitionVideoStopped) return;
            if (!transitionVideo) {
              // console.log('[RecorridoScene] Monitor stopped - video null');
              return;
            }
            if (transitionVideo.paused && !transitionVideo.ended) {
              // Try to kick playback if it got paused/blocked
              const retry = transitionVideo.play();
              if (retry && typeof retry.catch === 'function') {
                retry.catch(err => console.warn('[RecorridoScene] Transition monitor play retry failed', err));
              }
              requestAnimationFrame(monitorTransition);
              return;
            }
            
            // Log every 0.5 seconds
            if (!this._lastLogTime || Date.now() - this._lastLogTime > 500) {
              // console.log('[RecorridoScene] Video playing:', transitionVideo.currentTime.toFixed(2), '/', transitionVideo.duration.toFixed(2));
              this._lastLogTime = Date.now();
            }

            const timeRemaining = transitionVideo.duration - transitionVideo.currentTime;
            const framesRemaining = Math.floor(timeRemaining * FRAME_RATE);

            // 19 frames before end, play barrida again
            if (!secondBarridaStarted && framesRemaining <= BARRIDA_TRIGGER_FRAME && framesRemaining > 0) {
              secondBarridaStarted = true;

              showBarridaOverlay();
              barridaVideo.currentTime = 0;


              // Listen for second barrida end
              barridaVideo.addEventListener('ended', handleSecondBarridaEnd, { once: true });

              // 🛡️ Safety fallback: Monitor second barrida and force cleanup if needed
              const monitorSecondBarrida = () => {
                if (!barridaVideo || barridaVideo.paused || barridaVideo.ended) {
                  return;
                }

                const timeLeft = barridaVideo.duration - barridaVideo.currentTime;

                if (timeLeft > 0) {
                  requestAnimationFrame(monitorSecondBarrida);
                } else {
                  // Forzar cleanup si el evento 'ended' no dispara

                  setTimeout(handleSecondBarridaEnd, 100);
                }
              };

              const secondPlay = barridaVideo.play();
              if (secondPlay && typeof secondPlay.then === 'function') {
                secondPlay.then(() => {
                  monitorSecondBarrida();
                }).catch(err => {
                  console.error('[RecorridoScene] Failed to play second barrida:', err);
                  // If play fails, clean up anyway
                  handleSecondBarridaEnd();
                });
              } else {
                console.warn('[RecorridoScene] Second barrida play promise unavailable, continuing');
                monitorSecondBarrida();
              }
            }

            if (timeRemaining > 0) {
              requestAnimationFrame(monitorTransition);
            }
          };

          if (transitionVideo.readyState >= 1) {
            monitorTransition();
          } else {
            transitionVideo.addEventListener('loadedmetadata', () => {
              monitorTransition();
            }, { once: true });
          }
        });
      };

      // Monitor barrida frames
      const checkBarridaFrame = () => {
        const currentTime = barridaVideo.currentTime;
        const currentFrame = Math.floor(currentTime * FRAME_RATE);

        // At frame 19 (or when we pass it), start the transition video underneath
        if (currentFrame >= BARRIDA_TRIGGER_FRAME) {
          startTransitionVideo();
        }

        if (!barridaVideo.paused && !barridaVideo.ended && !transitionVideoStarted) {
          requestAnimationFrame(checkBarridaFrame);
        }
      };

      // Cut the transition video at 0.74s of the SECOND barrida so the 3D scene is revealed
      const BARRIDA_VIDEO_CUTOFF = 0.74;
      barridaVideo.addEventListener('timeupdate', () => {
        // Only cut during the second barrida (the one ending the transition)
        if (!secondBarridaStarted) return;

        if (!transitionVideoStopped && barridaVideo.currentTime >= BARRIDA_VIDEO_CUTOFF) {
          stopTransitionVideo();
        }
      });

      // Fallback: if frame-based trigger misses (e.g., dropped frames), start after 800ms
      setTimeout(() => {
        if (!transitionVideoStarted) {
          console.warn('[RecorridoScene] Fallback starting transition video');
          startTransitionVideo();
        }
      }, 800);

      // Start playing barrida
      const initialPlay = barridaVideo.play();
      if (initialPlay && typeof initialPlay.then === 'function') {
        initialPlay.then(() => {

          showBarridaOverlay();
          checkBarridaFrame();
          // 📺 Iniciar monitoreo para mostrar texto 1 segundo antes del final
          monitorFirstBarrida();

          // Safety timeout for first barrida end
          const duration = (barridaVideo.duration && isFinite(barridaVideo.duration)) ? barridaVideo.duration : 3;
          setTimeout(() => {
             // Check if overlay is still visible (opacity 1)
             if (barridaOverlay.style.opacity === '1') {
                 console.warn('[RecorridoScene] Force ending first barrida (timeout)');
                 handleFirstBarridaEnd();
             }
          }, (duration * 1000) + 1000);
        }).catch(err => {
          console.error('[RecorridoScene] Failed to play barrida:', err);
          hideBarridaOverlay();
        });
      } else {
        console.warn('[RecorridoScene] Barrida play promise unavailable, continuing');
        showBarridaOverlay();
        checkBarridaFrame();
        // 📺 Iniciar monitoreo para mostrar texto 1 segundo antes del final
        monitorFirstBarrida();

        // Safety timeout for first barrida end
        const duration = (barridaVideo.duration && isFinite(barridaVideo.duration)) ? barridaVideo.duration : 3;
        setTimeout(() => {
            // Check if overlay is still visible (opacity 1)
            if (barridaOverlay.style.opacity === '1') {
                console.warn('[RecorridoScene] Force ending first barrida (timeout/fallback)');
                handleFirstBarridaEnd();
            }
        }, (duration * 1000) + 1000);
      }

      // Safety: hide overlay if the barrida media fails to load
      barridaVideo.addEventListener('error', (err) => {
        console.error('[RecorridoScene] Barrida video error', err);
        hideBarridaOverlay();
      }, { once: true });
    });
  }

  triggerWipeTransition(onComplete) {
    return new Promise((resolve) => {
      try {
        // Clean up any previous wipe
        if (this._wipeElements) {
          this._wipeElements.forEach(el => el.remove());
          this._wipeElements = null;
        }
        if (this._wipeStyle) {
          this._wipeStyle.remove();
          this._wipeStyle = null;
        }

        const closeDuration = 600;
        const openDuration = 600;
        const easing = 'cubic-bezier(0.65, 0, 0.35, 1)';

        const style = document.createElement('style');
        style.textContent = `
          @keyframes dg-wipe-left-close {
            0%   { transform: translateX(-100%); }
            100% { transform: translateX(0); }
          }
          @keyframes dg-wipe-right-close {
            0%   { transform: translateX(100%); }
            100% { transform: translateX(0); }
          }
          @keyframes dg-wipe-left-open {
            0%   { transform: translateX(0); }
            100% { transform: translateX(-100%); }
          }
          @keyframes dg-wipe-right-open {
            0%   { transform: translateX(0); }
            100% { transform: translateX(100%); }
          }
        `;
        document.head.appendChild(style);
        this._wipeStyle = style;

        const parent = this.overlayRoot || document.body;
        const leftBand = document.createElement('div');
        leftBand.style.position = 'absolute';
        leftBand.style.left = '0';
        leftBand.style.top = '0';
        leftBand.style.width = '50%';
        leftBand.style.height = '100%';
        leftBand.style.background = 'white';
        leftBand.style.zIndex = '10001';
        leftBand.style.pointerEvents = 'none';
        leftBand.style.animation = `dg-wipe-left-close ${closeDuration}ms ${easing} forwards`;

        const rightBand = document.createElement('div');
        rightBand.style.position = 'absolute';
        rightBand.style.right = '0';
        rightBand.style.top = '0';
        rightBand.style.width = '50%';
        rightBand.style.height = '100%';
        rightBand.style.background = 'white';
        rightBand.style.zIndex = '10001';
        rightBand.style.pointerEvents = 'none';
        rightBand.style.animation = `dg-wipe-right-close ${closeDuration}ms ${easing} forwards`;

        parent.appendChild(leftBand);
        parent.appendChild(rightBand);
        this._wipeElements = [leftBand, rightBand];

        let opened = false;
        let cleaned = false;

        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          try { leftBand.remove(); } catch { }
          try { rightBand.remove(); } catch { }
          try { style.remove(); } catch { }
          this._wipeElements = null;
          this._wipeStyle = null;
          resolve();
        };

        const startOpen = () => {
          if (opened) return;
          opened = true;
          const applyOpen = () => {
            leftBand.style.animation = `dg-wipe-left-open ${openDuration}ms ${easing} forwards`;
            rightBand.style.animation = `dg-wipe-right-open ${openDuration}ms ${easing} forwards`;
          };
          requestAnimationFrame(() => requestAnimationFrame(applyOpen));
        };

        const waitForContent = async () => {
          try {
            if (onComplete) {
              await Promise.resolve(onComplete());
            }
            // wait a frame so newly loaded assets can settle before revealing
            await new Promise(res => requestAnimationFrame(() => res()))
              .catch(() => { });
          } catch (error) {
            console.error('[RecorridoScene] Wipe transition content step failed', error);
          } finally {
            startOpen();
          }
        };

        const handleCloseEnd = (event) => {
          if (event.animationName !== 'dg-wipe-left-close') return;
          leftBand.removeEventListener('animationend', handleCloseEnd);
          waitForContent();
        };

        const handleOpenEnd = (event) => {
          if (event.animationName !== 'dg-wipe-left-open') return;
          leftBand.removeEventListener('animationend', handleOpenEnd);
          cleanup();
        };

        const handleRightOpenEnd = (event) => {
          if (event.animationName !== 'dg-wipe-right-open') return;
          rightBand.removeEventListener('animationend', handleRightOpenEnd);
          cleanup();
        };

        leftBand.addEventListener('animationend', handleCloseEnd);
        leftBand.addEventListener('animationend', handleOpenEnd);
        rightBand.addEventListener('animationend', handleRightOpenEnd);
      } catch {
        resolve();
      }
    });
  }


}