import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { AssetLoader } from '../core/AssetLoader.js';
import { BaseScene } from '../core/BaseScene.js';
import { UI } from '../core/UI.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const saturate = (v) => clamp(v, 0, 1);
const smoothstep = (edge0, edge1, x) => {
  const width = Math.max(1e-5, edge1 - edge0);
  const t = saturate((x - edge0) / width);
  return t * t * (3 - 2 * t);
};

// Shared opener so scene-specific UI buttons can toggle the ESC/pause overlay.
const triggerPauseMenuOverlay = () => {
  if (typeof window === 'undefined') return;
  if (typeof window.showPauseMenu === 'function') {
    window.showPauseMenu();
    return;
  }
  const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  window.dispatchEvent(escapeEvent);
};

const FONT_LINK_DATA_ATTR = 'data-simulador-fontkit';
let loadedFontHref = null;

const WEATHER_PLAYBACK_SPEED = 2;
const LOADING_STYLE_ID = 'simulador-loading-style';

export const DEFAULT_PARAMS = Object.freeze({
  world: Object.freeze({
    top: 1,
    bottom: -0.38,
    cameraZ: 6.5,
    backgroundZ: -2,
    backgroundImage: null
  }),
  sky: Object.freeze({
    gradientTopColor: '#8ecae6',
    gradientBottomColor: '#e3f1ff',
    clouds: Object.freeze({
      enabled: true,
      textureBasePath: '/game-assets/simulador',
      texturePrefix: 'cloud',
      textureExtension: '.png',
      textureCount: 3,
      maxConcurrent: 5,
      spawnInterval: 5,
      spawnIntervalJitter: 3,
      baseSpeed: 0.035,
      speedVariance: 0.015,
      baseScale: 0.12,
      scaleVariance: 0.05,
      verticalRange: Object.freeze([0.7, 0.95]),
      depth: -1.6,
      despawnMargin: 0.2,
      spawnOffset: 0.05
    })
  }),
  colors: Object.freeze({
    skyTop: '#8ecae6',
    skyBottom: '#e3f1ff',
    distantBank: '#86b58d',
    distantBankShadow: '#5a8760',
    waterSurface: '#8c6b43',
    waterDeep: '#3f2c21',
    waterHighlight: '#d7b983',
    waterAverageLine: '#f5d06d',
    riverbedBase: '#caa46b',
    riverbedShadow: '#a67548',
    sedimentParticle: '#f3d3a2',
    sedimentShadow: '#c49563',
    uiBackground: 'rgba(10, 34, 61, 0.6)',
    uiBackgroundActive: 'rgba(20, 54, 90, 0.85)',
    uiAccent: '#ffd166',
    uiText: '#f8fafc',
    cursorSediment: '#d6b17e',
    cursorSeed: '#68c08b',
    cursorRemove: '#e76f51',
    cursorDisabled: '#8a96a8'
  }),
  audio: Object.freeze({
    basePath: '/game-assets/simulador/sound',
    sediment: Object.freeze({
      file: 'Sedimento.mp3',
      volume: 1,
      delay: 0.0
    }),
    waterRaise: Object.freeze({
      file: 'Sube el agua.mp3',
      volume: 0.4,
      delay: 0
    }),
    waterLower: Object.freeze({
      file: 'Desenso de agua.mp3',
      volume: 0.4,
      delay: 0
    }),
    seedPlant: Object.freeze({
      files: Object.freeze(['Semilla 1.mp3', 'Semilla 2.mp3', 'Semilla 3.mp3']),
      volume: 1,
      delay: 0
    }),
    select: Object.freeze({
      file: 'select.mp3',
      volume: 0.2,
      delay: 0
    }),
    removePlant: Object.freeze({
      file: 'remover.mp3',
      volume: 1,
      delay: 0
    }),
    ambient: Object.freeze({
      file: 'Sonido general naturaleza simulador.mp3',
      volume: 1,
      delay: 0,
      loop: true
    }),
    music: Object.freeze({
      file: '../simulador_musica.mp3',
      volume: 0.25,
      delay: 0,
      loop: true
    }),
    plantTransitions: Object.freeze({
      seedToSprout: Object.freeze({
        file: 'De semilla a brote.mp3',
        volume: 0.2,
        delay: 0
      }),
      sproutToSapling: Object.freeze({
        file: 'Brote a arbolito.mp3',
        volume: 0.2,
        delay: 0
      }),
      saplingToTree: Object.freeze({
        file: 'Arbolito a arbol.mp3',
        volume: 0.2,
        delay: 0
      }),
      treeToFinal: Object.freeze({
        file: 'Arbol a Arbol final.mp3',
        volume: 0.2,
        delay: 0
      })
    })
  }),
  water: Object.freeze({
    surfaceSegments: 200,
    baseLevel: 0.0,
    levelDelta: 0.25,
    bottom: -0.4,
    smoothing: 2.2,
    opacity: 0.5,
    wave: Object.freeze({
      primaryAmplitude: 0.036*0.5,
      secondaryAmplitude: 0.022*0.5,
      tertiaryAmplitude: 0.012*0.5,
      chop: 0.14*0.5,
      primaryFrequency: 7.4,
      secondaryFrequency: 12.8,
      tertiaryFrequency: 3.2,
      primarySpeed: 0.72,
      secondarySpeed: 1.18,
      tertiarySpeed: 0.25,
      noiseAmplitude: 0.018,
      noiseScale: 1.7,
      noiseSpeed: 0.16
    }),
    averageLine: Object.freeze({
      color: '#ffaa00',
      opacity: 1,
      dashSize: 0.035,
      gapSize: 0.02,
      baseAmplitude: 0.009,
      baseFrequency: 6.5,
      baseSpeed: 0.4,
      waves: Object.freeze([
        Object.freeze({ amplitude: 0.008, frequency: 11.5, speed: -0.85 }),
        Object.freeze({ amplitude: 0.006, frequency: 4.2, speed: 0.65 }),
        Object.freeze({ amplitude: 0.005, frequency: 7.8, speed: 1.25 })
      ]),
      noiseAmplitude: 0.0075,
      noiseScale: 1.4,
      noiseSpeed: 0.35
    })
  }),
  riverbed: Object.freeze({
    segments: 200,
    baseHeight: -0.32,
    highBaseline: -0.16,
    bottom: -0.38,
    maxHeight: 0.82,
    plateauStart: 0.15,
    plateauEnd: 0.85,
    transitionWidth: 0.12,
    growthCap: Object.freeze({
      enabled: true,
      // Maximum riverbed height within the island plateau (innerStart..innerEnd),
      // expressed relative to the *average* (medium) water level.
      // This keeps the final island surface more even and prevents sharp peaks.
      baseAboveAverageWater: 0.02,
      // Subtle parabola: slightly lower in the center, slightly higher at the sides.
      sideLift: 0.17,
      // Gentle x-variation so the cap isn't perfectly smooth/straight.
      noiseAmplitude: 0.05,
      noiseFrequency: 8.0,
      // Blend the cap in/out near the plateau edges (still preserves existing transitions).
      edgeBlendWidth: 0.0,
      seed: 18.37
    }),
    noise: Object.freeze({
      lowAmplitude: 0.008,
      lowFrequency: 6.0,
      highAmplitude: 0.02,
      highFrequency: 11.0,
      seed: 37.42
    }),
    smoothing: 1.1,
    texture: Object.freeze({
      image: '/game-assets/simulador/sand.png',
      tileWidthRatio: 0.24
    })
  }),
  sediment: Object.freeze({
    maxParticles: 55,
    emissionPerClick: 55,
    spawnOffset: 0.08,
    spawnJitterX: 0.04,
    bandSurfaceOffset: 0.05,
    bandDepth: 0.22,
    bandBaseJitter: 0.4,
    horizontalSpeed: 0.42,
    horizontalSpeedJitter: 0.25,
    verticalJitterAmplitude: 0.35,
    verticalJitterFrequencyMin: 0.7,
    verticalJitterFrequencyMax: 1.6,
    approachWindow: 0.12,
    approachLead: 0.22,
    arrivalThreshold: 0.008,
    dissolveSpeed: 0.3,
    depositRadius: 0.06,
    depositAmount: 0.012,
    particleSize: 0.03,
    minAlpha: 0.35
  }),
  seeds: Object.freeze({
    particlesPerPlant: 10,
    gravity: 0.9,
    burstHorizontalSpeed: 0.55,
    burstVerticalSpeed: 1.2,
    particleSize: 0.02,
    particleColor: '#4d3018',
    colonizers: Object.freeze([
      Object.freeze({
        id: 'aliso',
        label: 'Aliso',
        color: '#7dbf5d',
        width: 0.04,
        height: 0.18,
        growthRate: 0.55,
        assetName: 'aliso',
        spriteWidthMultiplier: 0.6,
        bottomMargin: 0.15,
        spriteStageMap: Object.freeze([0, 1, 1, 1, 1]),
        spriteTransitionMap: Object.freeze({ 0: true }),
        spriteTransitionFrames: Object.freeze({ 0: 5 })
      }),
      Object.freeze({
        id: 'sauce',
        label: 'Sauce',
        color: '#6eb48f',
        width: 0.036,
        height: 0.17,
        growthRate: 0.6,
        assetName: 'sauce',
        spriteWidthMultiplier: 1.1,
        bottomMargin: 0.15
      }),
      Object.freeze({
        id: 'ambigua',
        label: 'Ambigua',
        color: '#5d9d6d',
        width: 0.034,
        height: 0.15,
        growthRate: 0.58,
        assetName: 'ambigua',
        spriteWidthMultiplier: 0.7,
        bottomMargin: 0.15
      }),
      Object.freeze({
        id: 'distichlis',
        label: 'Paja Brava',
        color: '#4e7d5a',
        width: 0.03,
        height: 0.13,
        growthRate: 0.62,
        assetName: 'distichlis',
        spriteWidthMultiplier: 0.7,
        bottomMargin: 0.15
      })
    ]),
    nonColonizers: Object.freeze([
      Object.freeze({
        id: 'ceibo',
        label: 'Ceibo',
        color: '#b58b5a',
        width: 0.05,
        height: 0.24,
        growthRate: 0.45,
        assetName: 'ceibo',
        spriteWidthMultiplier: 1,
        bottomMargin: 0.15
      }),
      Object.freeze({
        id: 'drago',
        label: 'Drago',
        color: '#a8733d',
        width: 0.048,
        height: 0.22,
        growthRate: 0.48,
        assetName: 'drago',
        spriteWidthMultiplier: 1,
        bottomMargin: 0.15
      }),
      Object.freeze({
        id: 'acacia',
        label: 'Acacia',
        color: '#8b6a32',
        width: 0.052,
        height: 0.26,
        growthRate: 0.5,
        assetName: 'acacia',
        spriteWidthMultiplier: 0.8,
        bottomMargin: 0.15
      })
    ])
  }),
  interactions: Object.freeze({
    sedimentHeightEpsilon: 0.006,
    plantHeightEpsilon: 0.02,
    seedBurstHeightOffset: 0.06,
    plantSubmergeOffset: 0.0008,
    plantEmergenceOffset: 0.0008
  }),
  ui: Object.freeze({
    gap: 0.012,
    fontScale: 0.028,
    borderRadius: 0.035,
    shadowOpacity: 0.4,
    fonts: Object.freeze({
      fontKitHref: 'https://use.typekit.net/vmy8ypx.css',
      family: '"new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
    }),
    cursor: Object.freeze({
      diameterVW: 1.8,
      borderWidthVW: 0.14,
      transitionSeconds: 0.12
    }),
    goalMessage: Object.freeze({
      bottomOffsetVW: 7.0,
      fontSizeVW: 2.4,
      paddingVW: 1.1,
      maxWidthVW: 48,
      borderRadiusVW: 2.0,
      slideOffsetVW: 2.2,
      transitionSeconds: 0.35
    }),
    elements: Object.freeze({
      basePath: '/game-assets/simulador/UI',
      logo: Object.freeze({
        image: 'logo.png',
        leftPct: 91.1373,
        topPct: 86.5553,
        widthPct: 6.3922,
        heightPct: 11.2967,
        zIndex: 9
      }),
      sedimentButton: Object.freeze({
        image: 'sediment_button.png',
        leftPct: 75.8039,
        topPct: 87.2713,
        widthPct: 6.2353,
        heightPct: 7.8759,
        zIndex: 11
      }),
      removeButton: Object.freeze({
        image: 'remove_plant.png',
        leftPct: 84.1176,
        topPct: 84.1687,
        widthPct: 3.6471,
        heightPct: 13.6834,
        zIndex: 11
      }),
      seeder: Object.freeze({
        image: 'seeder.png',
        leftPct: 92.4314,
        topPct: 24.105,
        widthPct: 3.6471,
        heightPct: 59.2681,
        segments: 7,
        zIndex: 10,
        seedOrder: Object.freeze(['aliso', 'sauce', 'ambigua', 'distichlis', 'ceibo', 'drago', 'acacia']),
        seedImageScale: 0.5,
        label: Object.freeze({
          backgroundColor: '#b86f2d',
          textColor: '#ffffff',
          fontSizeVW: 1.1,
          paddingVW: 0.6,
          paddingVH: 0.35,
          borderRadiusVW: 0.6,
          rightGapVW: 0.8,
          transitionSeconds: 0.22,
          transitionEasing: 'cubic-bezier(0.33, 1, 0.68, 1)',
          opacityEasing: 'ease-out',
          hiddenOffsetVW: 1.2,
          maxWidthVW: 18,
          lineHeight: 1.1,
          shadow: '0 0 0.3vw rgba(0, 0, 0, 0.35)',
          fontWeight: 600,
          textTransform: 'none',
          fontFamily: '"new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
        })
      }),
      seedImages: Object.freeze({
        aliso: 'aliso.png',
        sauce: 'sauce.png',
        ambigua: 'ambigua.png',
        distichlis: 'distichlis.png',
        ceibo: 'ceibo.png',
        drago: 'drago.png',
        acacia: 'acacia.png'
      }),
      weather: Object.freeze({
        fps: 25,
        top: Object.freeze({
          folder: 'weather_top',
          framePrefix: 'weather_top_',
          frameDigits: 5,
          frameExtension: '.png',
          sheet: Object.freeze({
            file: 'weather_top/weather_top.webp',
            columns: 24,
            rows: 24,
            frameCount: 553,
            frameOffset: 50,
            frameWidth: 256,
            frameHeight: 144
          }),
          area: Object.freeze({
            leftPct: 87.3,
            topPct: 5,
            widthPct: 13.6157,
            heightPct: 15.5370,
            zIndex: 8
          }),
          frames: Object.freeze({
            low: 50,
            medium: 154,
            highTransitionStart: 233,
            highLoopStart: 233,
            highLoopEnd: 602
          })
        }),
        bottom: Object.freeze({
          folder: 'weather_bottom',
          framePrefix: 'weather_bottom_',
          frameDigits: 5,
          frameExtension: '.png',
          sheet: Object.freeze({
            file: 'weather_bottom/weather_bottom.webp',
            columns: 14,
            rows: 14,
            frameCount: 185,
            frameOffset: 50,
            frameWidth: 256,
            frameHeight: 144
          }),
          area: Object.freeze({
            leftPct: 87.3,
            topPct: 5,
            widthPct: 13.6157,
            heightPct: 15.5370,
            zIndex: 8
          }),
          frames: Object.freeze({
            low: 233,
            medium: 154,
            high: 51
          })
        })
      })
    })
  }),
  progress: Object.freeze({
    messageDuration: 5.5,
    messageFadeDuration: 0.6,
    messageGap: 1.2,
    victoryMessage: '¡Lograste equilibrar el ecosistema! Has ganado.',
    hintDurations: Object.freeze({
      showSeconds: 10,
      delaySeconds: 30
    }),
    stages: Object.freeze([
      Object.freeze({
        id: 'formation',
        name: 'Formación del banco de arena',
        introMessage: 'Formá el nuevo banco de arena depositando sedimentos.',
        completionMessage: 'La isla emergió sobre el agua: ¡nuevo hábitat disponible!',
        goal: Object.freeze({
          type: 'riverbedMaxHeight',
          epsilon: 0.002
        }),
        allowedSeedGroups: Object.freeze([]),
        hints: Object.freeze([
          'Formá el banco de arena depositando sedimentos.',
          'Elevá el banco hasta su altura máxima.',
          'Elevá el nivel del agua para tener más espacio y seguir depositando sedimentos.'
        ])
      }),
      Object.freeze({
        id: 'colonization',
        name: 'Colonización inicial',
        introMessage: 'Plantá las semillas colonizadoras para estabilizar el banco.',
        completionMessage: 'Las plantas colonizadoras echaron raíces y fijaron el suelo.',
        goal: Object.freeze({
          type: 'plantCounts',
          species: Object.freeze({
            aliso: 2,
            sauce: 2,
            ambigua: 2,
            distichlis: 2
          })
        }),
        allowedSeedGroups: Object.freeze(['colonizers']),
        hints: Object.freeze([
          'Estabilizá la isla sembrando las especies colonizadoras.',
          'En el Delta las plantas crecen cuando cambia el nivel del agua; probá modificar la altura del río.',
          'Si las plantas pasan mucho tiempo bajo el agua morirán; ¡mantené el nivel del agua bajo control!',
          'Plantá al menos una semilla de cada especie colonizadora y hacelas crecer hasta la etapa final.'
        ])
      }),
      Object.freeze({
        id: 'expansion',
        name: 'Expansión ecológica',
        introMessage: 'Incorporá nuevas especies para completar la comunidad.',
        completionMessage: 'La isla floreció con especies diversas: ecosistema en equilibrio.',
        goal: Object.freeze({
          type: 'plantCounts',
          species: Object.freeze({
            aliso: 2,
            sauce: 2,
            ambigua: 2,
            distichlis: 2,
            ceibo: 2,
            drago: 2,
            acacia: 2
          })
        }),
        allowedSeedGroups: Object.freeze(['colonizers', 'nonColonizers']),
        hints: Object.freeze([
          'Sumá especies no colonizadoras para construir un ecosistema complejo.',
          'Las plantas compiten por luz y nutrientes; usá la pala para liberar espacio cuando lo necesites.',
          'Necesitás al menos una planta madura de cada especie para completar el ecosistema.'
        ])
      })
    ])
  }),
  plantGrowth: Object.freeze({
    transitionDuration: 2.0,
    waterIntakeDuration: 5.0,
    geometrySegments: 20,
    stageScales: Object.freeze({
      seedRadius: 0.189,
      germWidth: 0.161,
      germHeight: 0.147,
      smallWidth: 0.231,
      smallHeight: 0.231,
      mediumWidth: 0.315,
      mediumHeight: 0.329,
      largeWidth: 0.42,
      largeHeight: 0.42
    }),
    visuals: Object.freeze({
      enableSprites: true,
      basePath: '/game-assets/simulador/plants/sheets',
      spriteWidthRatio: 0.105,
      bottomMargin: 0.15,
      transitionFps: 12,
      stageFps: 12,
      frameDigits: 3,
      frameExtension: '.webp',
      maxFramesPerClip: 240
    })
  }),
  plantCompetition: Object.freeze({
    neighborRadius: 0.02,
    minNeighbors: 2,
    minPlantDistance: 0.03
  })
});

export class SimuladorScene extends BaseScene {
  constructor(app) {
    super(app);
    this.name = 'simulador';

    this.params = DEFAULT_PARAMS;
    this.worldWidth = 1;
    this.worldHeight = this.params.world.top - this.params.world.bottom;
    this.worldBottom = this.params.world.bottom;
    this.worldTop = this.params.world.top;

    this._waterLevels = {
      low: this.params.water.baseLevel - this.params.water.levelDelta,
      medium: this.params.water.baseLevel,
      high: this.params.water.baseLevel + this.params.water.levelDelta
    };
    this._currentWaterLevel = this._waterLevels.low;
    this._targetWaterLevel = this._currentWaterLevel;
    this._waterLevelIndex = 0; // 0 low, 1 medium, 2 high

    this._elapsed = 0;
    this._noise = new SimplexNoise();
    this._noise2D = this._resolveNoise2D(this._noise);

    this._waterStrip = null;
    this._riverbedStrip = null;
    this._averageLine = null;
    this._waterHeights = [];
    this._riverbedHeights = [];
    this._riverbedBase = [];
    this._riverbedDirty = true;

    this._particles = [];
    this._particlePositions = null;
    this._particleAlphas = null;
    this._particleAges = null;
    this._particlesGeometry = null;
    this._particlesPoints = null;
    this._activeParticles = 0;

    this._seedEffectMaterial = null;
    this._seedEffectGroup = null;

    this._uiRoot = null;
    this._buttons = {};
    this._seedButtons = {};
    this._activeTool = null;
    this._pointerDown = false;
    this._cursorEl = null;
    this._lastPointerInfo = null;
    this._goalMessageEl = null;
    this._originalCanvasCursor = null;

    this._availableSeedIds = new Set();
    this._seedCatalog = new Map();
    this._plantGeometryCache = new Map();
    this._seedMaterialCache = new Map();
    this._plantSequenceCache = new Map();
    this._plantMaterialCache = new Map();
    this._removeEnabled = false;
    this._sedimentEnabled = true;

    this._audioTimers = new Set();
    this._ambientAudio = null;
    this._transientAudios = new Set();
    this._sedimentAudio = null;
    this._sedimentSoundPlaying = false;
    this._sedimentSoundPending = false;

    this._background = null;
    this._backgroundTexture = null;
    this._cloudGroup = null;
    this._clouds = [];
    this._cloudTextures = new Map();
    this._cloudSpawnTimer = 0;
    this._competitionTimer = 0;
    this._sandTexture = null;
    this._sandTileRatio = this.params.riverbed?.texture?.tileWidthRatio ?? 0.1;

    this._seedBursts = [];

    this._plants = [];
    this._plantStages = [
      { id: 'seed', nextRequiresSubmerged: true },
      { id: 'germinated', nextRequiresSubmerged: false },
      { id: 'small', nextRequiresSubmerged: true },
      { id: 'medium', nextRequiresSubmerged: false },
      { id: 'large', nextRequiresSubmerged: null }
    ];

    this._textureLoader = new THREE.TextureLoader();
    this._unitPlantPlane = new THREE.PlaneGeometry(1, 1);
  this._cloudUnitPlane = new THREE.PlaneGeometry(1, 1);

    this._messageEl = null;
    this._messageTimer = null;
    this._messageHideTimer = null;
    this._stageAdvanceTimer = null;
    this._hintCycle = null;
    this._hintShowTimer = null;
    this._hintDelayTimer = null;
    this._goalMessageHideTimer = null;
    this._goalMessageTransition = null;
    this._goalMessageTransitionDurationMs = 0;
    this._goalMessageHiddenTransform = 'translate(-50%, 2vw)';
    this._goalMessageVisibleTransform = 'translate(-50%, 0)';

    this._stages = this.params.progress.stages;
    this._currentStageIndex = 0;
    this._stageComplete = false;

    this._weatherConfig = null;
    this._weatherChannels = {};
    this._weatherAnimations = {};
    this._weatherTransitionPromise = Promise.resolve();
    this._weatherState = 'low';
    this._weatherCurrentFrame = { top: null, bottom: null };
    this._uiAssetBasePath = this.params.ui?.elements?.basePath || '';
    this._uiFontFamily = null;
    this._loadingOverlay = null;
    this._loadingOverlayHideTimer = null;
    this._loadingLogoUrl = null;
    this._isReady = false;
    this._uiRectEntries = [];
    this._uiLogoEl = null;
    this._onUiLogoPointerUp = (event) => {
      event.preventDefault();
      event.stopPropagation();
      triggerPauseMenuOverlay();
    };

    this._depthMeter = null;

    this._tutorial = { active: false, paused: false, queue: [], current: null };
    this._tutorialCompleted = new Set();
    this._tutorialOverlay = null;
    this._tutorialDimmer = null;
    this._tutorialSpotlight = null;
    this._tutorialCard = null;
    this._tutorialText = null;
    this._tutorialButton = null;
    this._pendingStageIntroText = '';

    this._boundOnPointerDown = (e) => this._handlePointerDown(e);
    this._boundOnPointerMove = (e) => this._handlePointerMove(e);
    this._boundOnPointerUp = () => { this._pointerDown = false; };
    this._boundOnPointerLeave = () => this._handlePointerLeave();
    this._boundPreventSelection = (e) => e.preventDefault();
  }

  async mount() {
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

    this._isReady = false;
    this._showLoadingOverlay();

    let initialized = false;
    try {
      await this._preloadCriticalAssets();

      // Replace default camera with orthographic for side-view 2D layout.
      const { top, bottom, cameraZ } = this.params.world;
      this.worldHeight = top - bottom;
      this.worldBottom = bottom;
      this.worldTop = top;

      this.camera = new THREE.OrthographicCamera(0, 1, top, bottom, -10, 20);
      this.camera.position.set(0, 0, cameraZ);
      this.camera.lookAt(new THREE.Vector3(0, 0, 0));

      this.scene = new THREE.Scene();

      this._createBackground();
      this._createRiverbed();
      this._createWater();
      this._createAverageLine();
      this._createSedimentSystem();
      this._createSeedEffectSystem();
      this._createUI();
  this._initAudio();
      this._initProgression();
      this._bindEvents();

      this.onResize(this.app.root.clientWidth, this.app.root.clientHeight);

      initialized = true;
      this._isReady = true;
    } finally {
      this._hideLoadingOverlay(!initialized);
    }
  }

  async unmount() {
    this._isReady = false;
    this._hideLoadingOverlay(true);
    this._unbindEvents();
    this._disposeAudio();
    this._destroyUI();
    this._clearMessageTimer();
    this._clearStageAdvanceTimer();
    this._disposeObjects();
  }

  update(dt) {
    this._elapsed += dt;
    if (!this._isReady) return;
    if (this._tutorial?.paused) {
      return;
    }

    const smoothing = this.params.water.smoothing;
    this._currentWaterLevel = THREE.MathUtils.damp(
      this._currentWaterLevel,
      this._targetWaterLevel,
      smoothing,
      dt
    );

    this._updateWater();
  this._updateAverageLine();
    this._updateClouds(dt);
    this._updateRain(dt);

    // Sky Color Lerp
    if (this._background && this._skyTargetTopColor) {
        const lerpFactor = dt * 0.5;
        this._skyCurrentTopColor.lerp(this._skyTargetTopColor, lerpFactor);
        this._skyCurrentBottomColor.lerp(this._skyTargetBottomColor, lerpFactor);
    }

    this._updateRiverbed();
    this._updateSediment(dt);
    this._updateSeedBursts(dt);
    this._updatePlants(dt);
    if (this._lastPointerInfo) {
      this._refreshCursor();
    }

    this._updateDepthMeterPointer();
  }

  onResize(width, height) {
    if (!width || !height) return;

    const prevWidth = this.worldWidth || 1;
    const aspect = width / height;
    this.worldHeight = this.params.world.top - this.params.world.bottom;
    this.worldWidth = this.worldHeight * aspect;

    this.camera.left = 0;
    this.camera.right = this.worldWidth;
    this.camera.top = this.params.world.top;
    this.camera.bottom = this.params.world.bottom;
    this.camera.updateProjectionMatrix();

    this._layoutBackground();
    this._layoutWater();
    this._layoutRiverbed();
    this._layoutAverageLine();
    this._updateUILayout(width, height);
    this._updateWater();
    this._riverbedDirty = true;
    this._updateRiverbed();
    for (let i = 0; i < this._plants.length; i++) {
      const plant = this._plants[i];
      this._alignPlantToRiverbed(plant);
      this._refreshPlantVisual(plant);
    }
    this._updateParticleSize(width, height);
    this._updateSeedEffectSize(width, height);
    this._resizeClouds(prevWidth);
  }

  _createBackground() {
    const { world, colors, sky } = this.params;
    const topColor = sky?.gradientTopColor || colors.skyTop || '#8ecae6';
    const bottomColor = sky?.gradientBottomColor || colors.skyBottom || '#e3f1ff';

    this._skyBaseTopColor = new THREE.Color(topColor);
    this._skyBaseBottomColor = new THREE.Color(bottomColor);
    this._skyGrayTopColor = new THREE.Color('#a0aab5'); 
    this._skyGrayBottomColor = new THREE.Color('#d0d5d9');

    this._skyTargetTopColor = this._skyBaseTopColor.clone();
    this._skyTargetBottomColor = this._skyBaseBottomColor.clone();
    
    this._skyCurrentTopColor = this._skyBaseTopColor.clone();
    this._skyCurrentBottomColor = this._skyBaseBottomColor.clone();

    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: this._skyCurrentTopColor },
        bottomColor: { value: this._skyCurrentBottomColor }
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        void main(){
          float t = smoothstep(0.0, 1.0, vUv.y);
          vec3 col = mix(bottomColor, topColor, t);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false
    });

    this._background = new THREE.Mesh(geometry, material);
    this._background.renderOrder = -100;
    this._background.position.z = world.backgroundZ;
    this.scene.add(this._background);

    this._layoutBackground();
    this._createCloudSystem();
    this._createRainSystem();
  }

  _layoutBackground() {
    if (!this._background) return;
    const width = this.worldWidth;
    const height = this.worldHeight;

    let scaleX = width;
    let scaleY = height;
    const texture = this._backgroundTexture;
    const texWidth = texture?.image?.width;
    const texHeight = texture?.image?.height;
    if (texWidth && texHeight) {
      const texRatio = texWidth / texHeight;
      const viewRatio = width / height;
      if (viewRatio > texRatio) {
        scaleX = width;
        scaleY = width / texRatio;
      } else {
        scaleY = height;
        scaleX = height * texRatio;
      }
    }

    this._background.scale.set(scaleX, scaleY, 1);
    this._background.position.set(
      width * 0.5,
      (this.worldTop + this.worldBottom) * 0.5,
      this.params.world.backgroundZ
    );
  }

  _createCloudSystem() {
    const config = this.params.sky?.clouds;
    if (!config?.enabled) return;
    if (!this._cloudUnitPlane) {
      this._cloudUnitPlane = new THREE.PlaneGeometry(1, 1);
    }
    if (!this._cloudGroup) {
      this._cloudGroup = new THREE.Group();
      this._cloudGroup.position.z = typeof config.depth === 'number'
        ? config.depth
        : (this.params.world.backgroundZ + 0.01);
      this.scene.add(this._cloudGroup);
    }
    this._clouds = [];
    this._cloudTargetCount = 3; // Baseline count
    this._cloudTargetColor = new THREE.Color(1, 1, 1);

    // Pre-spawn initial clouds
    if (this._cloudTextures.size > 0) {
        for (let i = 0; i < this._cloudTargetCount; i++) {
            this._spawnCloud({ position: 'random', opacity: 1 });
        }
    }
  }

  _createRainSystem() {
    const dropCount = 1000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(dropCount * 2 * 3); // 2 vertices per drop
    
    this._rainVelocities = [];
    const angle = 0.15; // Slight angle
    const len = 0.08; // Length of the drop

    for (let i = 0; i < dropCount; i++) {
      const x = (Math.random() - 0.5) * this.worldWidth * 2.5; // Wider area to cover angled fall
      const y = (Math.random() - 0.5) * this.worldHeight * 2;
      const z = 0.5;
      
      const speed = 2.5 + Math.random() * 1.0;
      const vx = Math.sin(angle) * speed;
      const vy = -Math.cos(angle) * speed;
      
      this._rainVelocities.push({ x: vx, y: vy });

      // Vertex 1 (Head)
      positions[i * 6 + 0] = x;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = z;

      // Vertex 2 (Tail) - behind the head
      positions[i * 6 + 3] = x - Math.sin(angle) * len;
      positions[i * 6 + 4] = y + Math.cos(angle) * len;
      positions[i * 6 + 5] = z;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0xaaccff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    });

    this._rainSystem = new THREE.LineSegments(geometry, material);
    this._rainSystem.visible = false;
    this.scene.add(this._rainSystem);
  }

  _resetCloudSpawnTimer() {
    const config = this.params.sky?.clouds;
    if (!config) return;
    const base = Math.max(0.1, this._currentCloudSpawnInterval);
    const jitter = Math.max(0, config.spawnIntervalJitter ?? 0);
    const offset = jitter > 0 ? (Math.random() - 0.5) * jitter : 0;
    this._cloudSpawnTimer = Math.max(0.1, base + offset);
  }

  _pickRandomCloudTexture() {
    if (!this._cloudTextures.size) return null;
    const textures = Array.from(this._cloudTextures.values()).filter(Boolean);
    if (!textures.length) return null;
    const index = Math.floor(Math.random() * textures.length);
    return textures[index] || null;
  }

  _spawnCloud(options = {}) {
    const { position = 'edge', opacity = 1, fadeIn = false } = options;
    const config = this.params.sky?.clouds;
    if (!config?.enabled || !this._cloudGroup || !this._cloudUnitPlane) return false;
    if (!this._cloudTextures.size) return false;
    const texture = this._pickRandomCloudTexture();
    if (!texture) return false;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      color: this._cloudTargetColor ? this._cloudTargetColor.clone() : new THREE.Color(1, 1, 1),
      opacity: opacity
    });

    const mesh = new THREE.Mesh(this._cloudUnitPlane, material);
    mesh.renderOrder = -95;
    mesh.frustumCulled = false;

    const direction = Math.random() < 0.5 ? 1 : -1;
    const baseScale = config.baseScale ?? 0.4;
    const scaleVariance = config.scaleVariance ?? 0;
    const sizeNorm = Math.max(0.05, baseScale + (Math.random() - 0.5) * 2 * scaleVariance);
    const width = sizeNorm * this.worldWidth;
  const image = texture.image;
  const texWidth = image?.width ? Math.max(1, image.width) : null;
  const aspect = texWidth ? (image?.height || texWidth) / texWidth : 0.5;
    const height = width * aspect;
    mesh.scale.set(width, height, 1);

    const spawnOffsetNorm = config.spawnOffset ?? config.despawnMargin ?? 0.2;
    const marginNorm = config.despawnMargin ?? 0.2;
    const offset = spawnOffsetNorm * this.worldWidth;
    const halfWidth = width * 0.5;
    
    let startX;
    if (position === 'random') {
        startX = (Math.random() * 1.2 - 0.1) * this.worldWidth;
    } else {
        startX = direction > 0
          ? -offset - halfWidth
          : this.worldWidth + offset + halfWidth;
    }

    const range = Array.isArray(config.verticalRange) && config.verticalRange.length >= 2
      ? config.verticalRange
      : [0.6, 0.9];
    const minNorm = clamp(Math.min(range[0], range[1]), 0, 1);
    const maxNorm = clamp(Math.max(range[0], range[1]), 0, 1);
    const yNorm = lerp(minNorm, maxNorm, Math.random());
    const posY = this.worldBottom + yNorm * this.worldHeight;

    mesh.position.set(startX, posY, 0);

    const baseSpeed = config.baseSpeed ?? 0.03;
    const speedVariance = config.speedVariance ?? 0;
    const speedNorm = Math.max(0.002, baseSpeed + (Math.random() - 0.5) * 2 * speedVariance);

    const cloud = {
      mesh,
      direction,
      speedNorm,
      widthNorm: width / this.worldWidth,
      positionNorm: startX / this.worldWidth,
      marginNorm,
      aspect: aspect || 0.5,
      dying: false,
      fadeIn: fadeIn,
      targetOpacity: 1
    };

    this._cloudGroup.add(mesh);
    this._clouds.push(cloud);
    return true;
  }

  _removeCloud(index) {
    const cloud = this._clouds[index];
    if (!cloud) return;
    if (cloud.mesh) {
      this._cloudGroup.remove(cloud.mesh);
      const material = cloud.mesh.material;
      if (material) {
        material.dispose?.();
      }
    }
    this._clouds.splice(index, 1);
  }

  _updateClouds(dt) {
    if (!this._clouds) return;
    
    // Animate color
    if (this._cloudTargetColor) {
        const lerpFactor = dt * 2.0;
        for (let i = 0; i < this._clouds.length; i++) {
            const cloud = this._clouds[i];
            if (cloud.mesh && cloud.mesh.material) {
                cloud.mesh.material.color.lerp(this._cloudTargetColor, lerpFactor);
            }
        }
    }

    const config = this.params.sky?.clouds;
    if (!config?.enabled || !this._cloudGroup) return;

    // Maintenance: Ensure we have enough active clouds
    const activeClouds = this._clouds.filter(c => !c.dying);
    if (activeClouds.length < this._cloudTargetCount) {
        const diff = this._cloudTargetCount - activeClouds.length;
        for (let i = 0; i < diff; i++) {
            // Replacement clouds spawn at edge, fully opaque
            this._spawnCloud({ position: 'edge', opacity: 1 });
        }
    }

    if (!this._clouds.length) return;

    const worldWidth = this.worldWidth;
    const removals = [];

    for (let i = 0; i < this._clouds.length; i++) {
      const cloud = this._clouds[i];
      const mesh = cloud.mesh;
      if (!mesh) {
        removals.push(i);
        continue;
      }

      // Opacity Animation
      if (cloud.dying) {
          mesh.material.opacity -= dt; // Fade out over ~1s
          if (mesh.material.opacity <= 0) {
              removals.push(i);
              continue;
          }
      } else if (cloud.fadeIn) {
          mesh.material.opacity += dt; // Fade in over ~1s
          if (mesh.material.opacity >= 1) {
              mesh.material.opacity = 1;
              cloud.fadeIn = false;
          }
      }

      const delta = cloud.speedNorm * worldWidth * dt * cloud.direction;
      mesh.position.x += delta;
      cloud.positionNorm = mesh.position.x / worldWidth;

      const width = cloud.widthNorm * worldWidth;
      const halfWidth = width * 0.5;
      const margin = (cloud.marginNorm ?? 0.2) * worldWidth;

      if (cloud.direction > 0) {
        if (mesh.position.x - halfWidth > worldWidth + margin) {
          removals.push(i);
        }
      } else {
        if (mesh.position.x + halfWidth < -margin) {
          removals.push(i);
        }
      }
    }

    // Sort removals descending to avoid index shifting issues
    removals.sort((a, b) => b - a);
    // Remove duplicates
    const uniqueRemovals = [...new Set(removals)];

    if (uniqueRemovals.length) {
      for (let i = 0; i < uniqueRemovals.length; i++) {
        this._removeCloud(uniqueRemovals[i]);
      }
    }
  }

  _updateRain(dt) {
    if (!this._rainSystem || !this._rainSystem.visible) return;

    const positions = this._rainSystem.geometry.attributes.position.array;
    const count = this._rainVelocities.length;
    const bottomLimit = this.worldBottom - 0.5;
    const topReset = this.worldTop + 0.5;
    const widthReset = this.worldWidth * 2.5;
    const angle = 0.15;
    const len = 0.08;

    for (let i = 0; i < count; i++) {
      const vel = this._rainVelocities[i];
      
      // Update Head
      positions[i * 6 + 0] += vel.x * dt;
      positions[i * 6 + 1] += vel.y * dt;
      
      // Update Tail
      positions[i * 6 + 3] += vel.x * dt;
      positions[i * 6 + 4] += vel.y * dt;

      // Reset if below screen
      if (positions[i * 6 + 1] < bottomLimit) {
        const newX = (Math.random() - 0.5) * widthReset;
        const newY = topReset + Math.random() * 0.5;
        
        positions[i * 6 + 0] = newX;
        positions[i * 6 + 1] = newY;
        
        positions[i * 6 + 3] = newX - Math.sin(angle) * len;
        positions[i * 6 + 4] = newY + Math.cos(angle) * len;
      }
    }

    this._rainSystem.geometry.attributes.position.needsUpdate = true;
  }

  _resizeClouds(prevWidth) {
    if (!this._clouds?.length || !prevWidth) return;
    const worldWidth = this.worldWidth;
    for (let i = 0; i < this._clouds.length; i++) {
      const cloud = this._clouds[i];
      const mesh = cloud.mesh;
      if (!mesh) continue;
      const width = cloud.widthNorm * worldWidth;
      const height = width * cloud.aspect;
      mesh.scale.set(width, height, 1);
      mesh.position.x = cloud.positionNorm * worldWidth;
      cloud.positionNorm = mesh.position.x / worldWidth;
    }
  }

  _createWater() {
    const { water, colors } = this.params;
    const segments = water.surfaceSegments;

    const { geometry, topIndices, bottomIndices } = this._buildStripGeometry(segments);
    geometry.setAttribute('position', geometry.getAttribute('position'));
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        colorSurface: { value: new THREE.Color(colors.waterSurface) },
        colorDeep: { value: new THREE.Color(colors.waterDeep) },
        colorHighlight: { value: new THREE.Color(colors.waterHighlight) },
        opacity: { value: water.opacity }
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vDepth;
        void main(){
          vUv = uv;
          vDepth = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying float vDepth;
        uniform vec3 colorSurface;
        uniform vec3 colorDeep;
        uniform vec3 colorHighlight;
        uniform float opacity;
        void main(){
          float t = pow(1.0 - vUv.y, 1.4);
          vec3 base = mix(colorDeep, colorSurface, t);
          float highlight = smoothstep(0.92, 1.0, 1.0 - vUv.y);
          vec3 col = mix(base, colorHighlight, highlight * 0.45);
          gl_FragColor = vec4(col, opacity);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    this._waterStrip = {
      mesh: new THREE.Mesh(geometry, material),
      geometry,
      topIndices,
      bottomIndices,
      bottomY: water.bottom
    };
    this._waterStrip.mesh.renderOrder = 3;
    this.scene.add(this._waterStrip.mesh);

    this._waterHeights = new Float32Array(segments + 1);
  }

  _layoutWater() {
    if (!this._waterStrip) return;
    const { geometry, topIndices, bottomIndices } = this._waterStrip;
    const positions = geometry.attributes.position.array;
    const segments = this.params.water.surfaceSegments;
    const bottomY = this.params.water.bottom;

    for (let i = 0; i <= segments; i++) {
      const x = this.worldWidth * (i / segments);

      const topIndex = topIndices[i] * 3;
      const bottomIndex = bottomIndices[i] * 3;

      positions[topIndex + 0] = x;
      positions[topIndex + 2] = 0;
      positions[bottomIndex + 0] = x;
      positions[bottomIndex + 1] = bottomY;
      positions[bottomIndex + 2] = 0;
    }

    geometry.attributes.position.needsUpdate = true;
  }

  _updateWater() {
    if (!this._waterStrip) return;
    const { geometry, topIndices } = this._waterStrip;
    const positions = geometry.attributes.position.array;
    const segments = this.params.water.surfaceSegments;
    const time = this._elapsed;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = this.worldWidth * t;
      const height = this._sampleWaterHeight(t, time);
      this._waterHeights[i] = height;

      const idx = topIndices[i] * 3;
      positions[idx + 0] = x;
      positions[idx + 1] = height;
      positions[idx + 2] = 0;
    }

    geometry.attributes.position.needsUpdate = true;
  }

  _sampleWaterHeight(t, time) {
    const { wave } = this.params.water;
    const level = this._currentWaterLevel;

    const wave1 = Math.sin(t * wave.primaryFrequency + time * wave.primarySpeed) * wave.primaryAmplitude;
    const wave2 = Math.sin(t * wave.secondaryFrequency - time * wave.secondarySpeed * 0.9 + 1.1) * wave.secondaryAmplitude;
    const wave3 = Math.sin(t * wave.tertiaryFrequency * 0.5 + time * wave.tertiarySpeed * 1.4) * wave.tertiaryAmplitude;
    const chop = Math.sin((t + time * 0.4) * wave.secondaryFrequency * 0.9) * wave.chop * 0.5;
    const noise = this._noise2D(t * wave.noiseScale + time * 0.1, time * wave.noiseSpeed) * wave.noiseAmplitude;

    return level + wave1 + wave2 + wave3 + chop + noise;
  }

  _resolveNoise2D(noiseSource) {
    if (noiseSource && typeof noiseSource.noise2D === 'function') {
      return (x, y) => noiseSource.noise2D(x, y);
    }
    if (noiseSource && typeof noiseSource.noise === 'function') {
      return (x, y) => noiseSource.noise(x, y, 0);
    }
    if (noiseSource && typeof noiseSource.noise3d === 'function') {
      return (x, y) => noiseSource.noise3d(x, y, 0);
    }
    if (noiseSource && typeof noiseSource.noise3D === 'function') {
      return (x, y) => noiseSource.noise3D(x, y, 0);
    }
    return () => 0;
  }

  _createAverageLine() {
    const segments = this.params.water.surfaceSegments;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((segments + 1) * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);

    const averageCfg = this.params.water.averageLine || {};
    const avgColor = averageCfg.color || this.params.colors.waterAverageLine;
    const material = new THREE.LineDashedMaterial({
      color: new THREE.Color(avgColor || '#f5d06d'),
      linewidth: 1,
      transparent: true,
      opacity: averageCfg.opacity ?? 1,
      dashSize: Math.max(1e-4, averageCfg.dashSize ?? 0.035),
      gapSize: Math.max(1e-4, averageCfg.gapSize ?? 0.02)
    });
    material.needsUpdate = true;

    this._averageLine = new THREE.Line(geometry, material);
    this._averageLine.renderOrder = 4;
    this.scene.add(this._averageLine);
    this._updateAverageLineGeometry(0);
  }

  _layoutAverageLine() {
    this._updateAverageLineGeometry(this._elapsed);
  }

  _updateAverageLine() {
    this._updateAverageLineGeometry(this._elapsed);
  }

  _updateAverageLineGeometry(time = 0) {
    if (!this._averageLine) return;
    const geometry = this._averageLine.geometry;
    const positionsAttr = geometry?.attributes?.position;
    if (!positionsAttr) return;
    const positions = positionsAttr.array;
    const segments = this.params.water.surfaceSegments;

    for (let i = 0; i <= segments; i++) {
      const t = segments > 0 ? (i / segments) : 0;
      const x = t * this.worldWidth;
      const y = this._sampleAverageLineHeight(t, time);
      const idx = i * 3;
      positions[idx + 0] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = 0.01;
    }

    positionsAttr.needsUpdate = true;
    if (typeof this._averageLine.computeLineDistances === 'function') {
      this._averageLine.computeLineDistances();
    }
    geometry.computeBoundingSphere?.();
  }

  _sampleAverageLineHeight(t, time) {
    const averageCfg = this.params.water.averageLine || {};
    const medium = this._waterLevels.medium;
    let height = medium;

    const baseAmplitude = averageCfg.baseAmplitude ?? 0;
    const baseFrequency = averageCfg.baseFrequency ?? 6.5;
    const baseSpeed = averageCfg.baseSpeed ?? 0.4;
    if (baseAmplitude !== 0) {
      height += Math.sin(t * baseFrequency + time * baseSpeed) * baseAmplitude;
    }

    const waves = Array.isArray(averageCfg.waves) ? averageCfg.waves : [];
    for (let i = 0; i < waves.length; i++) {
      const wave = waves[i];
      if (!wave) continue;
      const amp = wave.amplitude ?? 0;
      if (amp === 0) continue;
      const freq = wave.frequency ?? 0;
      const speed = wave.speed ?? 0;
      height += Math.sin(t * freq + time * speed + i * 0.47) * amp;
    }

    const noiseAmplitude = averageCfg.noiseAmplitude ?? 0;
    if (noiseAmplitude !== 0) {
      const scale = averageCfg.noiseScale ?? 1;
      const speed = averageCfg.noiseSpeed ?? 1;
      height += this._noise2D(t * scale + 19.17, time * speed + 7.31) * noiseAmplitude;
    }

    return height;
  }

  _createRiverbed() {
    const { riverbed } = this.params;
    const segments = riverbed.segments;
    const { geometry, topIndices, bottomIndices } = this._buildStripGeometry(segments);
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);

    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });

    this._riverbedStrip = {
      mesh: new THREE.Mesh(geometry, material),
      geometry,
      topIndices,
      bottomIndices
    };
    this._riverbedStrip.mesh.position.z = -0.05;
    this.scene.add(this._riverbedStrip.mesh);

    const texturePath = riverbed.texture?.image;
    if (this._sandTexture) {
      this._prepareTexture(this._sandTexture);
      this._sandTexture.wrapS = THREE.RepeatWrapping;
      this._sandTexture.wrapT = THREE.RepeatWrapping;
      this._sandTexture.needsUpdate = true;
      material.map = this._sandTexture;
      material.needsUpdate = true;
      this._updateRiverbedUVs();
    } else if (texturePath) {
      if (!this._textureLoader) {
        this._textureLoader = new THREE.TextureLoader();
      }
      this._sandTexture = this._textureLoader.load(
        texturePath,
        () => {
          this._prepareTexture(this._sandTexture);
          if (this._sandTexture) {
            this._sandTexture.wrapS = THREE.RepeatWrapping;
            this._sandTexture.wrapT = THREE.RepeatWrapping;
            this._sandTexture.needsUpdate = true;
          }
          this._updateRiverbedUVs();
          if (this._riverbedStrip?.mesh?.material) {
            this._riverbedStrip.mesh.material.needsUpdate = true;
          }
        }
      );
      if (this._sandTexture) {
        this._sandTexture.wrapS = THREE.RepeatWrapping;
        this._sandTexture.wrapT = THREE.RepeatWrapping;
        this._sandTexture.needsUpdate = true;
        material.map = this._sandTexture;
        material.needsUpdate = true;
      }
    }

    this._riverbedHeights = new Float32Array(segments + 1);
    this._riverbedBase = new Float32Array(segments + 1);
    this._initializeRiverbed();
  }

  _layoutRiverbed() {
    if (!this._riverbedStrip) return;
    const { geometry, topIndices, bottomIndices } = this._riverbedStrip;
    const positions = geometry.attributes.position.array;
    const segments = this.params.riverbed.segments;
    const bottom = this.params.riverbed.bottom;

    for (let i = 0; i <= segments; i++) {
      const x = this.worldWidth * (i / segments);
      const topIdx = topIndices[i] * 3;
      const bottomIdx = bottomIndices[i] * 3;

      positions[topIdx + 0] = x;
      positions[topIdx + 1] = this._riverbedHeights[i];
      positions[topIdx + 2] = 0;

      positions[bottomIdx + 0] = x;
      positions[bottomIdx + 1] = bottom;
      positions[bottomIdx + 2] = 0;
    }

    geometry.attributes.position.needsUpdate = true;
    this._updateRiverbedUVs();
  }

  _updateRiverbedUVs() {
    if (!this._riverbedStrip) return;
    const { geometry, topIndices, bottomIndices } = this._riverbedStrip;
    const uvsAttr = geometry.attributes.uv;
    if (!uvsAttr) return;
    const positions = geometry.attributes.position.array;
    const uvs = uvsAttr.array;
    const tileRatio = Math.max(1e-4, this._sandTileRatio || 0.1);
    const tileSize = Math.max(1e-4, this.worldWidth * tileRatio);
    const bedBottom = this.params.riverbed.bottom;
    const segments = this.params.riverbed.segments;

    for (let i = 0; i <= segments; i++) {
      const topIndex = topIndices[i];
      const bottomIndex = bottomIndices[i];
      const topPosIdx = topIndex * 3;
      const bottomPosIdx = bottomIndex * 3;
      const topUvIdx = topIndex * 2;
      const bottomUvIdx = bottomIndex * 2;

      const topX = positions[topPosIdx + 0];
      const topY = positions[topPosIdx + 1];
      const bottomX = positions[bottomPosIdx + 0];
      const bottomY = positions[bottomPosIdx + 1];

      uvs[topUvIdx + 0] = topX / tileSize;
      uvs[topUvIdx + 1] = (topY - bedBottom) / tileSize;
      uvs[bottomUvIdx + 0] = bottomX / tileSize;
      uvs[bottomUvIdx + 1] = (bottomY - bedBottom) / tileSize;
    }

    uvsAttr.needsUpdate = true;
  }

  _initializeRiverbed() {
    const { riverbed } = this.params;
    const segments = riverbed.segments;
    const plateauStartRaw = clamp(riverbed.plateauStart ?? 0.2, 0, 1);
    const plateauEndRaw = clamp(riverbed.plateauEnd ?? 0.8, 0, 1);
    const plateauStart = Math.min(plateauStartRaw, plateauEndRaw);
    const plateauEnd = Math.max(plateauStartRaw, plateauEndRaw);
    const transitionWidth = Math.max(0.0001, riverbed.transitionWidth ?? 0.1);
    const halfTransition = transitionWidth * 0.5;
    const riseStart = clamp(plateauStart - halfTransition, 0, 1);
    const riseEnd = clamp(plateauStart + halfTransition, 0, 1);
    const fallStart = clamp(plateauEnd - halfTransition, 0, 1);
    const fallEnd = clamp(plateauEnd + halfTransition, 0, 1);

    const lowBaseline = riverbed.baseHeight ?? 0;
    const highBaseline = typeof riverbed.highBaseline === 'number'
      ? riverbed.highBaseline
      : lowBaseline + (riverbed.moundHeight ?? 0);
    const noise = riverbed.noise ?? {};
    const lowAmp = noise.lowAmplitude ?? 0;
    const lowFreq = noise.lowFrequency ?? 1;
    const highAmp = noise.highAmplitude ?? 0;
    const highFreq = noise.highFrequency ?? 1;
    const seed = noise.seed ?? 0;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const lowNoise = this._noise2D(t * lowFreq, seed) * lowAmp;
      const highNoise = this._noise2D(t * highFreq, seed + 100) * highAmp;

      let blend = 0;
      if (t <= riseStart) {
        blend = 0;
      } else if (t < riseEnd) {
        blend = smoothstep(riseStart, riseEnd, t);
      } else if (t <= fallStart) {
        blend = 1;
      } else if (t < fallEnd) {
        blend = 1 - smoothstep(fallStart, fallEnd, t);
      }

      const targetHeight = lerp(lowBaseline, highBaseline, blend);
      const noiseMix = lerp(lowNoise, highNoise, blend);
      const height = clamp(targetHeight + noiseMix, riverbed.bottom, riverbed.maxHeight);
      this._riverbedHeights[i] = height;
      this._riverbedBase[i] = height;
    }
    this._riverbedDirty = true;
  }

  _updateRiverbed() {
    if (!this._riverbedDirty || !this._riverbedStrip) return;
    const { geometry, topIndices } = this._riverbedStrip;
    const positions = geometry.attributes.position.array;
    const segments = this.params.riverbed.segments;

    for (let i = 0; i <= segments; i++) {
      const idx = topIndices[i] * 3;
      positions[idx + 1] = this._riverbedHeights[i];
    }

    geometry.attributes.position.needsUpdate = true;
    this._updateRiverbedUVs();
    this._riverbedDirty = false;
  }

  _createSedimentSystem() {
    const { sediment, colors } = this.params;
    const max = sediment.maxParticles;

    const geometry = new THREE.BufferGeometry();
    this._particlePositions = new Float32Array(max * 3);
    this._particleAlphas = new Float32Array(max);
    geometry.setAttribute('position', new THREE.BufferAttribute(this._particlePositions, 3));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this._particleAlphas, 1));
    geometry.getAttribute('position').setUsage(THREE.DynamicDrawUsage);
    geometry.getAttribute('alpha').setUsage(THREE.DynamicDrawUsage);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        colorA: { value: new THREE.Color(colors.sedimentParticle) },
        colorB: { value: new THREE.Color(colors.sedimentShadow) },
        size: { value: sediment.particleSize },
        minAlpha: { value: sediment.minAlpha }
      },
      vertexShader: `
        uniform float size;
        attribute float alpha;
        varying float vAlpha;
        void main(){
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = size;
        }
      `,
      fragmentShader: `
        uniform vec3 colorA;
        uniform vec3 colorB;
        uniform float minAlpha;
        varying float vAlpha;
        void main(){
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float r = dot(uv, uv);
          if (r > 1.0) discard;
          float shade = smoothstep(1.0, 0.0, r);
          vec3 col = mix(colorB, colorA, shade);
          float alpha = max(minAlpha, vAlpha) * shade;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      uniformsNeedUpdate: true
    });

    this._particlesGeometry = geometry;
  this._particlesPoints = new THREE.Points(geometry, material);
  this._particlesPoints.position.z = -0.02;
  this._particlesPoints.renderOrder = 1;
    this.scene.add(this._particlesPoints);
    this._updateParticleSize(this.app?.root?.clientWidth || 1, this.app?.root?.clientHeight || 1);

    this._particles = new Array(max).fill(null).map(() => ({
      active: false,
      x: 0,
      y: 0,
      age: 0,
      bandBase: 0,
      jitterPhase: 0,
      jitterSpeed: 0,
      jitterAmplitude: 0,
      horizontalSpeed: 0,
      targetX: 0,
      targetY: 0,
      approachStartX: 0,
      approachSpan: 1
    }));
    this._activeParticles = 0;
  }

  _createSeedEffectSystem() {
    if (this._seedEffectGroup) return;
    const { seeds } = this.params;
    this._seedEffectGroup = new THREE.Group();
    this._seedEffectGroup.position.z = 0.06;
    this._seedEffectGroup.renderOrder = 5;
    this.scene.add(this._seedEffectGroup);

    this._seedEffectMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        size: { value: 6 },
        color: { value: new THREE.Color(seeds.particleColor || '#4d3018') }
      },
      vertexShader: `
        uniform float size;
        attribute float alpha;
        varying float vAlpha;
        void main(){
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = size;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying float vAlpha;
        void main(){
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float r = dot(uv, uv);
          if (r > 1.0) discard;
          float shade = smoothstep(1.0, 0.0, r);
          gl_FragColor = vec4(color, vAlpha * shade);
        }
      `
    });
  }

  _emitSeedBurst(x, y) {
    if (!this._seedEffectMaterial || !this._seedEffectGroup) return;
    const { seeds } = this.params;
    const count = Math.max(1, Math.floor(seeds.particlesPerPlant));
    const positions = new Float32Array(count * 3);
    const alphas = new Float32Array(count);
    const velocities = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      positions[idx + 0] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = 0.8;
      alphas[i] = 1;

      const dir = (Math.random() * Math.PI * 2);
      const speed = seeds.burstHorizontalSpeed * (0.4 + Math.random() * 0.9);
      velocities[i * 2 + 0] = Math.cos(dir) * speed;
      velocities[i * 2 + 1] = seeds.burstVerticalSpeed * (0.6 + Math.random() * 0.4);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geometry.getAttribute('position').setUsage(THREE.DynamicDrawUsage);
    geometry.getAttribute('alpha').setUsage(THREE.DynamicDrawUsage);

    const points = new THREE.Points(geometry, this._seedEffectMaterial);
    this._seedEffectGroup.add(points);

    this._seedBursts.push({
      points,
      geometry,
      positions,
      alphas,
      velocities,
      life: 0,
      aliveCount: count
    });
  }

  _updateSeedBursts(dt) {
    if (!this._seedBursts.length) return;
    const { seeds } = this.params;
    const gravity = seeds.gravity;
    const toRemove = [];

    for (let i = 0; i < this._seedBursts.length; i++) {
      const burst = this._seedBursts[i];
      burst.life += dt;
      let anyAlive = false;

      for (let j = 0; j < burst.alphas.length; j++) {
        if (burst.alphas[j] <= 0) continue;
        const posIdx = j * 3;
        const velIdx = j * 2;

        // Update velocity with gravity
        burst.velocities[velIdx + 1] -= gravity * dt;

        // Update positions based on velocity
        burst.positions[posIdx + 0] += burst.velocities[velIdx + 0] * dt;
        burst.positions[posIdx + 1] += burst.velocities[velIdx + 1] * dt;

        // Instead of colliding, we just fade them out over time
        // This ensures they are visible everywhere
        burst.alphas[j] = 1.0 - (burst.life / 1.5); // Fades out over 1.5 seconds

        if (burst.alphas[j] > 0) {
          anyAlive = true;
        }
      }

      burst.geometry.attributes.position.needsUpdate = true;
      burst.geometry.attributes.alpha.needsUpdate = true;

      // Remove the burst once life exceeds a limit or all particles are faded
      if (!anyAlive || burst.life >= 1.5) {
        toRemove.push(i);
      }
    }

    // Cleanup code...
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      const burst = this._seedBursts[idx];
      this._seedEffectGroup.remove(burst.points);
      burst.geometry.dispose();
      this._seedBursts.splice(idx, 1);
    }
  }

  _updateSeedEffectSize(width, height) {
    if (!this._seedEffectMaterial) return;
    const { seeds } = this.params;
    const minSide = Math.max(1, Math.min(width || 1, height || 1));
    this._seedEffectMaterial.uniforms.size.value = Math.max(2, minSide * (seeds.particleSize || 0.02));
  }

  _getPlantVisualConfig() {
    const visuals = this.params.plantGrowth?.visuals;
    if (!visuals) return null;
    if (visuals.enableSprites === false) return null;
    return visuals;
  }

  _stageIdToIndex(stageId) {
    if (!stageId) return 0;
    const idx = this._plantStages.findIndex((stage) => stage.id === stageId);
    return idx >= 0 ? idx : 0;
  }

  _resolvePlantAssetName(seed) {
    if (!seed) return null;
    if (seed.assetName) return String(seed.assetName).toLowerCase();
    return null;
  }

  _getSeedSpriteWidthRatio(seed) {
    const visuals = this.params.plantGrowth?.visuals || {};
    const baseRatio = Math.max(1e-5, visuals.spriteWidthRatio ?? 0.005);
    if (typeof seed?.spriteWidthMultiplier === 'number') {
      return Math.max(1e-5, baseRatio * seed.spriteWidthMultiplier);
    }
    const ratio = typeof seed?.spriteWidthRatio === 'number'
      ? seed.spriteWidthRatio
      : baseRatio;
    return Math.max(1e-5, ratio);
  }

  _getSeedBottomMargin(seed) {
    const visuals = this.params.plantGrowth?.visuals || {};
    const margin = typeof seed?.bottomMargin === 'number'
      ? seed.bottomMargin
      : visuals.bottomMargin;
    return clamp(margin ?? 0.05, 0, 1);
  }

  _computePlantDepth(centerY) {
    const frontZ = -0.02;
    const backZ = -0.045;
    const height = Math.max(1e-5, this.worldHeight);
    // Lower plants (smaller normalized) get a larger z so they render in front of higher plants.
    const normalized = clamp((centerY - this.worldBottom) / height, 0, 1);
    return backZ + (1 - normalized) * (frontZ - backZ);
  }

  _setPlantDepth(plant, centerY) {
    if (!plant?.mesh) return;
    plant.mesh.position.z = this._computePlantDepth(centerY);
  }

  _alignPlantToRiverbed(plant) {
    if (!plant) return;
    const width = this.worldWidth;
    if (!Number.isFinite(width) || width <= 0) return;
    const normalized = Number.isFinite(plant.anchorX)
      ? clamp(plant.anchorX, 0, 1)
      : clamp((plant.x ?? 0) / width, 0, 1);
    plant.anchorX = normalized;
    plant.x = normalized * width;
    if (Array.isArray(this._riverbedHeights) && this._riverbedHeights.length) {
      const segments = Math.max(1, this.params.riverbed?.segments ?? 0);
      plant.baseY = this._heightAt(this._riverbedHeights, segments, plant.x);
    }
  }

  _spriteStageAssetIndex(seed, stageIndex) {
    if (!seed || !Number.isInteger(stageIndex)) return null;
    const map = seed.spriteStageMap;
    if (Array.isArray(map)) {
      const clampedIndex = stageIndex < map.length ? stageIndex : map.length - 1;
      if (clampedIndex < 0) return null;
      const value = map[clampedIndex];
      if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
      if (value === null || typeof value === 'undefined') return null;
      return value;
    }
    const maxIndex = typeof seed.maxSpriteStageIndex === 'number' ? seed.maxSpriteStageIndex : null;
    if (maxIndex !== null) {
      return Math.min(stageIndex, maxIndex);
    }
    return stageIndex;
  }

  _spriteTransitionEnabled(seed, fromStageIndex) {
    if (!seed || !Number.isInteger(fromStageIndex)) return false;
    const map = seed.spriteTransitionMap;
    if (map && Object.prototype.hasOwnProperty.call(map, fromStageIndex)) {
      return !!map[fromStageIndex];
    }
    return true;
  }

  _normalizeAssetPath(basePath, filename) {
    const cleanBase = basePath ? basePath.replace(/\\/g, '/').replace(/\/+$/, '') : '';
    if (!cleanBase) return filename;
    return `${cleanBase}/${filename}`;
  }

  _loadTexture(url) {
    return new Promise((resolve, reject) => {
      if (!this._textureLoader) {
        this._textureLoader = new THREE.TextureLoader();
      }
      this._textureLoader.load(
        url,
        (texture) => {
            // Ensure clean state for UV animation
            texture.matrixAutoUpdate = false;
            texture.repeat.set(1, 1);
            texture.offset.set(0, 0);
            texture.center.set(0, 0);
            texture.rotation = 0;
            resolve(texture);
        },
        undefined,
        () => reject(new Error(`Failed to load texture: ${url}`))
      );
    });
  }

  _prepareTexture(texture) {
    if (!texture) return;
    if ('colorSpace' in texture && THREE && THREE.SRGBColorSpace) {
      texture.colorSpace = THREE.SRGBColorSpace;
    } else if ('encoding' in texture) {
      // Fallback for older Three.js - texture.encoding = THREE.sRGBEncoding
      texture.colorSpace = THREE.SRGBColorSpace;
    }
    texture.needsUpdate = true;
  }

  _createFrameRecord(texture) {
    const frame = {
      texture,
      width: 1,
      height: 1,
      imageData: null,
      canvas: null
    };
    const image = texture?.image;
    if (image) {
      frame.width = image.width || 1;
      frame.height = image.height || 1;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = frame.width;
        canvas.height = frame.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(image, 0, 0);
          frame.imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          frame.canvas = canvas;
        }
      } catch (err) {
        frame.imageData = null;
      }
    }
    return frame;
  }

  _getPlantStageSequence(seed, stageIndex) {
    const assetStage = this._spriteStageAssetIndex(seed, stageIndex);
    return this._getOrLoadSequence(seed, {
      type: 'stage',
      stageIndex,
      assetStage
    });
  }

  _getPlantTransitionSequence(seed, fromStageIndex, toStageIndex) {
    if (!this._spriteTransitionEnabled(seed, fromStageIndex)) {
      return null;
    }
    const fromAssetStage = this._spriteStageAssetIndex(seed, fromStageIndex);
    const toAssetStage = this._spriteStageAssetIndex(seed, toStageIndex);
    return this._getOrLoadSequence(seed, {
      type: 'transition',
      fromStageIndex,
      toStageIndex,
      fromAssetStage,
      toAssetStage
    });
  }

  _getOrLoadSequence(seed, options) {
    const visuals = this._getPlantVisualConfig();
    if (!visuals) return null;
    const assetName = this._resolvePlantAssetName(seed);
    if (!assetName) return null;

    const type = options.type;
    const stageIndex = options.stageIndex;
    const assetStage = options.assetStage;
    const fromStageIndex = options.fromStageIndex;
    const toStageIndex = options.toStageIndex;
    const fromAssetStage = options.fromAssetStage;
    const toAssetStage = options.toAssetStage;

    const candidates = [];
    const seen = new Set();

    const addStageCandidate = (value) => {
      if (!Number.isFinite(value)) return;
      const intValue = Math.max(0, Math.floor(value));
      const key = `stage-${intValue}`;
      if (seen.has(key)) return;
      seen.add(key);
      const folderName = `${assetName}-stage-${intValue}`;
      candidates.push({ folderName, filenamePrefix: folderName });
    };

    const addTransitionCandidate = (fromValue, toValue) => {
      if (!Number.isFinite(fromValue) || !Number.isFinite(toValue)) return;
      const fromInt = Math.max(0, Math.floor(fromValue));
      const toInt = Math.max(0, Math.floor(toValue));
      const key = `transition-${fromInt}-${toInt}`;
      if (seen.has(key)) return;
      seen.add(key);
      const folderName = `${assetName}-stage-${fromInt}-to-${toInt}`;
      candidates.push({ folderName, filenamePrefix: folderName });
    };

    if (type === 'stage') {
      addStageCandidate(stageIndex);
      if (assetStage !== null && typeof assetStage !== 'undefined') {
        addStageCandidate(assetStage);
      }
    } else {
      addTransitionCandidate(fromStageIndex, toStageIndex);
      if (fromAssetStage !== null && typeof fromAssetStage !== 'undefined' && toAssetStage !== null && typeof toAssetStage !== 'undefined') {
        addTransitionCandidate(fromAssetStage, toAssetStage);
      }
    }

    if (!candidates.length) {
      return null;
    }

    let cacheKey;
    if (type === 'stage') {
      cacheKey = `stage|${assetName}|${Math.max(0, Math.floor(stageIndex ?? 0))}`;
    } else {
      cacheKey = `transition|${assetName}|${Math.max(0, Math.floor(fromStageIndex ?? 0))}->${Math.max(0, Math.floor(toStageIndex ?? 0))}`;
    }

    let entry = this._plantSequenceCache.get(cacheKey);
    if (entry && (entry.status === 'evicted' || entry.status === 'disposed')) {
      this._plantSequenceCache.delete(cacheKey);
      entry = null;
    }
    const basePath = visuals.basePath || '';
    const extension = visuals.frameExtension || '.webp';
    const frameDigits = Math.max(1, visuals.frameDigits ?? 3);
    const maxFrames = Math.max(1, visuals.maxFramesPerClip ?? 240);
    const transitionFps = Math.max(1, visuals.transitionFps ?? 12);
    const stageFps = Math.max(1, visuals.stageFps ?? transitionFps);

    const fps = type === 'transition' ? transitionFps : stageFps;
    const loop = type === 'transition' ? false : true;

    if (!entry) {
      entry = {
        key: cacheKey,
        status: 'loading',
        frames: [],
        fps,
        loop,
        type,
        callbacks: [],
        firstFrameCallbacks: [],
        firstFrameReady: false,
        promise: null,
        refCount: 0,
        evictOnReady: false,
        disposed: false
      };
      this._plantSequenceCache.set(cacheKey, entry);
      entry.promise = this._loadPlantSequence(entry, {
        basePath,
        candidates,
        extension,
        frameDigits,
        maxFrames
      }).catch(() => {
        entry.status = 'error';
      }).finally(() => {
        entry.promise = null;
        const callbacks = entry.callbacks.splice(0);
        for (let i = 0; i < callbacks.length; i++) {
          const cb = callbacks[i];
          try {
            cb(entry);
          } catch (err) {
            // ignore callback errors
          }
        }
        if (entry.refCount <= 0 && entry.evictOnReady) {
          this._evictSequence(entry);
        } else {
          entry.evictOnReady = false;
        }
      });
    } else {
      entry.fps = fps;
      entry.loop = loop;
      entry.refCount = entry.refCount || 0;
      entry.firstFrameCallbacks = entry.firstFrameCallbacks || [];
      entry.firstFrameReady = entry.firstFrameReady || (Array.isArray(entry.frames) && entry.frames.length > 0);
    }

    return entry;
  }

  _retainSequence(entry) {
    if (!entry || entry.disposed) return;
    entry.refCount = (entry.refCount || 0) + 1;
    entry.evictOnReady = false;
  }

  _releaseSequence(entry) {
    if (!entry || entry.disposed) return;
    entry.refCount = Math.max(0, (entry.refCount || 0) - 1);
    if (entry.refCount > 0) return;
    if (entry.status === 'loading') {
      entry.evictOnReady = true;
      return;
    }
    this._evictSequence(entry);
  }

  _disposeSequence(entry, { removeFromCache = true } = {}) {
    if (!entry || entry.disposed) return;
    entry.disposed = true;
    entry.refCount = 0;
    entry.evictOnReady = false;
    if (Array.isArray(entry.frames)) {
      for (let i = 0; i < entry.frames.length; i++) {
        const frame = entry.frames[i];
        if (!frame) continue;
        frame.texture?.dispose?.();
        if (frame.canvas) {
          frame.canvas.width = 0;
          frame.canvas.height = 0;
          frame.canvas = null;
        }
        frame.imageData = null;
      }
      entry.frames.length = 0;
    }
    if (Array.isArray(entry.callbacks)) {
      entry.callbacks.length = 0;
    }
    if (Array.isArray(entry.firstFrameCallbacks)) {
      entry.firstFrameCallbacks.length = 0;
    }
    entry.firstFrameReady = false;
    entry.status = 'evicted';
    entry.promise = null;
    entry.activeCandidate = null;
    if (removeFromCache && entry.key) {
      this._plantSequenceCache.delete(entry.key);
    }
  }

  _evictSequence(entry) {
    if (!entry || entry.disposed) return;
    this._disposeSequence(entry);
  }

  _releasePlantPreview(plant) {
    if (!plant?.previewSequenceEntry) return;
    this._releaseSequence(plant.previewSequenceEntry);
    plant.previewSequenceEntry = null;
  }

  _releasePlantAnimation(plant, { keepPreview = false, preserveLastFrame = false } = {}) {
    if (!plant) return;
    const anim = plant.animation;
    const entry = anim?.entry;
    const frames = Array.isArray(entry?.frames) ? entry.frames : null;
    const canPreserveFrame = preserveLastFrame && frames && frames.length > 0;
    let preservedFrame = null;

    if (canPreserveFrame) {
      const currentIndex = clamp(anim?.frameIndex ?? frames.length - 1, 0, frames.length - 1);
      preservedFrame = frames[currentIndex] || frames[frames.length - 1] || null;
      if (plant.previewSequenceEntry && plant.previewSequenceEntry !== entry) {
        this._releasePlantPreview(plant);
      }
      plant.previewSequenceEntry = entry;
      plant.activeFrame = preservedFrame;
    } else if (!keepPreview) {
      plant.activeFrame = null;
    }

    if (entry && !canPreserveFrame) {
      this._releaseSequence(entry);
    }

    plant.animation = null;

    if (canPreserveFrame && preservedFrame) {
      this._applyFrameToPlant(plant, preservedFrame);
      plant.visualMode = 'image';
    } else if (!keepPreview) {
      this._releasePlantPreview(plant);
      if (plant.imageMaterial && plant.imageMaterial.map) {
        plant.imageMaterial.map = null;
        plant.imageMaterial.needsUpdate = true;
      }
    }
  }

  _removeSequenceCallback(entry, callback, type = 'ready') {
    if (!entry || typeof callback !== 'function') return;
    const list = type === 'firstFrame' ? entry.firstFrameCallbacks : entry.callbacks;
    if (!Array.isArray(list)) return;
    const idx = list.indexOf(callback);
    if (idx >= 0) {
      list.splice(idx, 1);
    }
  }

  _registerPlantSequenceCallback(plant, entry, handler) {
    if (!plant || !entry || typeof handler !== 'function') return;
    const key = entry.key;
    if (!key) return;
    entry.evictOnReady = false;
    if (!plant.pendingSequenceCallbacks) {
      plant.pendingSequenceCallbacks = new Map();
    }
    const mapKey = `ready|${key}`;
    const existing = plant.pendingSequenceCallbacks.get(mapKey);
    if (existing) {
      this._removeSequenceCallback(existing.entry, existing.wrapper, existing.type);
    }
    const wrapper = (result) => {
      plant.pendingSequenceCallbacks?.delete(mapKey);
      handler(result);
    };
    plant.pendingSequenceCallbacks.set(mapKey, { entry, wrapper, type: 'ready' });
    this._addSequenceReadyCallback(entry, wrapper);
  }

  _registerPlantSequenceFirstFrameCallback(plant, entry, handler) {
    if (!plant || !entry || typeof handler !== 'function') return;
    const key = entry.key;
    if (!key) return;
    entry.evictOnReady = false;
    if (!plant.pendingSequenceCallbacks) {
      plant.pendingSequenceCallbacks = new Map();
    }
    const mapKey = `first|${key}`;
    const existing = plant.pendingSequenceCallbacks.get(mapKey);
    if (existing) {
      this._removeSequenceCallback(existing.entry, existing.wrapper, existing.type);
    }
    const wrapper = (result) => {
      plant.pendingSequenceCallbacks?.delete(mapKey);
      handler(result);
    };
    plant.pendingSequenceCallbacks.set(mapKey, { entry, wrapper, type: 'firstFrame' });
    this._addSequenceFirstFrameCallback(entry, wrapper);
  }

  _clearPlantSequenceCallbacks(plant) {
    if (!plant?.pendingSequenceCallbacks) return;
    plant.pendingSequenceCallbacks.forEach(({ entry, wrapper, type }) => {
      this._removeSequenceCallback(entry, wrapper, type);
      if (!entry) return;
      const hasRefs = (entry.refCount || 0) > 0;
      const hasCallbacks = (Array.isArray(entry.callbacks) && entry.callbacks.length > 0)
        || (Array.isArray(entry.firstFrameCallbacks) && entry.firstFrameCallbacks.length > 0);
      if (!hasRefs && !hasCallbacks) {
        if (entry.status === 'loading') {
          entry.evictOnReady = true;
        } else if (entry.status === 'ready' || entry.status === 'error') {
          this._evictSequence(entry);
        }
      }
    });
    plant.pendingSequenceCallbacks.clear();
  }

  async _loadPlantSequence(entry, descriptor) {
    const { basePath, candidates } = descriptor;

    for (let c = 0; c < candidates.length; c++) {
      const candidate = candidates[c];
      const jsonUrl = this._normalizeAssetPath(basePath, `${candidate.folderName}.json`);
      const webpUrl = this._normalizeAssetPath(basePath, `${candidate.folderName}.webp`);

      try {
        const metaResponse = await fetch(jsonUrl);
        if (entry.disposed) return;
        if (!metaResponse.ok) continue;
        const meta = await metaResponse.json();
        if (entry.disposed) return;

        const texture = await this._loadTexture(webpUrl);
        if (entry.disposed) {
          if (texture) texture.dispose();
          return;
        }
        if (!texture) continue;

        this._prepareTexture(texture);

        const frames = [];
        const cols = Math.max(1, meta.columns || 1);
        const rows = Math.max(1, meta.rows || 1);
        const frameCount = meta.frameCount || (cols * rows);
        const frameWidth = meta.frameWidth || (texture.image.width / cols);
        const frameHeight = meta.frameHeight || (texture.image.height / rows);

        // Extract image data ONCE for the whole sheet for hit detection
        let masterImageData = null;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = texture.image.width;
            canvas.height = texture.image.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(texture.image, 0, 0);
            masterImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch(e) { /* ignore CORS issues */ }

        for (let i = 0; i < frameCount; i++) {
          const col = i % cols;
          const row = Math.floor(i / cols);
          
          // Calculate UV coordinates for this frame
          // Three.js UV origin (0,0) is Bottom-Left. Images are Top-Left.
          const uMin = col / cols;
          const uMax = (col + 1) / cols;
          const vMax = 1 - (row / rows); // Top of frame
          const vMin = 1 - ((row + 1) / rows); // Bottom of frame
          
          // Shrink UVs slightly to avoid bleeding from adjacent frames
          // 0.5 pixel inset
          const uInset = (0.5 / texture.image.width);
          const vInset = (0.5 / texture.image.height);

          frames.push({
            texture: texture, // Share the SAME texture object
            width: frameWidth,
            height: frameHeight,
            imageData: masterImageData, // Reference master data
            // Pre-calculate UV array for PlaneGeometry [TL, TR, BL, BR]
            // Standard PlaneGeometry vertices: 0:TL, 1:TR, 2:BL, 3:BR
            uvs: new Float32Array([
                uMin + uInset, vMax - vInset, // 0: Top-Left
                uMax - uInset, vMax - vInset, // 1: Top-Right
                uMin + uInset, vMin + vInset, // 2: Bottom-Left
                uMax - uInset, vMin + vInset  // 3: Bottom-Right
            ]),
            // Store bounds for hit detection logic
            uvBounds: { uMin, uMax, vMin, vMax }
          });
        }

        if (frames.length > 0) {
          entry.frames = frames;
          entry.status = 'ready';
          entry.activeCandidate = candidate;
          this._notifySequenceFirstFrame(entry);
          return entry;
        }
      } catch (err) {
        // Try next candidate
      }
    }

    entry.frames = [];
    entry.status = 'error';
    if (Array.isArray(entry.firstFrameCallbacks) && entry.firstFrameCallbacks.length) {
      const callbacks = entry.firstFrameCallbacks.splice(0);
      for (let i = 0; i < callbacks.length; i++) {
        const cb = callbacks[i];
        try {
          cb(entry);
        } catch (err) {
          // ignore callback errors
        }
      }
    }
    return entry;
  }

  _notifySequenceFirstFrame(entry) {
    if (!entry) return;
    if (!Array.isArray(entry.frames) || entry.frames.length === 0) return;
    if (entry.firstFrameReady) return;
    entry.firstFrameReady = true;
    if (!Array.isArray(entry.firstFrameCallbacks) || !entry.firstFrameCallbacks.length) return;
    const callbacks = entry.firstFrameCallbacks.splice(0);
    for (let i = 0; i < callbacks.length; i++) {
      const cb = callbacks[i];
      try {
        cb(entry);
      } catch (err) {
        // ignore callback errors
      }
    }
  }

  _addSequenceFirstFrameCallback(entry, callback) {
    if (!entry || typeof callback !== 'function') return;
    if (entry.firstFrameReady || (Array.isArray(entry.frames) && entry.frames.length > 0)) {
      callback(entry);
      return;
    }
    if (!Array.isArray(entry.firstFrameCallbacks)) {
      entry.firstFrameCallbacks = [];
    }
    entry.firstFrameCallbacks.push(callback);
  }

  _addSequenceReadyCallback(entry, callback) {
    if (!entry || typeof callback !== 'function') return;
    if (entry.status === 'ready' || entry.status === 'error') {
      callback(entry);
      return;
    }
    entry.callbacks.push(callback);
  }

  async _preloadCriticalAssets() {
    const pending = [];

    const backgroundImage = this.params.world?.backgroundImage;
    if (backgroundImage && !this._backgroundTexture) {
      pending.push(
        this._loadTexture(backgroundImage)
          .then((texture) => {
            this._prepareTexture(texture);
            this._backgroundTexture = texture;
          })
      );
    }

    const sandImage = this.params.riverbed?.texture?.image;
    if (sandImage && !this._sandTexture) {
      pending.push(
        this._loadTexture(sandImage)
          .then((texture) => {
            this._prepareTexture(texture);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.needsUpdate = true;
            this._sandTexture = texture;
          })
      );
    }

    pending.push(this._preloadUiImages());
    pending.push(this._preloadCloudTextures());
    pending.push(this._preloadPlantAssets());

    const tasks = pending.filter(Boolean);
    if (!tasks.length) return;

    const results = await Promise.allSettled(tasks);
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        console.warn('[SimuladorScene] Asset preload failed:', results[i].reason);
      }
    }
  }

  async _preloadPlantAssets() {
    const seeds = [];
    const groups = ['colonizers', 'nonColonizers'];
    groups.forEach(g => {
      if (this.params.seeds?.[g]) {
        seeds.push(...this.params.seeds[g]);
      }
    });

    const promises = [];
    
    for (const seed of seeds) {
      if (!seed.id) continue;
      // Preload stage 0 for all seeds to avoid lag on first plant
      const entry = this._getPlantStageSequence(seed, 0);
      if (entry && entry.status === 'loading' && entry.promise) {
        promises.push(entry.promise);
      }
    }
    
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  async _preloadCloudTextures() {
    const config = this.params.sky?.clouds;
    if (!config?.enabled) return;
    const count = Math.max(0, Math.floor(config.textureCount ?? 0));
    if (!count) return;

    this._cloudTextures.clear();

    const basePath = config.textureBasePath || '';
    const prefix = config.texturePrefix || 'cloud';
    const extension = config.textureExtension || '.png';
    const tasks = [];

    for (let i = 1; i <= count; i++) {
      const filename = `${prefix}${i}${extension}`;
      const url = this._normalizeAssetPath(basePath, filename);
      const task = this._loadTexture(url)
        .then((texture) => {
          if (!texture) return;
          this._prepareTexture(texture);
          this._cloudTextures.set(i, texture);
        })
        .catch(() => {});
      tasks.push(task);
    }

    if (!tasks.length) return;
    await Promise.allSettled(tasks);
  }

  async _preloadUiImages() {
    const elements = this.params.ui?.elements;
    if (!elements) return;
    if (typeof Image === 'undefined') return;

    const basePath = elements.basePath || '';
    const urls = new Set();
    const addUrl = (relative) => {
      if (!relative) return;
      urls.add(this._normalizeAssetPath(basePath, relative));
    };

    if (elements.logo?.image) {
      const logoUrl = this._normalizeAssetPath(basePath, elements.logo.image);
      addUrl(elements.logo.image);
      if (!this._loadingLogoUrl) {
        this._loadingLogoUrl = logoUrl;
      }
    }

    addUrl(elements.sedimentButton?.image);
    addUrl(elements.removeButton?.image);
    addUrl(elements.seeder?.image);

    const seedImages = elements.seedImages;
    if (seedImages) {
      Object.values(seedImages).forEach((value) => addUrl(value));
    }

    const weather = elements.weather;
    const buildWeatherUrl = (channelCfg, frameNumber) => {
      if (!channelCfg || !Number.isFinite(frameNumber)) return null;
      const folderPath = channelCfg.folder
        ? this._normalizeAssetPath(basePath, channelCfg.folder)
        : basePath;
      const digits = Math.max(1, channelCfg.frameDigits ?? 1);
      const prefix = channelCfg.framePrefix || '';
      const extension = channelCfg.frameExtension || '.png';
      const frameValue = Math.max(0, Math.round(frameNumber));
      return this._normalizeAssetPath(
        folderPath,
        `${prefix}${frameValue.toString().padStart(digits, '0')}${extension}`
      );
    };

    if (weather?.top?.frames?.low !== undefined) {
      const url = buildWeatherUrl(weather.top, weather.top.frames.low);
      if (url) urls.add(url);
    }
    if (weather?.bottom?.frames?.low !== undefined) {
      const url = buildWeatherUrl(weather.bottom, weather.bottom.frames.low);
      if (url) urls.add(url);
    }

    if (weather?.bottom?.sheet?.file) {
      const sheetUrl = this._normalizeAssetPath(basePath, weather.bottom.sheet.file);
      if (sheetUrl) urls.add(sheetUrl);
    }

    if (!urls.size) return;

    const promises = [];
    urls.forEach((url) => {
      promises.push(this._preloadImage(url));
    });

    if (!promises.length) return;
    await Promise.allSettled(promises);
  }

  _preloadImage(url) {
    if (!url || typeof Image === 'undefined') return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const finalize = () => {
        if (done) return;
        done = true;
        resolve();
      };
      img.onload = finalize;
      img.onerror = finalize;
      img.src = url;
      if (typeof img.decode === 'function') {
        img.decode().then(finalize).catch(finalize);
      }
    });
  }

  _resolveAudioUrl(file) {
    if (!file) return null;
    const basePath = this.params.audio?.basePath || '';
    return this._normalizeAssetPath(basePath, file);
  }

  _createAudioElement(file) {
    const url = this._resolveAudioUrl(file);
    if (!url) return null;
    if (typeof Audio === 'undefined') return null;
    try {
      return AssetLoader.audio(url);
    } catch (err) {
      console.warn('[SimuladorScene] Unable to load audio:', url, err);
      return null;
    }
  }

  _scheduleAudioPlayback(callback, delaySeconds) {
    if (typeof callback !== 'function') return null;
    const delayMs = Math.max(0, Number(delaySeconds) || 0) * 1000;
    if (delayMs <= 0) {
      callback();
      return null;
    }
    const scheduler = (typeof window !== 'undefined' && typeof window.setTimeout === 'function')
      ? window.setTimeout.bind(window)
      : setTimeout;
    const timer = scheduler(() => {
      this._audioTimers.delete(timer);
      callback();
    }, delayMs);
    this._audioTimers.add(timer);
    return timer;
  }

  _clearAudioTimers() {
    if (!this._audioTimers || !this._audioTimers.size) return;
    this._audioTimers.forEach((timer) => {
      if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
        window.clearTimeout(timer);
      } else {
        clearTimeout(timer);
      }
    });
    this._audioTimers.clear();
  }

  _fireAndForgetSound(config, overrides = {}) {
    if (!config) return;
    const candidates = overrides.files || config.files;
    let file = overrides.file || config.file;
    if (!file && Array.isArray(candidates) && candidates.length) {
      const index = Math.floor(Math.random() * candidates.length);
      file = candidates[index];
    }
    if (!file) return;
    const volume = clamp(overrides.volume ?? config.volume ?? 1, 0, 1);
    const delay = Math.max(0, overrides.delay ?? config.delay ?? 0);
    const loop = !!(overrides.loop ?? config.loop);
    const play = () => {
      const audio = this._createAudioElement(file);
      if (!audio) return;
      audio.loop = loop;
      audio.volume = volume;
      if (this._transientAudios) {
        this._transientAudios.add(audio);
        const cleanup = () => {
          this._transientAudios.delete(audio);
        };
        audio.addEventListener('ended', cleanup, { once: true });
        audio.addEventListener('error', cleanup, { once: true });
      }
      try {
        audio.currentTime = 0;
      } catch (err) {
        // ignore reset issues
      }
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          if (this._transientAudios) {
            this._transientAudios.delete(audio);
          }
        });
      }
    };
    if (delay > 0) {
      this._scheduleAudioPlayback(play, delay);
    } else {
      play();
    }
  }

  _startLoopingAudioInstance(targetKey, config) {
    if (!targetKey || !config?.file) return;
    const audio = this._createAudioElement(config.file);
    if (!audio) return;
    audio.loop = config.loop !== false;
    audio.volume = clamp(config.volume ?? 1, 0, 1);
    this[targetKey] = audio;

    const startPlayback = () => {
      const instance = this[targetKey];
      if (!instance) return;
      try {
        instance.currentTime = 0;
      } catch (err) {
        // ignore reset issues
      }
      const promise = instance.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {});
      }
    };

    const delay = Math.max(0, config.delay ?? 0);
    if (delay > 0) {
      this._scheduleAudioPlayback(startPlayback, delay);
    } else {
      startPlayback();
    }
  }

  _initAudio() {
    if (!this._audioTimers) {
      this._audioTimers = new Set();
    }
    this._disposeAudio();
    this._startLoopingAudioInstance('_ambientAudio', this.params.audio?.ambient);
    this._startLoopingAudioInstance('_musicAudio', this.params.audio?.music);
  }

  _disposeAudio() {
    this._clearAudioTimers();
    if (this._transientAudios && this._transientAudios.size) {
      this._transientAudios.forEach((audio) => {
        try {
          audio.pause();
        } catch (err) {
          // ignore pause errors
        }
      });
      this._transientAudios.clear();
    }
    if (this._sedimentAudio) {
      try {
        this._sedimentAudio.pause();
      } catch (err) {
        // ignore pause errors
      }
      try {
        this._sedimentAudio.currentTime = 0;
      } catch (err) {
        // ignore reset issues
      }
    }
    this._sedimentAudio = null;
    this._sedimentSoundPlaying = false;
    this._sedimentSoundPending = false;
    if (this._musicAudio) {
      this._musicAudio.pause();
      try {
        this._musicAudio.currentTime = 0;
      } catch (err) {
        // ignore reset issues
      }
      this._musicAudio = null;
    }
    if (this._ambientAudio) {
      this._ambientAudio.pause();
      try {
        this._ambientAudio.currentTime = 0;
      } catch (err) {
        // ignore reset issues
      }
      this._ambientAudio = null;
    }
  }

  _playSedimentImpactSound() {
    const cfg = this.params.audio?.sediment;
    if (!cfg?.file) return;
    if (this._sedimentAudio && this._sedimentSoundPlaying) {
      if (this._sedimentAudio.paused || this._sedimentAudio.ended) {
        this._sedimentSoundPlaying = false;
      }
    }
    if (this._sedimentSoundPlaying || this._sedimentSoundPending) return;

    if (!this._sedimentAudio) {
      const audio = this._createAudioElement(cfg.file);
      if (!audio) return;
      audio.loop = false;
      audio.addEventListener('ended', () => {
        this._sedimentSoundPlaying = false;
      });
      audio.addEventListener('error', () => {
        this._sedimentSoundPlaying = false;
      });
      this._sedimentAudio = audio;
    }

    const audio = this._sedimentAudio;
    if (!audio) return;
    if (!audio.paused && !audio.ended) {
      this._sedimentSoundPlaying = true;
      return;
    }

    const startPlayback = () => {
      this._sedimentSoundPending = false;
      try {
        audio.currentTime = 0;
      } catch (err) {
        // ignore reset issues
      }
      audio.volume = clamp(cfg.volume ?? 1, 0, 1);
      this._sedimentSoundPlaying = true;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          this._sedimentSoundPlaying = false;
        });
      }
    };

    const delay = Math.max(0, cfg.delay ?? 0);
    if (delay > 0) {
      this._sedimentSoundPending = true;
      const timer = this._scheduleAudioPlayback(startPlayback, delay);
      if (!timer) {
        startPlayback();
      }
    } else {
      startPlayback();
    }
  }

  _playSeedPlantSound() {
    this._fireAndForgetSound(this.params.audio?.seedPlant);
  }

  _playSelectSound() {
    this._fireAndForgetSound(this.params.audio?.select);
  }

  _playRemovePlantSound() {
    this._fireAndForgetSound(this.params.audio?.removePlant);
  }

  _playWaterLevelSound(previousIndex, nextIndex) {
    if (!Number.isInteger(previousIndex) || !Number.isInteger(nextIndex)) return;
    if (nextIndex === previousIndex) return;
    const cfg = nextIndex > previousIndex
      ? this.params.audio?.waterRaise
      : this.params.audio?.waterLower;
    this._fireAndForgetSound(cfg);
  }

  _playPlantTransitionSound(fromIndex, toIndex) {
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
    const transitions = this.params.audio?.plantTransitions;
    if (!transitions) return;
    let config = null;
    if (fromIndex === 0 && toIndex >= 1) {
      config = transitions.seedToSprout;
    } else if (fromIndex === 1 && toIndex >= 2) {
      config = transitions.sproutToSapling;
    } else if (fromIndex === 2 && toIndex >= 3) {
      config = transitions.saplingToTree;
    } else if (fromIndex === 3 && toIndex >= 4) {
      config = transitions.treeToFinal;
    }
    if (config) {
      this._fireAndForgetSound(config);
    }
  }

  _resumeAmbientAudio() {
    const resume = (audio) => {
      if (!audio || !audio.paused) return;
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {});
      }
    };

    resume(this._ambientAudio);
    resume(this._musicAudio);
  }

  _getLoadingLogoUrl() {
    if (this._loadingLogoUrl) return this._loadingLogoUrl;
    const elements = this.params.ui?.elements;
    if (elements?.logo?.image) {
      const basePath = elements.basePath || '';
      this._loadingLogoUrl = this._normalizeAssetPath(basePath, elements.logo.image);
    }
    return this._loadingLogoUrl || '';
  }

  _ensureLoadingStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(LOADING_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = LOADING_STYLE_ID;
    style.textContent = `
      @keyframes simulador-loading-spin {
        0% { transform: rotateX(18deg) rotateY(0deg); }
        20% { transform: rotateX(18deg) rotateY(25deg); }
        50% { transform: rotateX(18deg) rotateY(200deg); }
        80% { transform: rotateX(18deg) rotateY(335deg); }
        100% { transform: rotateX(18deg) rotateY(360deg); }
      }
    `;
    document.head?.appendChild(style);
  }

  _showLoadingOverlay() {
    if (!this.app?.root || this._loadingOverlay) return;
    if (typeof document === 'undefined') return;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: black;
      overflow: hidden;
      z-index: 9999;
      opacity: 1;
      pointer-events: none;
    `;

    const loader = document.createElement('video');
    loader.src = '/game-assets/menu/loader_yellow.webm';
    loader.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: clamp(140px, 18vw, 300px);
      max-width: 60vmin;
      max-height: 60vmin;
      object-fit: contain;
      opacity: 1;
      pointer-events: none;
      background: transparent;
    `;
    loader.muted = true;
    loader.playsInline = true;
    loader.loop = true;
    loader.autoplay = true;
    loader.preload = 'auto';

    overlay.appendChild(loader);
    this.app.root.appendChild(overlay);
    this._loadingOverlay = overlay;

    // Start video playback
    if (loader.readyState >= 1) {
      loader.play().catch(() => {});
    } else {
      loader.addEventListener('loadedmetadata', () => {
        loader.play().catch(() => {});
      }, { once: true });
    }
  }

  _hideLoadingOverlay(immediate = false) {
    if (!this._loadingOverlay) return;
    if (this._loadingOverlayHideTimer) {
      clearTimeout(this._loadingOverlayHideTimer);
      this._loadingOverlayHideTimer = null;
    }

    const overlay = this._loadingOverlay;
    if (immediate) {
      overlay.parentElement?.removeChild(overlay);
      if (this._loadingOverlay === overlay) {
        this._loadingOverlay = null;
      }
      return;
    }

    overlay.style.transition = 'opacity 0.8s ease';
    overlay.style.opacity = '0';
    this._loadingOverlayHideTimer = setTimeout(() => {
      overlay.parentElement?.removeChild(overlay);
      if (this._loadingOverlay === overlay) {
        this._loadingOverlay = null;
      }
      this._loadingOverlayHideTimer = null;
    }, 800);
  }

  _ensurePlantMaterial(plant) {
    if (!plant) return null;
    let material = plant.imageMaterial;
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthTest: false,
        alphaTest: 0.01
      });
      
      // Inject glow logic into MeshBasicMaterial
      material.userData.glowColor = { value: new THREE.Color(0, 0, 0) };
      material.onBeforeCompile = (shader) => {
        shader.uniforms.glowColor = material.userData.glowColor;
        shader.fragmentShader = `
          uniform vec3 glowColor;
        ` + shader.fragmentShader;
        
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `
          #include <dithering_fragment>
          gl_FragColor.rgb += glowColor;
          `
        );
      };
      
      plant.imageMaterial = material;
      this._plantMaterialCache.set(plant.id, material);
    }
    return material;
  }

  _playPlantAnimation(plant, entry, options = {}) {
    if (!plant || !entry || entry.status !== 'ready' || !entry.frames.length) return;
    
    // Ensure plant has its own PlaneGeometry for UV manipulation
    // Must replace if it's a Circle (seed) or shared geometry
    if (!plant.mesh.geometry || 
        plant.mesh.geometry === this._unitPlantPlane || 
        (plant.mesh.geometry.type && plant.mesh.geometry.type !== 'PlaneGeometry')) {
        
        if (plant.mesh.geometry && plant.mesh.geometry !== this._unitPlantPlane) {
            plant.mesh.geometry.dispose();
        }
        plant.mesh.geometry = new THREE.PlaneGeometry(1, 1);
    }

    const reuseExistingEntry = plant.animation?.entry === entry;
    const keepPreview = plant.previewSequenceEntry === entry;
    if (!reuseExistingEntry) {
      this._releasePlantAnimation(plant, { keepPreview });
      this._retainSequence(entry);
      if (keepPreview) {
        this._releasePlantPreview(plant);
      }
    } else {
      plant.animation = null;
      plant.activeFrame = null;
    }
    const fps = Math.max(1, options.fps ?? entry.fps ?? 12);
    const loop = options.loop !== undefined ? options.loop : entry.loop;
    const startFrame = clamp(options.startFrame ?? 0, 0, entry.frames.length - 1);
    plant.animation = {
      entry,
      fps,
      loop,
      frameIndex: startFrame,
      timer: 0,
      onComplete: options.onComplete || null
    };
    plant.pendingTransition = null;
    plant.visualMode = 'image';
    // plant.mesh.geometry is already unique
    plant.mesh.material = this._ensurePlantMaterial(plant);
    this._applyFrameToPlant(plant, entry.frames[startFrame]);
  }

  _applyFrameToPlant(plant, frame) {
    if (!plant || !frame) return;
    const visuals = this._getPlantVisualConfig();
    if (!visuals) return;
    const material = this._ensurePlantMaterial(plant);
    
    // 1. Only update texture if it fundamentally changed (e.g. diff species)
    // We DO NOT set material.needsUpdate = true here anymore.
    if (material.map !== frame.texture) {
      material.map = frame.texture || null;
      material.needsUpdate = true; // Only happens once per species load
    }
    // Reset glow by default
    if (material.userData.glowColor) {
        material.userData.glowColor.value.set(0, 0, 0);
    }
    material.color.setHex(0xffffff);
    material.opacity = 1;

    // 2. Update Geometry UVs to show the specific frame
    // We use the unique geometry clone we created in _spawnPlant
    if (plant.mesh.geometry && frame.uvs) {
        const uvAttribute = plant.mesh.geometry.attributes.uv;
        if (uvAttribute) {
            uvAttribute.set(frame.uvs);
            uvAttribute.needsUpdate = true; // Cheap GPU update
        }
    }

    const widthRatio = this._getSeedSpriteWidthRatio(plant.seed);
    const widthWorld = Math.max(1e-5, this.worldWidth * widthRatio);
    const aspect = frame.height && frame.width ? frame.height / frame.width : 1;
    const heightWorld = Math.max(1e-5, widthWorld * aspect);

    plant.mesh.geometry = plant.mesh.geometry; // Ensure we keep the clone
    plant.mesh.material = material;
    plant.mesh.scale.set(widthWorld, heightWorld, 1);
    plant.mesh.rotation.set(0, 0, 0);
    plant.mesh.position.x = plant.x;
    const margin = this._getSeedBottomMargin(plant.seed);
    const centerY = plant.baseY + (0.5 - margin) * heightWorld;
    plant.mesh.position.y = centerY;
    this._setPlantDepth(plant, centerY);
  plant.mesh.visible = true;

    plant.visualMode = 'image';
    plant.visualWidth = widthWorld;
    plant.visualHeight = heightWorld;
    plant.visualMargin = margin;
    plant.currentStageHeight = heightWorld;
    plant.currentStageHalfWidth = Math.max(widthWorld * 0.5, 0.01);
    plant.activeFrame = frame;
  }

  _applyPlantPreviewFrame(plant, entry) {
    if (!plant || !entry || !Array.isArray(entry.frames) || !entry.frames.length) return;
    if (plant.previewSequenceEntry !== entry) {
      this._releasePlantPreview(plant);
      this._retainSequence(entry);
      plant.previewSequenceEntry = entry;
    }

    // Ensure plant has its own PlaneGeometry for UV manipulation
    if (!plant.mesh.geometry || 
        plant.mesh.geometry === this._unitPlantPlane || 
        (plant.mesh.geometry.type && plant.mesh.geometry.type !== 'PlaneGeometry')) {
        
        if (plant.mesh.geometry && plant.mesh.geometry !== this._unitPlantPlane) {
            plant.mesh.geometry.dispose();
        }
        plant.mesh.geometry = new THREE.PlaneGeometry(1, 1);
    }

    const frame = entry.frames[0];
    this._applyFrameToPlant(plant, frame);
    plant.visualMode = 'image';
  }

  _hidePlantVisual(plant) {
    if (!plant) return;
    this._releasePlantAnimation(plant);
    if (plant.mesh) {
      plant.mesh.visible = false;
    }
    plant.visualMode = 'hidden';
  }

  _updatePlantAnimation(plant, dt) {
    const anim = plant?.animation;
    if (!anim || !anim.entry?.frames?.length) return;
    anim.timer += dt;
    const frameDuration = 1 / Math.max(1, anim.fps);
    let advanced = false;

    while (anim.timer >= frameDuration) {
      anim.timer -= frameDuration;
      anim.frameIndex += 1;
      advanced = true;
      if (anim.frameIndex >= anim.entry.frames.length) {
        if (anim.loop) {
          anim.frameIndex = 0;
        } else {
          const onComplete = anim.onComplete;
          this._releasePlantAnimation(plant, { preserveLastFrame: true });
          if (onComplete) {
            onComplete();
          }
          return;
        }
      }
    }

    if (advanced) {
      const frame = anim.entry.frames[anim.frameIndex];
      if (frame) {
        this._applyFrameToPlant(plant, frame);
      }
    }
  }

  _startPlantTransition(plant, nextIndex) {
    if (!plant) return;
    if (nextIndex <= plant.stageIndex) return;
    if (nextIndex >= this._plantStages.length) return;

    const sequence = this._getPlantTransitionSequence(plant.seed, plant.stageIndex, nextIndex);
    if (!sequence || sequence.status === 'error') {
      this._completePlantStageChange(plant, nextIndex);
      return;
    }

    const startTransition = (entry) => {
      if (!plant || plant.disposed) return;
      plant.waitingTransitionKey = null;
      if (entry.status !== 'ready' || !entry.frames.length) {
        this._completePlantStageChange(plant, nextIndex);
        return;
      }
      this._playPlantTransitionSound(plant.stageIndex, nextIndex);
      this._playPlantAnimation(plant, entry, {
        loop: false,
        fps: entry.fps,
        onComplete: () => this._completePlantStageChange(plant, nextIndex)
      });
    };

    if (sequence.status === 'ready') {
      plant.waitingTransitionKey = null;
      startTransition(sequence);
    } else if (sequence.status === 'loading') {
      const alreadyWaiting = plant.pendingTransition === nextIndex && plant.waitingTransitionKey === sequence.key;
      plant.pendingTransition = nextIndex;
      plant.waitingTransitionKey = sequence.key;
      if (!alreadyWaiting) {
        this._registerPlantSequenceCallback(plant, sequence, (entry) => {
          if (plant.disposed) return;
          if (plant.pendingTransition !== nextIndex) return;
          if (plant.waitingTransitionKey !== sequence.key) return;
          startTransition(entry);
        });
      }
    } else {
      this._completePlantStageChange(plant, nextIndex);
    }
  }

  _completePlantStageChange(plant, nextIndex) {
    if (!plant) return;
    this._clearPlantSequenceCallbacks(plant);
    if (plant.animation) {
      this._releasePlantAnimation(plant, { preserveLastFrame: true });
    }
    plant.pendingTransition = null;
    plant.waitingTransitionKey = null;
    if (Number.isInteger(nextIndex) && nextIndex > plant.stageIndex && nextIndex < this._plantStages.length) {
      plant.stageIndex = nextIndex;
    }
    plant.stageTimer = 0;
    this._applyPlantStageVisual(plant);
    if (this._lastPointerInfo) {
      this._refreshCursor();
    }
    this._checkStageGoal();
    this._updateSeedLabels();
  }

  _refreshPlantVisual(plant) {
    if (!plant) return;
    const anim = plant.animation;
    if (anim && anim.entry?.frames?.length) {
      const frame = anim.entry.frames[clamp(anim.frameIndex, 0, anim.entry.frames.length - 1)];
      if (frame) {
        this._applyFrameToPlant(plant, frame);
        return;
      }
    }

    if (plant.pendingTransition !== null) {
      this._startPlantTransition(plant, plant.pendingTransition);
      if (plant.animation && plant.animation.entry?.frames?.length) {
        const frame = plant.animation.entry.frames[clamp(plant.animation.frameIndex, 0, plant.animation.entry.frames.length - 1)];
        if (frame) {
          this._applyFrameToPlant(plant, frame);
          return;
        }
      }
    }

    if (!plant.animation && plant.activeFrame && plant.visualMode === 'image') {
      this._applyFrameToPlant(plant, plant.activeFrame);
      return;
    }

    if (plant.visualMode === 'geometry' || plant.visualMode === 'hidden') {
      this._applyPlantStageVisual(plant);
    }
  }

  _sampleFrameAlpha(frame, u, v) {
    if (!frame || !frame.imageData || !frame.uvBounds) return 1;
    
    const data = frame.imageData;
    const texWidth = data.width;
    const texHeight = data.height;

    // Map local plant UV (0 to 1) to global Spritesheet UV
    const { uMin, uMax, vMin, vMax } = frame.uvBounds;
    
    // Note: v is 0 at bottom in 3D, but image data is 0 at top. 
    // frame.uvBounds are in ThreeJS coordinates (0 at bottom).
    
    // Interpolate local U to Global U
    const globalU = lerp(uMin, uMax, clamp(u, 0, 1));
    
    // Interpolate local V to Global V
    const globalV = lerp(vMin, vMax, clamp(v, 0, 1));

    // Convert Global UV to Pixel Coordinates
    // Image data Y origin is Top-Left, UV Y origin is Bottom-Left.
    // We simply use (1 - globalV) to flip it for pixel lookup.
    const px = Math.floor(globalU * texWidth);
    const py = Math.floor((1 - globalV) * texHeight);

    const idx = (py * texWidth + px) * 4 + 3;
    const alpha = data.data?.[idx] ?? 255;
    return alpha / 255;
  }

  _handlePlantingAction(toolId, worldX, worldY) {
    if (!this._availableSeedIds.has(toolId)) return false;
    const seed = this._seedCatalog.get(toolId);
    if (!seed) return false;

    const clampedX = clamp(worldX, 0, this.worldWidth);
    const state = this._resolveInteractionState(clampedX, worldY);
    if (!state?.canPlant) return false;

    const interactions = this.params.interactions || {};
    const burstOffset = Math.max(0.005, interactions.seedBurstHeightOffset ?? 0.06);
    const desiredBurstY = worldY + burstOffset;
    const burstY = Math.min(this.worldTop, Math.max(worldY, desiredBurstY));
    
    // Check minimum distance
    const minDistance = this.params.plantCompetition?.minPlantDistance ?? 0.05;
    const minDistanceWorld = minDistance * this.worldWidth;
    
    for (const plant of this._plants) {
        const dx = plant.x - clampedX;
        const dy = plant.baseY - worldY;
        if (Math.hypot(dx, dy) < minDistanceWorld) {
            this._showGoalMessage('¡Demasiado cerca de otra planta!');
            setTimeout(() => this._hideGoalMessage(), 1500);
            return false;
        }
    }

    this._emitSeedBurst(clampedX, burstY);

    this._spawnPlant(seed, clampedX, worldY);
    this._playSeedPlantSound();
    this._refreshCursor();
    this._updateSeedLabels();
    return true;
  }

  _spawnPlant(seed, x, baseY) {
    const material = this._getSeedMaterial(seed);
    const initialStageIndex = 0;
    const stageId = this._plantStages[initialStageIndex]?.id || 'seed';
    const stageInfo = this._getPlantStageInfo(seed, stageId);
    
    const baseGeometry = this._getPlantGeometry(seed, stageId, stageInfo);
    const geometry = baseGeometry.clone();
    
    const mesh = new THREE.Mesh(geometry, material);

    const initialWidth = stageInfo?.width || (stageInfo?.radius ? stageInfo.radius * 2 : 0.02);
    const initialHeight = stageInfo?.height || (stageInfo?.radius ? stageInfo.radius * 2 : 0.02);
    const initialMargin = this._getSeedBottomMargin(seed);
    const initialCenterY = baseY + (0.5 - initialMargin) * initialHeight;
    mesh.position.set(x, initialCenterY, this._computePlantDepth(initialCenterY));
    mesh.renderOrder = 2;
    mesh.visible = false;
    this.scene.add(mesh);
    
    // Create loader mesh
    const loaderGeometry = new THREE.PlaneGeometry(1, 1);
    const loaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            progress: { value: 0.0 },
            color: { value: new THREE.Color(0x4fc3f7) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            uniform float progress;
            uniform vec3 color;
            void main() {
                vec2 center = vec2(0.5);
                vec2 diff = vUv - center;
                float dist = length(diff);
                float angle = atan(diff.y, diff.x);
                float a = (angle + 3.14159) / (2.0 * 3.14159);
                float ring = smoothstep(0.3, 0.35, dist) * (1.0 - smoothstep(0.45, 0.5, dist));
                if (a > progress) discard;
                gl_FragColor = vec4(color, ring);
            }
        `,
        transparent: true,
        depthTest: false,
        depthWrite: false
    });
    const loaderMesh = new THREE.Mesh(loaderGeometry, loaderMaterial);
    loaderMesh.visible = false;
    loaderMesh.renderOrder = 10;
    this.scene.add(loaderMesh);

    // Create death mesh (red progress ring + exclamation)
    const deathMaterial = new THREE.ShaderMaterial({
      uniforms: {
        progress: { value: 0.0 },
        color: { value: new THREE.Color(0xFF4D4D) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float progress;
        uniform vec3 color;

        float smooth01(float edge0, float edge1, float x) {
          float t = clamp((x - edge0) / max(1e-5, (edge1 - edge0)), 0.0, 1.0);
          return t * t * (3.0 - 2.0 * t);
        }

        void main() {
          vec2 center = vec2(0.5);
          vec2 diff = vUv - center;
          float dist = length(diff);

          // Ring
          float angle = atan(diff.y, diff.x);
          float a = (angle + 3.14159) / (2.0 * 3.14159);
          float ring = smooth01(0.30, 0.35, dist) * (1.0 - smooth01(0.45, 0.50, dist));
          float arcMask = step(a, progress);
          float ringAlpha = ring * arcMask;

          // Exclamation mark
          // Map to -1..1 space
          vec2 p = (vUv - 0.5) * 2.0;
          float aa = 0.02;

          float barHalfW = 0.08;
          float barBottom = -0.05;
          float barTop = 0.55;
          float barX = 1.0 - smooth01(barHalfW, barHalfW + aa, abs(p.x));
          float barY = smooth01(barBottom, barBottom + aa, p.y) * (1.0 - smooth01(barTop - aa, barTop, p.y));
          float bar = barX * barY;

          vec2 dotCenter = vec2(0.0, -0.55);
          float dotR = 0.12;
          float dot = 1.0 - smooth01(dotR, dotR + aa, length(p - dotCenter));

          float exclamAlpha = max(bar, dot);

          float alpha = max(ringAlpha, exclamAlpha);
          if (alpha <= 0.001) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    const deathMesh = new THREE.Mesh(loaderGeometry.clone(), deathMaterial);
    deathMesh.visible = false;
    deathMesh.renderOrder = 11;
    this.scene.add(deathMesh);

    const anchorX = this.worldWidth > 0 ? clamp(x / this.worldWidth, 0, 1) : 0;
    const plant = {
      id: `${seed.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      seed,
      mesh,
      loaderMesh,
      deathMesh,
      x,
      baseY,
      anchorX,
      stageIndex: initialStageIndex,
      stageTimer: 0,
      waterIntakeTimer: 0,
      readyToGrow: false,
      submergedTimer: 0,
      deathTimer: 0,
      deathActive: false,
      currentStageHeight: initialHeight,
      currentStageHalfWidth: Math.max(initialWidth * 0.5, stageInfo?.radius || 0.01),
      competitionBlocked: false,
      colorMaterial: material,
      imageMaterial: null,
      visualMode: 'hidden',
      visualWidth: initialWidth,
      visualHeight: initialHeight,
      visualMargin: initialMargin,
      activeFrame: null,
      animation: null,
      pendingTransition: null,
      waitingTransitionKey: null,
      disposed: false,
      pendingSequenceCallbacks: new Map(),
      previewSequenceEntry: null
    };
    this._applyPlantStageVisual(plant, stageInfo);
    this._plants.push(plant);
    this._checkStageGoal();
  }

  _applyPlantStageGeometryFallback(plant, providedInfo) {
    if (!plant) return;
    this._releasePlantAnimation(plant);
    const stageData = this._plantStages[plant.stageIndex];
    const stageId = stageData?.id || 'seed';
    const info = providedInfo || this._getPlantStageInfo(plant.seed, stageId);
    
    // Get base geometry
    const baseGeometry = this._getPlantGeometry(plant.seed, stageId, info);
    
    // IMPORTANT: Ensure we are using a CLONE so UVs don't conflict
    if (plant.mesh.geometry) plant.mesh.geometry.dispose();
    plant.mesh.geometry = baseGeometry.clone();

    const material = plant.colorMaterial || this._getSeedMaterial(plant.seed);
    if (plant.mesh.material !== material) {
      plant.mesh.material = material;
    }
    plant.mesh.scale.set(1, 1, 1);
    plant.mesh.rotation.set(0, 0, 0);
    plant.mesh.position.x = plant.x;
    const height = info.height || (info.radius ? info.radius * 2 : 0);
    const width = info.width || (info.radius ? info.radius * 2 : 0);
    const margin = this._getSeedBottomMargin(plant.seed);
    const centerY = plant.baseY + (0.5 - margin) * height;
    plant.mesh.position.y = centerY;
    this._setPlantDepth(plant, centerY);
  plant.mesh.visible = true;
    plant.currentStageHeight = height;
    plant.currentStageHalfWidth = Math.max(width * 0.5, info.radius || 0, 0.01);
    plant.visualMode = 'geometry';
    plant.visualWidth = width;
    plant.visualHeight = height;
    plant.visualMargin = margin;
    plant.activeFrame = null;
    plant.animation = null;
    plant.waitingTransitionKey = null;
    if (this._lastPointerInfo) {
      this._refreshCursor();
    }
  }

  _applyPlantStageVisual(plant, providedInfo) {
    const stageData = this._plantStages[plant.stageIndex];
    if (!stageData) return;
    const stageId = stageData.id;
    const visuals = this._getPlantVisualConfig();
    const stageIndex = plant.stageIndex;

    if (visuals) {
      const sequence = this._getPlantStageSequence(plant.seed, stageIndex);
      const expectedStageIndex = stageIndex;
      const activateAnimation = (entry) => {
        if (!plant || plant.disposed) return;
        if (plant.stageIndex !== expectedStageIndex) return;
        if (entry.status === 'ready' && entry.frames.length) {
          this._playPlantAnimation(plant, entry, {
            loop: entry.loop,
            fps: entry.fps
          });
        } else if (entry.status === 'error') {
          this._applyPlantStageGeometryFallback(plant, providedInfo);
        } else if (!entry.frames.length) {
          this._hidePlantVisual(plant);
        }
      };

      if (sequence?.status === 'ready') {
        activateAnimation(sequence);
        return;
      }

      if (sequence?.status === 'loading') {
        if (Array.isArray(sequence.frames) && sequence.frames.length > 0) {
          this._applyPlantPreviewFrame(plant, sequence);
        } else if (plant.activeFrame) {
          this._applyFrameToPlant(plant, plant.activeFrame);
        } else {
          this._hidePlantVisual(plant);
        }

        this._registerPlantSequenceFirstFrameCallback(plant, sequence, (entry) => {
          if (!plant || plant.disposed) return;
          if (plant.stageIndex !== expectedStageIndex) return;
          if (!Array.isArray(entry.frames) || !entry.frames.length) return;
          this._applyPlantPreviewFrame(plant, entry);
        });

        this._registerPlantSequenceCallback(plant, sequence, (entry) => {
          if (!plant || plant.disposed) return;
          if (plant.stageIndex !== expectedStageIndex) return;
          activateAnimation(entry);
        });
        return;
      }

      if (!sequence || sequence.status === 'error') {
        this._applyPlantStageGeometryFallback(plant, providedInfo);
        return;
      }
    }

    this._applyPlantStageGeometryFallback(plant, providedInfo);
  }

  _advancePlantStage(plant, nextIndex) {
    if (!plant || nextIndex <= plant.stageIndex) return;
    if (nextIndex >= this._plantStages.length) return;
    this._startPlantTransition(plant, nextIndex);
  }

  _getPlantStageInfo(seed, stageId) {
    const scales = this.params.plantGrowth?.stageScales || {};
    const baseWidth = seed.width || 0.04;
    const baseHeight = seed.height || 0.12;
    switch (stageId) {
      case 'seed': {
  const radiusSource = baseWidth || baseHeight || 0.02;
        const radius = radiusSource * (scales.seedRadius ?? 0.45);
        const diameter = radius * 2;
        return { type: 'circle', radius, width: diameter, height: diameter };
      }
      case 'germinated': {
        const width = Math.max(baseWidth * (scales.germWidth ?? 0.38), 0.01);
        const height = Math.max(baseHeight * (scales.germHeight ?? 0.35), 0.02);
        return { type: 'plane', width, height };
      }
      case 'small': {
        const width = Math.max(baseWidth * (scales.smallWidth ?? 0.55), 0.012);
        const height = Math.max(baseHeight * (scales.smallHeight ?? 0.55), 0.04);
        return { type: 'plane', width, height };
      }
      case 'medium': {
        const width = Math.max(baseWidth * (scales.mediumWidth ?? 0.75), 0.014);
        const height = Math.max(baseHeight * (scales.mediumHeight ?? 0.78), 0.06);
        return { type: 'plane', width, height };
      }
      case 'large':
      default: {
        const width = Math.max(baseWidth * (scales.largeWidth ?? 1.0), 0.016);
        const height = Math.max(baseHeight * (scales.largeHeight ?? 1.0), 0.08);
        return { type: 'plane', width, height };
      }
    }
  }

  _getPlantGeometry(seed, stageId, info) {
    const key = `${seed.id}:${stageId}`;
    if (this._plantGeometryCache.has(key)) {
      return this._plantGeometryCache.get(key);
    }
    const metrics = info || this._getPlantStageInfo(seed, stageId);
    let geometry;
    if (metrics.type === 'circle') {
      const segments = Math.max(3, Math.floor(this.params.plantGrowth?.geometrySegments ?? 20));
      geometry = new THREE.CircleGeometry(metrics.radius, segments);
    } else {
      geometry = new THREE.PlaneGeometry(metrics.width, metrics.height);
    }
    this._plantGeometryCache.set(key, geometry);
    return geometry;
  }

  _getSeedMaterial(seed) {
    if (this._seedMaterialCache.has(seed.id)) {
      return this._seedMaterialCache.get(seed.id);
    }
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(seed.color || '#7dbf5d'),
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide
    });
    this._seedMaterialCache.set(seed.id, material);
    return material;
  }

  _updatePlants(dt) {
    if (!this._plants.length) return;
    const transitionDuration = Math.max(0.05, this.params.plantGrowth?.transitionDuration ?? 2.0);
    const interactions = this.params.interactions || {};
    const subOffset = Math.max(0, interactions.plantSubmergeOffset ?? 0.004);
    const emerOffset = Math.max(0, interactions.plantEmergenceOffset ?? subOffset);
    const waterSegments = this.params.water.surfaceSegments;
    
    this._competitionTimer = (this._competitionTimer || 0) + dt;
    if (this._competitionTimer >= 0.5) {
      this._evaluatePlantCompetition();
      this._competitionTimer = 0;
    }

    for (let i = 0; i < this._plants.length; i++) {
      const plant = this._plants[i];

      this._updatePlantAnimation(plant, dt);

      if (plant.animation && plant.animation.entry?.type === 'transition') {
        continue;
      }

      if (plant.pendingTransition !== null) {
        this._startPlantTransition(plant, plant.pendingTransition);
        if (plant.animation && plant.animation.entry?.type === 'transition') {
          continue;
        }
        plant.stageTimer = 0;
      }

      const waterHeight = this._heightAt(this._waterHeights, waterSegments, plant.x);
      const plantBase = plant.baseY;
      const isSubmerged = waterHeight >= plantBase + subOffset;
      const isAboveWater = waterHeight <= plantBase - emerOffset;
      const isMaxStage = plant.stageIndex >= this._plantStages.length - 1;

      // Water Intake Logic
      const intakeDuration = Math.max(0.05, this.params.plantGrowth?.waterIntakeDuration ?? 5.0);

      // --- Underwater death logic ---
      // Fixed schedule for ALL plants:
      // start death circle after (intakeDuration + 5s) submerged, then die after another intakeDuration.
      const deathDelayAfterSubmerge = intakeDuration + 5.0;
      const deathProgressDuration = intakeDuration;

      if (isSubmerged) {
        plant.submergedTimer = (plant.submergedTimer || 0) + dt;
        const t = plant.submergedTimer;

        if (t >= deathDelayAfterSubmerge) {
          plant.deathActive = true;
          plant.deathTimer = clamp(t - deathDelayAfterSubmerge, 0, deathProgressDuration);

          if (plant.deathMesh) {
            plant.deathMesh.visible = true;
            plant.deathMesh.material.uniforms.progress.value = plant.deathTimer / deathProgressDuration;
            const centerY = plant.baseY - 0.09;
            plant.deathMesh.position.set(plant.mesh.position.x, centerY, 0.11);
            const loaderScale = 0.035;
            plant.deathMesh.scale.set(loaderScale, loaderScale, 1);
          }

          if (plant.deathTimer >= deathProgressDuration) {
            this._removePlant(plant, { playSound: false });
            i -= 1;
            continue;
          }
        } else {
          plant.deathActive = false;
          plant.deathTimer = 0;
          if (plant.deathMesh) plant.deathMesh.visible = false;
        }
      } else {
        plant.submergedTimer = 0;
        plant.deathTimer = 0;
        plant.deathActive = false;
        if (plant.deathMesh) plant.deathMesh.visible = false;
      }
      
      if (isSubmerged && !isMaxStage) {
        // While submerged, accumulate water intake
        if (!plant.readyToGrow) {
            plant.waterIntakeTimer += dt;
            if (plant.waterIntakeTimer >= intakeDuration) {
                plant.waterIntakeTimer = intakeDuration;
                plant.readyToGrow = true;
            }
        }
        
        // Show loader if not fully charged (and no death circle active yet)
        if (plant.loaderMesh && !plant.readyToGrow) {
            plant.loaderMesh.visible = true;
            plant.loaderMesh.material.uniforms.progress.value = plant.waterIntakeTimer / intakeDuration;
            
            // Position loader: User requested fixed distance BELOW plant base.
            const centerY = plant.baseY - 0.09;
            plant.loaderMesh.position.set(plant.mesh.position.x, centerY, 0.1);
            
            // Fixed size loader (independent of plant size)
            const loaderScale = 0.035; 
            plant.loaderMesh.scale.set(loaderScale, loaderScale, 1);
            
        } else if (plant.loaderMesh) {
            plant.loaderMesh.visible = false;
        }
      } else {
        // Above water or Max Stage
        if (plant.loaderMesh) plant.loaderMesh.visible = false;
      }

      // Glow Logic (Visible whenever ready to grow)
      if (plant.imageMaterial && plant.imageMaterial.userData.glowColor) {
        if (plant.readyToGrow && !isMaxStage) {
            const pulse = 0.3 + 0.2 * Math.sin(this._elapsed * 5.0);
            plant.imageMaterial.userData.glowColor.value.set(pulse, pulse, 0); // Yellowish glow
        } else {
            plant.imageMaterial.userData.glowColor.value.set(0, 0, 0);
        }
      }

      const stageData = this._plantStages[plant.stageIndex];
      if (!stageData) continue;
      
      // Check if we can grow
      // New Logic: Must be above water AND ready to grow (charged)
      // We ignore stageData.nextRequiresSubmerged for the growth condition itself,
      // assuming all stages follow the "Charge -> Grow" cycle.
      
      if (isMaxStage) {
        plant.stageTimer = 0;
        continue;
      }

      if (plant.competitionBlocked) {
        plant.stageTimer = 0;
        continue;
      }

      // Growth Condition: Above Water AND Ready
      if (isAboveWater && plant.readyToGrow) {
        plant.stageTimer += dt;
        if (plant.stageTimer >= transitionDuration) {
          this._advancePlantStage(plant, plant.stageIndex + 1);
          // Reset cycle
          plant.readyToGrow = false;
          plant.waterIntakeTimer = 0;
          if (plant.imageMaterial && plant.imageMaterial.userData.glowColor) {
            plant.imageMaterial.userData.glowColor.value.set(0, 0, 0);
          }
        }
      } else {
        plant.stageTimer = 0;
      }
    }
  }

  _evaluatePlantCompetition() {
    const cfg = this.params.plantCompetition || {};
    const radius = Math.max(0.0001, (cfg.neighborRadius ?? 0.08)) * this.worldWidth;
    const radiusSq = radius * radius;
    const minNeighbors = Math.max(0, cfg.minNeighbors ?? 4);
    const plants = this._plants;
    for (let i = 0; i < plants.length; i++) {
      const plant = plants[i];
      let neighborCount = 0;
      let stageSum = 0;
      for (let j = 0; j < plants.length; j++) {
        if (i === j) continue;
        const other = plants[j];
        const dx = plant.x - other.x;
        const dy = (plant.baseY + (plant.currentStageHeight || 0) * 0.5) - (other.baseY + (other.currentStageHeight || 0) * 0.5);
        if (dx * dx + dy * dy > radiusSq) continue;
        neighborCount += 1;
        stageSum += other.stageIndex || 0;
      }
      if (neighborCount > minNeighbors && neighborCount > 0) {
        const meanStage = stageSum / neighborCount;
        plant.competitionBlocked = plant.stageIndex < meanStage;
      } else {
        plant.competitionBlocked = false;
      }
    }
  }

  _findPlantAt(x, y) {
    let closest = null;
    let closestDistSq = Infinity;
    for (let i = 0; i < this._plants.length; i++) {
      const plant = this._plants[i];
      if (!plant) continue;
      if (plant.visualMode === 'hidden') continue;

      if (plant.visualMode === 'image' && plant.visualWidth && plant.visualHeight) {
        const halfW = plant.visualWidth * 0.5;
        const halfH = plant.visualHeight * 0.5;
        const centerX = plant.x;
        const centerY = plant.mesh?.position?.y ?? (plant.baseY + plant.visualHeight * 0.5);
        const left = centerX - halfW;
        const right = centerX + halfW;
        const bottom = centerY - halfH;
        const top = centerY + halfH;
        if (x < left || x > right || y < bottom || y > top) {
          continue;
        }
        let alpha = 1;
        const frame = plant.activeFrame;
        if (frame?.imageData) {
          const u = (x - left) / (right - left);
          const v = (y - bottom) / (top - bottom);
          alpha = this._sampleFrameAlpha(frame, u, v);
        }
        if (alpha <= 0.5) {
          continue;
        }
        const dx = x - centerX;
        const dy = y - centerY;
        const distSq = dx * dx + dy * dy;
        if (distSq < closestDistSq) {
          closest = plant;
          closestDistSq = distSq;
        }
        continue;
      }

      const height = Math.max(plant.currentStageHeight || 0, 0);
      const centerY = plant.baseY + height * 0.5;
      const dx = x - plant.x;
      const dy = y - centerY;
      const halfWidth = Math.max(plant.currentStageHalfWidth || 0.015, 0.015);
      const radius = Math.max(halfWidth, height * 0.5, 0.02);
      const distSq = dx * dx + dy * dy;
      if (distSq <= radius * radius && distSq < closestDistSq) {
        closest = plant;
        closestDistSq = distSq;
      }
    }
    return closest;
  }

  _removePlant(plant, { playSound = true } = {}) {
    if (!plant) return;
    const index = this._plants.indexOf(plant);
    if (index === -1) return;
    if (playSound) {
      this._playRemovePlantSound();
    }
    this._clearPlantSequenceCallbacks(plant);
    this._releasePlantAnimation(plant);
    if (plant.mesh) {
      this.scene.remove(plant.mesh);
    }
    if (plant.loaderMesh) {
      this.scene.remove(plant.loaderMesh);
      if (plant.loaderMesh.geometry) plant.loaderMesh.geometry.dispose();
      if (plant.loaderMesh.material) plant.loaderMesh.material.dispose();
    }
    if (plant.deathMesh) {
      this.scene.remove(plant.deathMesh);
      if (plant.deathMesh.geometry) plant.deathMesh.geometry.dispose();
      if (plant.deathMesh.material) plant.deathMesh.material.dispose();
    }
    if (plant.glowMesh) {
      this.scene.remove(plant.glowMesh);
      if (plant.glowMesh.geometry) plant.glowMesh.geometry.dispose();
      if (plant.glowMesh.material) plant.glowMesh.material.dispose();
    }
    if (plant.imageMaterial) {
      plant.imageMaterial.dispose?.();
      this._plantMaterialCache.delete(plant.id);
    }
    plant.disposed = true;
    plant.pendingTransition = null;
    plant.waitingTransitionKey = null;
    this._plants.splice(index, 1);
    this._checkStageGoal();
    this._refreshCursor();
    this._updateSeedLabels();
  }

  _checkStageGoal() {
    this._updateProgressBar();
  }

  _onStageGoalReached() {
    if (this._stageComplete) return;
    this._stageComplete = true;
    const stage = this._stages[this._currentStageIndex];
    if (!stage) return;

    this._stopHintCycle();
    this._showMessage(stage.completionMessage || 'Etapa completada.', {
      onComplete: () => this._scheduleStageAdvance()
    });

    const isFinalStage = this._currentStageIndex >= this._stages.length - 1;
    if (isFinalStage) {
      const victoryMsg = this.params.progress?.victoryMessage;
      if (victoryMsg) {
        this._showGoalMessage(victoryMsg);
      }
    } else {
      this._hideGoalMessage();
    }
  }

  _scheduleStageAdvance() {
    this._clearStageAdvanceTimer();
    if (this._currentStageIndex >= this._stages.length - 1) return;
    const gap = Math.max(0, (this.params.progress?.messageGap ?? 1.0) * 1000);
    this._stageAdvanceTimer = setTimeout(() => {
      this._stageAdvanceTimer = null;
      this._advanceStage();
    }, gap);
  }

  _advanceStage() {
    this._clearStageAdvanceTimer();
    if (this._currentStageIndex >= this._stages.length - 1) return;
    this._currentStageIndex += 1;
    this._stageComplete = false;
    this._configureStageTools();
    this._showStageIntro();
  }

  _initProgression() {
    this._clearStageAdvanceTimer();
    this._clearMessageTimer();
    this._stageComplete = false;
    this._currentStageIndex = 0;
    this._configureStageTools();
    this._updateSeedLabels();
    this._showStageIntro();
  }

  _configureStageTools() {
    this._availableSeedIds.clear();
    const stage = this._stages[this._currentStageIndex];
    if (stage?.allowedSeedGroups?.length) {
      stage.allowedSeedGroups.forEach((groupName) => {
        const list = this.params.seeds[groupName];
        if (!Array.isArray(list)) return;
        list.forEach((seed) => {
          this._availableSeedIds.add(seed.id);
        });
      });
    }
    this._removeEnabled = this._currentStageIndex > 0;
    this._sedimentEnabled = this._currentStageIndex < 1;

    const pickDefaultTool = () => {
      if (this._sedimentEnabled) return 'sediment';
      if (this._removeEnabled) return 'remove';
      const iterator = this._availableSeedIds.values();
      const next = iterator.next();
      return next.done ? null : next.value;
    };

    if (!this._sedimentEnabled && this._activeTool === 'sediment') {
      this._activeTool = pickDefaultTool();
    }
    if (!this._isToolAvailable(this._activeTool)) {
      this._activeTool = pickDefaultTool();
    }
    if (!this._activeTool) {
      this._activeTool = pickDefaultTool();
    }
    this._syncToolButtons();
    this._restartStageHints();
    this._updateProgressBar();

    this._updateSeedLabels();
    this._onStageChanged(stage?.id);
  }

  _updateSeedLabels() {
    const stage = this._stages[this._currentStageIndex];
    
    // Let's try to find the goal for this species in the current stage.
    let speciesGoals = {};
    if (stage && stage.goal && stage.goal.type === 'plantCounts') {
        speciesGoals = stage.goal.species || {};
    }

    for (const [seedId, buttonData] of Object.entries(this._seedButtons)) {
        if (!buttonData.label) continue;
        
        const seedDef = buttonData.seed;
        const baseLabel = seedDef.label || seedId;
        
        // Always show count, defaulting target to 0 if not defined in current stage
        const target = speciesGoals[seedId] !== undefined ? speciesGoals[seedId] : 0;
        
        // Count planted plants of this species (any stage)
        const current = this._plants.filter(p => 
            p.seed?.id === seedId
        ).length;
        
        buttonData.label.textContent = `${baseLabel} (${current}/${target})`;
    }
  }

  _getStageHints(stage) {
    if (!stage) return [];
    return Array.isArray(stage.hints) ? stage.hints : [];
  }

  _showGoalMessage(text) {
    if (!this._goalMessageEl || !text) {
      this._hideGoalMessage();
      return;
    }
    const el = this._goalMessageEl;
    if (this._goalMessageHideTimer) {
      clearTimeout(this._goalMessageHideTimer);
      this._goalMessageHideTimer = null;
    }
    el.textContent = text;
    el.style.display = 'block';
    const transition = this._goalMessageTransition;
    if (transition) {
      el.style.transition = 'none';
    }
    el.style.opacity = '0';
    el.style.transform = this._goalMessageHiddenTransform;
    // Force reflow so the transition can retrigger even if already visible.
    void el.offsetWidth;
    if (transition) {
      el.style.transition = transition;
    }
    requestAnimationFrame(() => {
      if (!this._goalMessageEl || this._goalMessageEl.textContent !== text) return;
      this._goalMessageEl.style.opacity = '1';
      this._goalMessageEl.style.transform = this._goalMessageVisibleTransform;
    });
  }

  _hideGoalMessage(immediate = false) {
    if (!this._goalMessageEl) return;
    if (this._goalMessageHideTimer) {
      clearTimeout(this._goalMessageHideTimer);
      this._goalMessageHideTimer = null;
    }
    const el = this._goalMessageEl;
    if (immediate || !this._goalMessageTransitionDurationMs) {
      const transition = this._goalMessageTransition;
      if (transition) {
        el.style.transition = 'none';
      }
      el.style.opacity = '0';
      el.style.transform = this._goalMessageHiddenTransform;
      el.style.display = 'none';
      el.textContent = '';
      void el.offsetWidth;
      if (transition) {
        el.style.transition = transition;
      }
      return;
    }

    el.style.opacity = '0';
    el.style.transform = this._goalMessageHiddenTransform;
    const delay = Math.max(0, this._goalMessageTransitionDurationMs);
    this._goalMessageHideTimer = setTimeout(() => {
      this._goalMessageHideTimer = null;
      if (!this._goalMessageEl) return;
      this._goalMessageEl.style.display = 'none';
      this._goalMessageEl.textContent = '';
    }, delay);
  }

  _stopHintCycle(options = {}) {
    const { hide = true, immediate = false } = options;
    if (this._hintShowTimer) {
      clearTimeout(this._hintShowTimer);
      this._hintShowTimer = null;
    }
    if (this._hintDelayTimer) {
      clearTimeout(this._hintDelayTimer);
      this._hintDelayTimer = null;
    }
    this._hintCycle = null;
    
    // Stop hint audio
    if (this._tutorialAudio) {
      this._tutorialAudio.pause();
      this._tutorialAudio.currentTime = 0;
    }

    if (hide) {
      this._hideGoalMessage(immediate);
    }
  }

  _restartStageHints() {
    this._stopHintCycle();
    if (this._stageComplete) return;
    const stage = this._stages[this._currentStageIndex];
    const hints = this._getStageHints(stage);
    if (!hints.length || !this._goalMessageEl) {
      this._hideGoalMessage();
      return;
    }
    this._hintCycle = { hints, index: 0 };
    this._runHintCycle();
  }

  _runHintCycle() {
    if (this._stageComplete) return;
    const state = this._hintCycle;
    if (!state || !Array.isArray(state.hints) || !state.hints.length || !this._goalMessageEl) {
      return;
    }

    const showSeconds = Math.max(0, this.params.progress?.hintDurations?.showSeconds ?? 10);
    const delaySeconds = Math.max(0, this.params.progress?.hintDurations?.delaySeconds ?? 30);
    const index = state.index % state.hints.length;
    const message = state.hints[index];
    this._showGoalMessage(message);
    
    // Play hint audio
    if (this._tutorialAudio) {
      const stage = this._stages[this._currentStageIndex];
      if (stage && stage.id) {
        const audioPath = `/game-assets/simulador/voiceovers/hint_${stage.id}_${index}.mp3`;
        this._tutorialAudio.src = audioPath;
        this._tutorialAudio.play().catch(e => console.warn("Hint audio play failed", e));
      }
    }

    state.index = (index + 1) % state.hints.length;

    const showMs = Math.max(0, showSeconds * 1000);
    const delayMs = Math.max(0, delaySeconds * 1000);

    if (showMs === 0 && delayMs === 0) {
      return;
    }

    if (this._hintShowTimer) {
      clearTimeout(this._hintShowTimer);
    }
    this._hintShowTimer = setTimeout(() => {
      this._hintShowTimer = null;
      if (!this._hintCycle || this._stageComplete) {
        return;
      }
      this._hideGoalMessage();
      if (delayMs === 0) {
        this._runHintCycle();
        return;
      }
      if (this._hintDelayTimer) {
        clearTimeout(this._hintDelayTimer);
      }
      this._hintDelayTimer = setTimeout(() => {
        this._hintDelayTimer = null;
        if (!this._hintCycle || this._stageComplete) {
          return;
        }
        this._runHintCycle();
      }, delayMs);
    }, showMs);
  }

  _showStageIntro() {
    const stage = this._stages[this._currentStageIndex];
    if (!stage) return;
    const title = stage.name ? `${stage.name}` : 'Nueva etapa';
    const message = stage.introMessage ? `${stage.introMessage}` : '';
    const text = message ? `${title}: ${message}` : title;
    this._queueStageIntro(text);
  }

  _queueStageIntro(text) {
    this._pendingStageIntroText = text || '';
    this._flushStageIntroIfReady();
  }

  _flushStageIntroIfReady() {
    if (!this._pendingStageIntroText) return;
    const tutorialActive = this._tutorial?.active || this._tutorial?.paused || (this._tutorial?.queue?.length ?? 0) > 0;
    if (tutorialActive) return;
    const text = this._pendingStageIntroText;
    this._pendingStageIntroText = '';
    this._showMessage(text);
  }

  _showMessage(text, options = {}) {
    if (!this.app?.root) return;
    const { colors, ui, progress } = this.params;
    const duration = Math.max(0.1, options.duration ?? (progress?.messageDuration ?? 5));
    const fadeDuration = Math.max(0.1, progress?.messageFadeDuration ?? 0.6);

    if (!this._messageEl) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.left = '50%';
      el.style.top = '12vh';
      el.style.transform = 'translate(-50%, -4vh)';
      el.style.padding = '1.6vh 3vw';
      el.style.background = colors.uiBackgroundActive;
      el.style.borderRadius = `${(ui.borderRadius * 120).toFixed(3)}vmin`;
      el.style.boxShadow = `0 0 ${(ui.gap * 220).toFixed(3)}vh rgba(0,0,0,${ui.shadowOpacity})`;
      el.style.color = colors.uiText;
  el.style.fontSize = `${(ui.fontScale * 110).toFixed(3)}vmin`;
      el.style.fontWeight = '600';
      el.style.textAlign = 'center';
      el.style.pointerEvents = 'none';
      el.style.opacity = '0';
      el.style.transition = `opacity ${fadeDuration}s ease, transform ${fadeDuration}s ease`;
      el.style.zIndex = '12';
      if (this._uiFontFamily) {
        el.style.fontFamily = this._uiFontFamily;
      }
      this.app.root.appendChild(el);
      this._messageEl = el;
    }

    this._messageEl.textContent = text;
    this._messageEl.style.opacity = '0';
    this._messageEl.style.transform = 'translate(-50%, -4vh)';

    this._clearMessageTimer();

    requestAnimationFrame(() => {
      if (!this._messageEl) return;
      this._messageEl.style.opacity = '1';
      this._messageEl.style.transform = 'translate(-50%, 0)';
    });

    this._messageTimer = setTimeout(() => {
      this._messageTimer = null;
      this._hideMessage(options.onComplete);
    }, duration * 1000);
  }

  _hideMessage(onHidden) {
    if (!this._messageEl) {
      if (onHidden) onHidden();
      return;
    }
    const fadeDuration = Math.max(0.1, this.params.progress?.messageFadeDuration ?? 0.6);
    this._messageEl.style.opacity = '0';
    this._messageEl.style.transform = 'translate(-50%, -3vh)';

    this._messageHideTimer = setTimeout(() => {
      this._removeMessageEl();
      if (onHidden) onHidden();
      this._messageHideTimer = null;
    }, fadeDuration * 1000);
  }

  _removeMessageEl() {
    if (this._messageEl && this._messageEl.parentElement) {
      this._messageEl.parentElement.removeChild(this._messageEl);
    }
    this._messageEl = null;
  }

  _clearMessageTimer() {
    if (this._messageTimer) {
      clearTimeout(this._messageTimer);
      this._messageTimer = null;
    }
    if (this._messageHideTimer) {
      clearTimeout(this._messageHideTimer);
      this._messageHideTimer = null;
    }
  }

  _clearStageAdvanceTimer() {
    if (this._stageAdvanceTimer) {
      clearTimeout(this._stageAdvanceTimer);
      this._stageAdvanceTimer = null;
    }
  }

  _updateSediment(dt) {
    if (!this._particles.length) return;
    const { sediment } = this.params;
    const max = this._particles.length;
    const positions = this._particlePositions;
    const alphas = this._particleAlphas;
    const waterSegments = this.params.water.surfaceSegments;
    const arrivalThresholdWorld = Math.max(1e-4, sediment.arrivalThreshold) * this.worldWidth;

    let positionsDirty = false;
    let alphaDirty = false;

    for (let i = 0; i < max; i++) {
      const p = this._particles[i];
      const idx = i * 3;

      if (!p.active) {
        if (positions[idx] !== 0 || positions[idx + 1] !== 0 || positions[idx + 2] !== 0 || alphas[i] !== 0) {
          positions[idx] = positions[idx + 1] = positions[idx + 2] = 0;
          alphas[i] = 0;
          positionsDirty = true;
          alphaDirty = true;
        }
        continue;
      }

    p.age += dt;

    // Drift the particle left from the spawn edge at a fixed horizontal speed.
    const nextX = Math.max(p.targetX, p.x - p.horizontalSpeed * dt);
      p.x = nextX;

      const waterHeight = this._heightAt(this._waterHeights, waterSegments, p.x);
      const bandTop = waterHeight - sediment.bandSurfaceOffset * this.worldHeight;
      const bandDepthWorld = Math.max(1e-5, sediment.bandDepth * this.worldHeight);
      const bandBottom = bandTop - bandDepthWorld;
      const bandRange = Math.max(1e-5, bandTop - bandBottom);

    // Stay inside the vertical band that tracks the water surface, adding gentle jitter.
    const jitter = Math.sin(this._elapsed * p.jitterSpeed + p.jitterPhase) * p.jitterAmplitude;
      const base = saturate(p.bandBase + jitter);
      let desiredY = bandBottom + base * bandRange;

      if (p.x <= p.approachStartX) {
        const span = Math.max(1e-5, p.approachSpan);
        const progress = saturate((p.approachStartX - p.x) / span);
        desiredY = lerp(desiredY, p.targetY, progress);
      }

      p.y = desiredY;

      if (p.x <= p.targetX + arrivalThresholdWorld) {
        p.x = p.targetX;
        p.y = p.targetY;
        this._playSedimentImpactSound();
        this._raiseRiverbed(p.x, sediment.depositAmount);
        this._deactivateParticle(p, i);
        this._refreshCursor();
        positionsDirty = true;
        alphaDirty = true;
        continue;
      }

  positions[idx + 0] = p.x;
  positions[idx + 1] = p.y;
  positions[idx + 2] = -0.02;
      positionsDirty = true;

      alphas[i] = 1;
      alphaDirty = true;
    }

    if (positionsDirty && this._particlesGeometry) {
      this._particlesGeometry.attributes.position.needsUpdate = true;
    }
    if (alphaDirty && this._particlesGeometry) {
      this._particlesGeometry.attributes.alpha.needsUpdate = true;
    }
  }

  _deactivateParticle(p, index) {
    if (!p?.active) return;
    p.active = false;
    const base = index * 3;
    this._particlePositions[base] = 0;
    this._particlePositions[base + 1] = 0;
    this._particlePositions[base + 2] = 0;
    this._particleAlphas[index] = 0;
    p.age = 0;
    p.bandBase = 0;
    p.jitterPhase = 0;
    p.jitterSpeed = 0;
    p.jitterAmplitude = 0;
    p.horizontalSpeed = 0;
    p.targetX = 0;
    p.targetY = 0;
    p.approachStartX = 0;
    p.approachSpan = 1;
    this._activeParticles = Math.max(0, this._activeParticles - 1);
  }

  _raiseRiverbed(x, amount) {
    const { sediment, riverbed } = this.params;
    const segments = riverbed.segments;
    const radius = sediment.depositRadius * this.worldWidth;
    const center = clamp(x, 0, this.worldWidth);

    // Define mound boundaries where sediment can accumulate
    const plateauStartRaw = clamp(riverbed.plateauStart ?? 0.2, 0, 1);
    const plateauEndRaw = clamp(riverbed.plateauEnd ?? 0.8, 0, 1);
    const plateauStart = Math.min(plateauStartRaw, plateauEndRaw);
    const plateauEnd = Math.max(plateauStartRaw, plateauEndRaw);
    const transitionWidth = Math.max(0.0001, riverbed.transitionWidth ?? 0.1);
    const halfTransition = transitionWidth * 0.5;
    const innerStart = plateauStart;
    const innerEnd = plateauEnd;
    const outerStart = clamp(innerStart - halfTransition, 0, 1);
    const outerEnd = clamp(innerEnd + halfTransition, 0, 1);
    const outerStartWorld = outerStart * this.worldWidth;
    const outerEndWorld = outerEnd * this.worldWidth;
    const leftSpan = Math.max(1e-5, innerStart - outerStart);
    const rightSpan = Math.max(1e-5, outerEnd - innerEnd);

    // --- Island growth ceiling (plateau-only): noisy parabola above average water level ---
    const capCfg = riverbed.growthCap ?? {};
    const capEnabled = capCfg.enabled !== false;
    const islandSpan = Math.max(1e-5, innerEnd - innerStart);

    const avgWaterLevel = (this._waterLevels?.medium ?? this.params.water?.baseLevel ?? 0);
    const noiseAmp = Math.max(0, capCfg.noiseAmplitude ?? 0);
    // Ensure the cap always stays above average water level (even with negative noise).
    const baseAboveAverage = Math.max(noiseAmp + 0.02, capCfg.baseAboveAverageWater ?? 0.09);
    const baseCap = avgWaterLevel + baseAboveAverage;
    const sideLift = Math.max(0, capCfg.sideLift ?? 0);
    const noiseFreq = Math.max(1e-4, capCfg.noiseFrequency ?? 1);
    const capSeed = (typeof capCfg.seed === 'number' && Number.isFinite(capCfg.seed)) ? capCfg.seed : 0;

    const plateauCapAtU = (u) => {
      const uClamped = clamp(u, 0, 1);
      const parabola = 4 * (uClamped - 0.5) * (uClamped - 0.5); // 0 at center, 1 at sides
      const capNoise = this._noise2D(uClamped * noiseFreq + capSeed * 0.13, capSeed) * noiseAmp;
      const profile = baseCap + sideLift * parabola + capNoise;
      return clamp(profile, riverbed.bottom, riverbed.maxHeight);
    };

    const capAtIndex = (i, normalized) => {
      if (!capEnabled) return riverbed.maxHeight;
      if (normalized < outerStart || normalized > outerEnd) return riverbed.maxHeight;

      const baseAtX = (this._riverbedBase?.[i] ?? riverbed.bottom);
      const leftEdgeCap = plateauCapAtU(0);
      const rightEdgeCap = plateauCapAtU(1);

      // Plateau: parabolic (with subtle noise) maximum height.
      if (normalized >= innerStart && normalized <= innerEnd) {
        const u = (normalized - innerStart) / islandSpan;
        return plateauCapAtU(u);
      }

      // Transition zones: smoothly blend down to the baseline so we don't get spikes.
      if (normalized < innerStart) {
        const t = saturate((normalized - outerStart) / leftSpan);
        return lerp(baseAtX, leftEdgeCap, smoothstep(0, 1, t));
      }
      const t = saturate((outerEnd - normalized) / rightSpan);
      return lerp(baseAtX, rightEdgeCap, smoothstep(0, 1, t));
    };

    let changed = false;
    for (let i = 0; i <= segments; i++) {
      const px = this.worldWidth * (i / segments);
      const dist = Math.abs(px - center);
      if (dist > radius) continue;
      
      // Only allow growth inside the mound boundaries, easing into/out of the plateau
      if (px < outerStartWorld || px > outerEndWorld) continue;

      const normalized = px / this.worldWidth;
      let boundaryFactor = 1;
      if (normalized < innerStart) {
        const t = saturate((normalized - outerStart) / leftSpan);
        boundaryFactor = smoothstep(0, 1, t);
      } else if (normalized > innerEnd) {
        const t = saturate((outerEnd - normalized) / rightSpan);
        boundaryFactor = smoothstep(0, 1, t);
      }
      if (boundaryFactor <= 0) continue;

      const weight = Math.cos((dist / radius) * Math.PI * 0.5);
      const delta = amount * weight * weight * boundaryFactor;

      const maxAtX = capAtIndex(i, normalized);
      const next = clamp(this._riverbedHeights[i] + delta, riverbed.bottom, maxAtX);
      if (next !== this._riverbedHeights[i]) {
        this._riverbedHeights[i] = next;
        changed = true;
      }
    }
    if (changed) {
      this._riverbedDirty = true;
      this._checkEmergence();
    }
  }

  _heightAt(array, segments, x) {
    const t = clamp(x / this.worldWidth, 0, 1);
    const exact = t * segments;
    const i0 = Math.floor(exact);
    const i1 = clamp(i0 + 1, 0, segments);
    const frac = exact - i0;
    const h0 = array[i0] ?? 0;
    const h1 = array[i1] ?? h0;
    return lerp(h0, h1, frac);
  }

  _sampleHeightsAt(x) {
    return {
      waterHeight: this._heightAt(this._waterHeights, this.params.water.surfaceSegments, x),
      riverbedHeight: this._heightAt(this._riverbedHeights, this.params.riverbed.segments, x)
    };
  }

  _resolveInteractionState(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    const { waterHeight, riverbedHeight } = this._sampleHeightsAt(x);
    const interaction = this.params.interactions || {};
    const sedimentGap = interaction.sedimentHeightEpsilon ?? 0.006;
    const plantGap = interaction.plantHeightEpsilon ?? 0.02;

    const canSediment = y < (waterHeight - sedimentGap)
      && y > (riverbedHeight + sedimentGap)
      && waterHeight - riverbedHeight > sedimentGap * 2;

    const canPlant = riverbedHeight > waterHeight + sedimentGap
      && y > waterHeight + sedimentGap
      && y <= riverbedHeight + plantGap;

    return { waterHeight, riverbedHeight, canSediment, canPlant };
  }

  _checkEmergence() {
    this._updateProgressBar();
  }

  _emitSediment(worldX, worldY, stateOverride) {
    const { sediment } = this.params;
    const waterSegments = this.params.water.surfaceSegments;
    const bedSegments = this.params.riverbed.segments;
    if (!this._waterHeights.length) return;

    const state = stateOverride ?? this._resolveInteractionState(worldX, worldY);
    if (!state?.canSediment) return;
    const waterHeightAtClick = state.waterHeight;

    const spawnBase = this.worldWidth + sediment.spawnOffset * this.worldWidth;
    const spawnJitterX = sediment.spawnJitterX * this.worldWidth;
    const approachWindow = sediment.approachWindow * this.worldWidth;
    const arrivalThreshold = Math.max(1e-4, sediment.arrivalThreshold) * this.worldWidth;
    const approachLeadBase = Math.max(0, sediment.approachLead * this.worldWidth);

    const bandDepthWorld = Math.max(1e-5, sediment.bandDepth * this.worldHeight);
    const bandSurfaceOffset = sediment.bandSurfaceOffset * this.worldHeight;

    const count = sediment.emissionPerClick;
    let emitted = 0;

    for (let i = 0; i < count; i++) {
      const slot = this._acquireParticle();
      if (!slot) break;
      const { particle, index } = slot;

      const targetX = clamp(
        worldX + (Math.random() * 2 - 1) * approachWindow,
        0,
        this.worldWidth
      );
      const targetY = this._heightAt(this._riverbedHeights, bedSegments, targetX);

      const leadFactor = 0.7 + Math.random() * 0.6;
      const desiredApproachLead = approachLeadBase * leadFactor;

      let spawnX = spawnBase + (Math.random() - 0.5) * spawnJitterX;
      const minSpawnX = this.worldWidth + 0.02 * this.worldWidth;
      spawnX = Math.max(spawnX, minSpawnX, targetX + desiredApproachLead + arrivalThreshold);

      let approachStartX = Math.min(spawnX - arrivalThreshold, targetX + desiredApproachLead);
      if (approachStartX <= targetX + arrivalThreshold) {
        approachStartX = targetX + arrivalThreshold;
      }

      const waterHeightAtSpawn = this._heightAt(this._waterHeights, waterSegments, this.worldWidth);
      const bandTop = waterHeightAtSpawn - bandSurfaceOffset;
      const bandBottom = bandTop - bandDepthWorld;
      const bandRange = Math.max(1e-5, bandTop - bandBottom);

      const baseSample = Math.random();
      const baseOffset = (Math.random() - 0.5) * sediment.bandBaseJitter;
      const bandBase = clamp(baseSample + baseOffset, 0.05, 0.95);
      const initialY = bandBottom + bandBase * bandRange;

      const speedVariation = lerp(1 - sediment.horizontalSpeedJitter, 1 + sediment.horizontalSpeedJitter, Math.random());

      particle.x = spawnX;
      particle.y = initialY;
      particle.age = 0;
      particle.bandBase = bandBase;
      particle.jitterPhase = Math.random() * Math.PI * 2;
      particle.jitterSpeed = lerp(
        sediment.verticalJitterFrequencyMin,
        sediment.verticalJitterFrequencyMax,
        Math.random()
      );
      particle.jitterAmplitude = sediment.verticalJitterAmplitude * (0.5 + Math.random() * 0.5);
      particle.horizontalSpeed = Math.max(1e-3, this.worldWidth * sediment.horizontalSpeed * speedVariation);
      particle.targetX = targetX;
      particle.targetY = targetY;
      particle.approachStartX = approachStartX;
      particle.approachSpan = Math.max(arrivalThreshold, particle.approachStartX - targetX);

      const posIdx = index * 3;
  this._particlePositions[posIdx + 0] = particle.x;
  this._particlePositions[posIdx + 1] = particle.y;
  this._particlePositions[posIdx + 2] = -0.02;

      this._particleAlphas[index] = 1;

      emitted += 1;
    }

    if (emitted > 0 && this._particlesGeometry) {
      this._particlesGeometry.attributes.position.needsUpdate = true;
      this._particlesGeometry.attributes.alpha.needsUpdate = true;
    }

    if (emitted > 0) {
      this._refreshCursor();
    }
    return emitted > 0;
  }

  _acquireParticle() {
    for (let i = 0; i < this._particles.length; i++) {
      const p = this._particles[i];
      if (!p.active) {
        const idx = i * 3;
        this._particlePositions[idx] = this._particlePositions[idx + 1] = this._particlePositions[idx + 2] = 0;
        this._particleAlphas[i] = 1;
        p.active = true;
        p.age = 0;
        this._activeParticles += 1;
        return { particle: p, index: i };
      }
    }
    return null;
  }

  _createUI() {
    const { ui, colors } = this.params;
    const elements = ui.elements || {};
    const basePath = elements.basePath || '';

    this._applyFontSettings();

    this._uiRectEntries = [];
    this._uiAssetBasePath = basePath;
    this._weatherConfig = elements.weather || null;
    this._buttons = {};
    this._seedButtons = {};

    this._seedCatalog.clear();
    const seedGroups = this.params.seeds || {};
    ['colonizers', 'nonColonizers'].forEach((groupName) => {
      const list = seedGroups[groupName];
      if (!Array.isArray(list)) return;
      for (let i = 0; i < list.length; i++) {
        const seed = list[i];
        if (seed?.id) {
          this._seedCatalog.set(seed.id, seed);
        }
      }
    });

    const resolveAsset = (file) => this._normalizeAssetPath(basePath, file);

    const root = document.createElement('div');
    root.style.position = 'absolute';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '5';
    root.style.userSelect = 'none';
    root.style.webkitUserSelect = 'none';
    if (this._uiFontFamily) {
      root.style.fontFamily = this._uiFontFamily;
    }

    const weatherCfg = this._weatherConfig;
    const topSheetMeta = weatherCfg?.top
      ? this._createWeatherSheetMeta(weatherCfg.top, basePath)
      : null;
    const bottomSheetMeta = weatherCfg?.bottom
      ? this._createWeatherSheetMeta(weatherCfg.bottom, basePath)
      : null;
    let topImage = null;
    let bottomImage = null;
    let lowerBtn = null;
    let raiseBtn = null;
    let topContainer = null;
    let bottomContainer = null;

    if (weatherCfg?.top?.area) {
      topContainer = document.createElement('div');
      topContainer.style.position = 'absolute';
      this._applyViewportRect(topContainer, weatherCfg.top.area);
      topContainer.style.pointerEvents = 'none';
      topContainer.style.display = 'block';
      topContainer.style.userSelect = 'none';
      topContainer.style.webkitUserSelect = 'none';
      if (Number.isFinite(weatherCfg.top.area.zIndex)) {
        topContainer.style.zIndex = String(weatherCfg.top.area.zIndex);
      }

      if (topSheetMeta) {
        topContainer.style.display = 'flex';
        topContainer.style.justifyContent = 'center';
        topContainer.style.alignItems = 'center';

        topImage = document.createElement('img');
        topImage.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${topSheetMeta.frameWidth}' height='${topSheetMeta.frameHeight}'%3E%3C/svg%3E`;
        topImage.style.display = 'block';
        topImage.style.width = 'auto';
        topImage.style.height = 'auto';
        topImage.style.maxWidth = '100%';
        topImage.style.maxHeight = '100%';
        topImage.style.objectFit = 'contain';
        topImage.style.pointerEvents = 'none';
        
        topImage.style.backgroundImage = `url(${topSheetMeta.src})`;
        topImage.style.backgroundRepeat = 'no-repeat';
        topImage.style.backgroundSize = `${topSheetMeta.columns * 100}% ${topSheetMeta.rows * 100}%`;
        topImage.style.backgroundPosition = '0% 0%';
        topImage.style.imageRendering = 'auto';
        topContainer.appendChild(topImage);
      } else {
        topImage = document.createElement('img');
        topImage.src = this._weatherFrameToUrl('top', weatherCfg.top.frames?.low);
        topImage.style.width = '100%';
        topImage.style.height = '100%';
        topImage.style.objectFit = 'contain';
        topImage.style.pointerEvents = 'none';
        topImage.draggable = false;
        topContainer.appendChild(topImage);
      }
    }

    if (weatherCfg?.bottom?.area) {
      bottomContainer = document.createElement('div');
      bottomContainer.style.position = 'absolute';
      this._applyViewportRect(bottomContainer, weatherCfg.bottom.area);
      bottomContainer.style.pointerEvents = 'auto';
      bottomContainer.style.display = 'block';
      bottomContainer.style.background = 'transparent';
      bottomContainer.style.userSelect = 'none';
      bottomContainer.style.webkitUserSelect = 'none';
      if (Number.isFinite(weatherCfg.bottom.area.zIndex)) {
        bottomContainer.style.zIndex = String(weatherCfg.bottom.area.zIndex);
      }

      const useSheet = !!bottomSheetMeta;
      if (useSheet) {
        bottomContainer.style.display = 'flex';
        bottomContainer.style.justifyContent = 'center';
        bottomContainer.style.alignItems = 'center';

        bottomImage = document.createElement('img');
        bottomImage.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${bottomSheetMeta.frameWidth}' height='${bottomSheetMeta.frameHeight}'%3E%3C/svg%3E`;
        bottomImage.style.display = 'block';
        bottomImage.style.width = 'auto';
        bottomImage.style.height = 'auto';
        bottomImage.style.maxWidth = '100%';
        bottomImage.style.maxHeight = '100%';
        bottomImage.style.objectFit = 'contain';
        bottomImage.style.pointerEvents = 'none';

        bottomImage.style.backgroundImage = `url(${bottomSheetMeta.src})`;
        bottomImage.style.backgroundRepeat = 'no-repeat';
        bottomImage.style.backgroundSize = `${bottomSheetMeta.columns * 100}% ${bottomSheetMeta.rows * 100}%`;
        bottomImage.style.backgroundPosition = '0% 0%';
        bottomImage.style.imageRendering = 'auto';
        bottomContainer.appendChild(bottomImage);
      } else {
        bottomImage = document.createElement('img');
        bottomImage.src = this._weatherFrameToUrl('bottom', weatherCfg.bottom.frames?.low);
        bottomImage.style.width = '100%';
        bottomImage.style.height = '100%';
        bottomImage.style.objectFit = 'contain';
        bottomImage.style.pointerEvents = 'none';
        bottomImage.draggable = false;
        bottomContainer.appendChild(bottomImage);
      }

      lowerBtn = document.createElement('div');
      lowerBtn.style.position = 'absolute';
      lowerBtn.style.left = '0';
      lowerBtn.style.top = '0';
      lowerBtn.style.width = '50%';
      lowerBtn.style.height = '100%';
      lowerBtn.style.pointerEvents = 'auto';
      lowerBtn.style.cursor = 'pointer';
      lowerBtn.style.background = 'transparent';
      lowerBtn.style.touchAction = 'manipulation';
      lowerBtn.style.userSelect = 'none';
      lowerBtn.style.webkitUserSelect = 'none';
      lowerBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this._resumeAmbientAudio();
        this._setWaterLevel(this._waterLevelIndex - 1);
      });
      bottomContainer.appendChild(lowerBtn);

      raiseBtn = document.createElement('div');
      raiseBtn.style.position = 'absolute';
      raiseBtn.style.left = '50%';
      raiseBtn.style.top = '0';
      raiseBtn.style.width = '50%';
      raiseBtn.style.height = '100%';
      raiseBtn.style.pointerEvents = 'auto';
      raiseBtn.style.cursor = 'pointer';
      raiseBtn.style.background = 'transparent';
      raiseBtn.style.touchAction = 'manipulation';
      raiseBtn.style.userSelect = 'none';
      raiseBtn.style.webkitUserSelect = 'none';
      raiseBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this._resumeAmbientAudio();
        this._setWaterLevel(this._waterLevelIndex + 1);
      });
      bottomContainer.appendChild(raiseBtn);
      root.appendChild(bottomContainer);
    }

    if (topContainer) {
      root.appendChild(topContainer);
    }

    if (topImage || bottomImage) {
      this._buttons.weather = {
        topImage,
        bottomImage,
        lower: lowerBtn,
        raise: raiseBtn,
        topContainer,
        bottomContainer
      };
    }
    this._weatherChannels = {};
    this._weatherAnimations = {};
    this._weatherCurrentFrame = { top: null, bottom: null };
    if (topImage && weatherCfg?.top) {
      this._weatherChannels.top = {
        image: topImage,
        config: weatherCfg.top,
        sheet: topSheetMeta || null
      };
    }
    if (bottomImage && weatherCfg?.bottom) {
      this._weatherChannels.bottom = {
        image: bottomImage,
        config: weatherCfg.bottom,
        sheet: bottomSheetMeta || null
      };
    }

    if (this._weatherChannels.top && weatherCfg?.top?.frames?.low !== undefined) {
      this._setWeatherFrame('top', weatherCfg.top.frames.low);
    }
    if (this._weatherChannels.bottom && weatherCfg?.bottom?.frames?.low !== undefined) {
      this._setWeatherFrame('bottom', weatherCfg.bottom.frames.low);
    }

    if (elements.sedimentButton?.image) {
      const sedimentBtn = document.createElement('img');
      sedimentBtn.src = resolveAsset(elements.sedimentButton.image);
      sedimentBtn.style.position = 'absolute';
      this._applyViewportRect(sedimentBtn, elements.sedimentButton);
      sedimentBtn.style.pointerEvents = 'auto';
      sedimentBtn.style.cursor = 'pointer';
      sedimentBtn.style.userSelect = 'none';
      sedimentBtn.style.transition = 'transform 0.15s ease, filter 0.15s ease';
      if (Number.isFinite(elements.sedimentButton.zIndex)) {
        sedimentBtn.style.zIndex = String(elements.sedimentButton.zIndex);
      }
      sedimentBtn.draggable = false;
      sedimentBtn.style.userSelect = 'none';
      sedimentBtn.style.webkitUserSelect = 'none';
      sedimentBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this._resumeAmbientAudio();
        this._toggleTool('sediment');
      });
      root.appendChild(sedimentBtn);
      this._buttons.sediment = sedimentBtn;
    }

    if (elements.removeButton?.image) {
      const removeBtn = document.createElement('img');
      removeBtn.src = resolveAsset(elements.removeButton.image);
      removeBtn.style.position = 'absolute';
      this._applyViewportRect(removeBtn, elements.removeButton);
      removeBtn.style.pointerEvents = 'auto';
      removeBtn.style.cursor = 'pointer';
      removeBtn.style.userSelect = 'none';
      removeBtn.style.transition = 'transform 0.15s ease, filter 0.15s ease';
      if (Number.isFinite(elements.removeButton.zIndex)) {
        removeBtn.style.zIndex = String(elements.removeButton.zIndex);
      }
      removeBtn.draggable = false;
      removeBtn.style.userSelect = 'none';
      removeBtn.style.webkitUserSelect = 'none';
      removeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this._resumeAmbientAudio();
        this._toggleTool('remove');
      });
      root.appendChild(removeBtn);
      this._buttons.remove = removeBtn;
    }

    if (elements.seeder?.image) {
      const seederCfg = elements.seeder;
      const seederContainer = document.createElement('div');
      seederContainer.style.position = 'absolute';
      this._applyViewportRect(seederContainer, seederCfg);
      seederContainer.style.pointerEvents = 'auto';
      seederContainer.style.backgroundImage = `url(${resolveAsset(seederCfg.image)})`;
      seederContainer.style.backgroundSize = '100% 100%';
      seederContainer.style.backgroundRepeat = 'no-repeat';
      seederContainer.style.display = 'block';
      seederContainer.style.transition = 'transform 0.15s ease';
      seederContainer.style.userSelect = 'none';
      seederContainer.style.webkitUserSelect = 'none';
      if (Number.isFinite(seederCfg.zIndex)) {
        seederContainer.style.zIndex = String(seederCfg.zIndex);
      }
      root.appendChild(seederContainer);

      const segments = Math.max(1, seederCfg.segments || 1);
      const seedOrder = Array.isArray(seederCfg.seedOrder) ? seederCfg.seedOrder : [];
      const segmentHeight = 100 / segments;
      const seederMaskUrl = resolveAsset(seederCfg.image);
      const segmentMaskSize = `100% ${segments * 100}%`;
      const seedImageScale = clamp(seederCfg.seedImageScale ?? 1, 0.05, 1);
      const labelCfg = seederCfg.label || {};
      const labelTransitionSeconds = Math.max(0.05, labelCfg.transitionSeconds ?? 0.2);
      const hiddenOffsetVW = labelCfg.hiddenOffsetVW ?? 1.2;
      const labelGapVW = labelCfg.rightGapVW ?? 0.8;
      const slideEasing = labelCfg.transitionEasing || 'cubic-bezier(0.33, 1, 0.68, 1)';
      const opacityEasing = labelCfg.opacityEasing || slideEasing;
      const hiddenTransform = `translate3d(${hiddenOffsetVW}vw, -50%, 0)`;
      const visibleTransform = 'translate3d(0, -50%, 0)';
      const labelShadow = labelCfg.shadow || '0 0 0.3vw rgba(0,0,0,0.35)';
      const labelLineHeight = labelCfg.lineHeight ?? 1.1;
      const labelFontWeight = labelCfg.fontWeight ?? 600;
      const labelTextTransform = labelCfg.textTransform ?? 'none';

      for (let i = 0; i < segments; i++) {
        const seedId = seedOrder[i] || null;
        const seedDef = seedId ? this._seedCatalog.get(seedId) : null;
        const posPct = segments > 1 ? (i / (segments - 1)) * 100 : 0;
        const segmentMaskPosition = `center ${posPct}%`;

        const segment = document.createElement('div');
        segment.style.position = 'absolute';
        segment.style.left = '0';
        segment.style.width = '100%';
        segment.style.height = `${segmentHeight}%`;
        segment.style.top = `${i * segmentHeight}%`;
        segment.style.display = 'flex';
        segment.style.alignItems = 'center';
        segment.style.justifyContent = 'center';
        segment.style.pointerEvents = seedDef ? 'auto' : 'none';
        segment.style.cursor = seedDef ? 'pointer' : 'default';
        segment.style.transition = 'transform 0.15s ease, box-shadow 0.15s ease';
  segment.style.overflow = 'visible';
        segment.style.userSelect = 'none';
        segment.style.webkitUserSelect = 'none';
        segment.style.touchAction = 'manipulation';
        segment.setAttribute('role', 'button');
        seederContainer.appendChild(segment);

        let overlayEl = null;
        if (seedId) {
          overlayEl = document.createElement('div');
          overlayEl.style.position = 'absolute';
          overlayEl.style.left = '0';
          overlayEl.style.top = '0';
          overlayEl.style.width = '100%';
          overlayEl.style.height = '100%';
          overlayEl.style.pointerEvents = 'none';
          overlayEl.style.opacity = '0';
          overlayEl.style.transition = 'opacity 0.18s ease, filter 0.18s ease';
          overlayEl.style.backgroundImage = `url(${seederMaskUrl})`;
          overlayEl.style.backgroundSize = segmentMaskSize;
          overlayEl.style.backgroundPosition = segmentMaskPosition;
          overlayEl.style.backgroundRepeat = 'no-repeat';
          overlayEl.style.filter = 'none';
          this._applySegmentMask(overlayEl, seederMaskUrl, segments, posPct);
          overlayEl.style.zIndex = '0';
          segment.appendChild(overlayEl);
        }

        let highlightEl = null;
        if (seedId) {
          highlightEl = document.createElement('div');
          highlightEl.style.position = 'absolute';
          highlightEl.style.left = '0';
          highlightEl.style.top = '0';
          highlightEl.style.width = '100%';
          highlightEl.style.height = '100%';
          highlightEl.style.pointerEvents = 'none';
          highlightEl.style.opacity = '0';
          highlightEl.style.transition = 'opacity 0.2s ease';
          highlightEl.style.backgroundColor = 'rgba(255, 214, 102, 0.9)';
          this._applySegmentMask(highlightEl, seederMaskUrl, segments, posPct);
          highlightEl.style.filter = 'brightness(1.35) saturate(1.2)';
          highlightEl.style.mixBlendMode = 'screen';
          highlightEl.style.transformOrigin = 'center';
          highlightEl.style.zIndex = '1';
          segment.appendChild(highlightEl);
        }

        let imageEl = null;
        if (seedId) {
          const seedImageFile = elements.seedImages?.[seedId];
          if (seedImageFile) {
            imageEl = document.createElement('img');
            imageEl.src = resolveAsset(seedImageFile);
            const scalePct = (seedImageScale * 100).toFixed(3) + '%';
            imageEl.style.maxWidth = scalePct;
            imageEl.style.maxHeight = scalePct;
            imageEl.style.objectFit = 'contain';
            imageEl.style.pointerEvents = 'none';
            imageEl.style.transition = 'transform 0.18s ease, filter 0.18s ease, opacity 0.18s ease';
            imageEl.style.zIndex = '2';
            imageEl.style.userSelect = 'none';
            imageEl.draggable = false;
            segment.appendChild(imageEl);
          }
        }

        let labelEl = null;
        if (seedDef && seedId) {
          labelEl = document.createElement('div');
          labelEl.textContent = seedDef.label || seedId;
          labelEl.style.position = 'absolute';
          labelEl.style.boxSizing = 'border-box';
          labelEl.style.right = `calc(100% + ${labelGapVW}vw)`;
          labelEl.style.top = '50%';
          labelEl.style.display = 'inline-flex';
          labelEl.style.alignItems = 'center';
          labelEl.style.justifyContent = 'center';
          labelEl.style.whiteSpace = 'nowrap';
          labelEl.style.opacity = '0';
          labelEl.style.pointerEvents = 'none';
          labelEl.style.transformOrigin = '100% 50%';
          labelEl.style.transform = hiddenTransform;
          labelEl.style.transition = `transform ${labelTransitionSeconds}s ${slideEasing}, opacity ${labelTransitionSeconds}s ${opacityEasing}`;
          labelEl.style.maxWidth = `${labelCfg.maxWidthVW ?? 18}vw`;
          labelEl.style.padding = `${labelCfg.paddingVH ?? 0.35}vh ${labelCfg.paddingVW ?? 0.6}vw`;
          labelEl.style.borderRadius = `${labelCfg.borderRadiusVW ?? 0.6}vw`;
          labelEl.style.background = labelCfg.backgroundColor || '#b86f2d';
          labelEl.style.color = labelCfg.textColor || '#ffffff';
          labelEl.style.fontSize = `${labelCfg.fontSizeVW ?? 1.1}vw`;
          labelEl.style.textTransform = labelTextTransform;
          labelEl.style.fontWeight = String(labelFontWeight);
          labelEl.style.lineHeight = typeof labelLineHeight === 'number' ? String(labelLineHeight) : labelLineHeight;
          labelEl.style.boxShadow = labelShadow;
          labelEl.style.zIndex = '3';
          labelEl.style.willChange = 'transform, opacity';
          if (labelCfg.fontFamily || this._uiFontFamily) {
            labelEl.style.fontFamily = labelCfg.fontFamily || this._uiFontFamily;
          }
          labelEl.dataset.hiddenTransform = hiddenTransform;
          labelEl.dataset.visibleTransform = visibleTransform;
          segment.appendChild(labelEl);
        }

        if (seedDef && seedId) {
          segment.dataset.seedId = seedId;
          segment.setAttribute('aria-label', seedDef.label || seedId);
          segment.addEventListener('click', (event) => {
            event.preventDefault();
            this._resumeAmbientAudio();
            const available = this._isToolAvailable(seedId);
            if (!available) return;
            this._toggleTool(seedId);
          });
          this._seedButtons[seedId] = { segment, image: imageEl, overlay: overlayEl, highlight: highlightEl, label: labelEl, seed: seedDef };
        }
      }

      this._buttons.seeder = seederContainer;
    }

    if (elements.logo?.image) {
      if (this._uiLogoEl && this._onUiLogoPointerUp) {
        this._uiLogoEl.removeEventListener('pointerup', this._onUiLogoPointerUp);
      }
      const logo = document.createElement('img');
      logo.src = resolveAsset(elements.logo.image);
      logo.style.position = 'absolute';
      this._applyViewportRect(logo, elements.logo);
      logo.style.pointerEvents = 'auto';
      logo.style.cursor = 'pointer';
      logo.style.objectFit = 'contain';
      if (Number.isFinite(elements.logo.zIndex)) {
        logo.style.zIndex = String(elements.logo.zIndex);
      }
      logo.draggable = false;
      logo.addEventListener('pointerup', this._onUiLogoPointerUp);
      this._uiLogoEl = logo;
      root.appendChild(logo);
    } else {
      this._uiLogoEl = null;
    }

    const goalMessage = document.createElement('div');
    const goalUi = ui.goalMessage || {};
    const goalTransitionSeconds = Math.max(0.05, goalUi.transitionSeconds ?? 0.35);
    const goalHiddenOffset = goalUi.slideOffsetVW ?? 2;
    const goalTransition = `transform ${goalTransitionSeconds}s ease, opacity ${goalTransitionSeconds}s ease`;
    const goalHiddenTransform = `translate(-50%, ${goalHiddenOffset}vw)`;
    const goalVisibleTransform = 'translate(-50%, 0)';
    goalMessage.style.position = 'absolute';
    goalMessage.style.left = '50%';
    goalMessage.style.bottom = '0';
    goalMessage.style.padding = '0';
    goalMessage.style.maxWidth = 'none';
    goalMessage.style.fontSize = '1px';
    goalMessage.style.fontWeight = '600';
    goalMessage.style.color = colors.uiText;
    goalMessage.style.background = colors.uiBackgroundActive;
    goalMessage.style.borderRadius = '0';
    goalMessage.style.boxShadow = `0 0 ${(ui.gap * 140).toFixed(3)}vh rgba(0,0,0,${ui.shadowOpacity * 0.8})`;
    goalMessage.style.pointerEvents = 'none';
    goalMessage.style.textAlign = 'center';
    goalMessage.style.display = 'none';
    goalMessage.style.backdropFilter = 'blur(0.8vmin)';
    goalMessage.style.opacity = '0';
    goalMessage.style.transform = goalHiddenTransform;
    goalMessage.style.transition = goalTransition;
    goalMessage.style.willChange = 'transform, opacity';
    if (this._uiFontFamily) {
      goalMessage.style.fontFamily = this._uiFontFamily;
    }
    root.appendChild(goalMessage);
    this._goalMessageEl = goalMessage;
  this._goalMessageTransition = goalTransition;
  this._goalMessageTransitionDurationMs = goalTransitionSeconds * 1000;
  this._goalMessageHiddenTransform = goalHiddenTransform;
  this._goalMessageVisibleTransform = goalVisibleTransform;
  this._goalMessageDesignMetrics = {
    bottomOffset: goalUi.bottomOffsetVW ?? 9,
    padding: goalUi.paddingVW ?? 1.2,
    maxWidth: goalUi.maxWidthVW ?? 52,
    fontSize: goalUi.fontSizeVW ?? 1.8,
    borderRadius: goalUi.borderRadiusVW ?? 2.4
  };

    const cursorCfg = ui.cursor || {};
    const cursorEl = document.createElement('div');
    cursorEl.style.position = 'absolute';
    cursorEl.style.left = '0';
    cursorEl.style.top = '0';
    cursorEl.style.width = `${(cursorCfg.diameterVW ?? 1.8)}vw`;
    cursorEl.style.height = `${(cursorCfg.diameterVW ?? 1.8)}vw`;
    cursorEl.style.borderRadius = '50%';
    cursorEl.style.pointerEvents = 'none';
    cursorEl.style.transform = 'translate(-50%, -50%)';
    cursorEl.style.display = 'none';
    cursorEl.style.background = colors.cursorDisabled;
    cursorEl.style.border = `${(cursorCfg.borderWidthVW ?? 0.14)}vw solid rgba(0,0,0,0.35)`;
    const cursorTransition = cursorCfg.transitionSeconds ?? 0.12;
    cursorEl.style.transition = `background ${cursorTransition}s ease, box-shadow ${cursorTransition}s ease, opacity ${cursorTransition}s ease`;
    cursorEl.style.opacity = '0';
    root.appendChild(cursorEl);
    this._cursorEl = cursorEl;

    this._ensureTutorialOverlay(root);

    this._createDepthMeter(root);

    this._createProgressBar(root);

    this.app.root.appendChild(root);
    this._uiRoot = root;

    if (this.app?.canvas) {
      this._originalCanvasCursor = this.app.canvas.style.cursor;
      this.app.canvas.style.cursor = 'none';
    }

    this._syncWaterButtons();
    this._syncToolButtons();
  this._restartStageHints();

    this._initTutorialSystem();
    this._startInitialTutorial();

    const initialState = this._indexToWeatherState(this._waterLevelIndex);
    this._setWeatherVisualInstant(initialState);
    this._updateSeedLabels();
    this._updateGoalMessageLayout();
  }

  _updateUILayout(width, height) {
    void width;
    void height;
    if (!this._uiRectEntries?.length) {
      this._updateGoalMessageLayout();
      return;
    }

    const metrics = this._computeUILayoutMetrics();
    if (!metrics) {
      return;
    }

    for (const entry of this._uiRectEntries) {
      if (!entry?.element || !entry.rect) continue;
      this._applyViewportRect(entry.element, entry.rect, false, metrics);
    }
    this._updateGoalMessageLayout(metrics);
    this._updateTutorialLayout();

    this._layoutDepthMeter(metrics);
  }

  _computeUILayoutMetrics() {
    const root = this.app?.root;
    const viewportW = Math.max(1, root?.clientWidth || window.innerWidth || this.app?.BASE_WIDTH || 1920);
    const viewportH = Math.max(1, root?.clientHeight || window.innerHeight || this.app?.BASE_HEIGHT || 1080);
    const baseW = this.app?.BASE_WIDTH || 1920;
    const baseH = this.app?.BASE_HEIGHT || 1080;
    const scale = viewportH / baseH;

    const scaledW = baseW * scale;
    const scaledH = baseH * scale;
    const offsetX = viewportW - scaledW;
    const offsetY = 0;

    return { viewportW, viewportH, baseW, baseH, scale, offsetX, offsetY };
  }

  _updateGoalMessageLayout(metrics = null) {
    const goalEl = this._goalMessageEl;
    const design = this._goalMessageDesignMetrics;
    if (!goalEl || !design) return;

    const data = metrics || this._computeUILayoutMetrics();
    if (!data) return;
    const { viewportH, baseH, scale } = data;

    const toPx = (vwValue) => (vwValue / 100) * baseH * scale; // reuse height-derived scale

    goalEl.style.bottom = `${toPx(design.bottomOffset)}px`;
    goalEl.style.padding = `${toPx(design.padding)}px`;
    goalEl.style.maxWidth = `${toPx(design.maxWidth)}px`;
    goalEl.style.fontSize = `${toPx(design.fontSize)}px`;
    goalEl.style.borderRadius = `${toPx(design.borderRadius)}px`;
  }

  _createDepthMeter(root) {
    if (!root || this._depthMeter) return;
    const { colors, ui } = this.params;

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.bottom = '0';
    container.style.left = '0';
    container.style.opacity = '0.38';
    container.style.pointerEvents = 'none';
    container.style.userSelect = 'none';
    container.style.webkitUserSelect = 'none';
    container.style.zIndex = '12';

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    const labels = document.createElement('div');
    labels.style.position = 'absolute';
    labels.style.inset = '0';
    labels.style.pointerEvents = 'none';
    container.appendChild(labels);

    const pointerSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pointerSvg.setAttribute('viewBox', '0 0 10 10');
    pointerSvg.style.position = 'absolute';
    pointerSvg.style.pointerEvents = 'none';
    pointerSvg.style.display = 'block';
    pointerSvg.style.overflow = 'visible';
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    // Tip at the right: points to the right.
    poly.setAttribute('points', '10,5 0,0 0,10');
    poly.setAttribute('fill', colors.uiAccent || '#ffd166');
    pointerSvg.appendChild(poly);
    container.appendChild(pointerSvg);

    root.appendChild(container);

    this._depthMeter = {
      container,
      canvas,
      ctx: canvas.getContext('2d'),
      labels,
      pointerSvg,
      design: {
        leftOffsetVW: 1.2,
        widthVW: 14,
        fontSizeVW: 1.15,
        pointerSizeVW: 1.6,
        labelPaddingVW: 0.35,
        labelPaddingVH: 0.15,
        labelOffsetVW: 0.9,
        spineOffsetRatio: 0.42,
        majorTickRatio: 0.36,
        minorTickRatio: 0.22
      },
      colors: {
        text: colors.uiText,
        lines: colors.uiText,
        accent: colors.uiAccent
      },
      ui
    };

    this._layoutDepthMeter(this._computeUILayoutMetrics());
  }

  _layoutDepthMeter(metrics) {
    const meter = this._depthMeter;
    if (!meter?.container || !meter.canvas || !meter.ctx) return;
    const root = this._uiRoot || this.app?.root;
    if (!root) return;

    const data = metrics || this._computeUILayoutMetrics();
    if (!data) return;

    const { viewportH, baseH, scale } = data;
    const toPx = (vwValue) => (vwValue / 100) * baseH * scale;

    const left = toPx(meter.design.leftOffsetVW);
    const width = Math.max(40, toPx(meter.design.widthVW));
    meter.container.style.left = `${Math.round(left)}px`;
    meter.container.style.width = `${Math.round(width)}px`;

    // Meter range (in "mts" relative to nivel medio).
    // IMPORTANT: scale does not depend on these limits.
    const meterMin = -10;
    const meterMax = 35;

    // Fixed scale: a constant pixels-per-meter based on viewport height.
    // This ensures changing meterMin/meterMax doesn't change spacing.
    const pxPer10m = Math.max(70, Math.round(viewportH * 0.14));
    const pxPerM = pxPer10m / 10;

    const trackHeight = Math.max(80, Math.round((meterMax - meterMin) * pxPerM));

    // Align "0 mts" with the average water level height in screen space.
    const medium = this._waterLevels?.medium ?? 0;
    const camTop = this.camera?.top ?? 5;
    const camBottom = this.camera?.bottom ?? -5;
    const yMediumScreen = ((medium - camTop) / (camBottom - camTop)) * viewportH;

    // The "0 mts" mark is at (meterMax - 0) * pxPerM from the top of the container.
    const trackTop = Math.round(yMediumScreen - (meterMax * pxPerM));

    meter.container.style.top = `${trackTop}px`;
    meter.container.style.height = `${trackHeight}px`;
    meter.container.style.bottom = 'auto';

    const pointerSize = Math.max(10, toPx(meter.design.pointerSizeVW));
    meter.pointerSvg.style.width = `${Math.round(pointerSize)}px`;
    meter.pointerSvg.style.height = `${Math.round(pointerSize)}px`;

    // Resize canvas to match CSS pixels.
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = Math.max(1, meter.container.clientWidth);
    const cssH = Math.max(1, meter.container.clientHeight);
    const nextW = Math.floor(cssW * dpr);
    const nextH = Math.floor(cssH * dpr);
    if (meter.canvas.width !== nextW || meter.canvas.height !== nextH) {
      meter.canvas.width = nextW;
      meter.canvas.height = nextH;
    }

    meter._layout = {
      viewportH: cssH,
      viewportW: cssW,
      spineX: cssW * meter.design.spineOffsetRatio,
      majorLen: cssW * meter.design.majorTickRatio,
      minorLen: cssW * meter.design.minorTickRatio,
      labelX: cssW * (meter.design.spineOffsetRatio + 0.08),
      fontSizePx: Math.max(11, toPx(meter.design.fontSizeVW)),
      labelPadX: Math.max(2, toPx(meter.design.labelPaddingVW)),
      labelPadY: Math.max(1, toPx(meter.design.labelPaddingVH)),
      labelOffsetX: Math.max(4, toPx(meter.design.labelOffsetVW)),
      pointerSizePx: pointerSize,
      dpr,
      meterMin,
      meterMax,
      pxPerM
    };

    this._redrawDepthMeter();
    this._updateDepthMeterPointer();
  }

  _redrawDepthMeter() {
    const meter = this._depthMeter;
    const layout = meter?._layout;
    if (!meter?.ctx || !layout) return;

    const ctx = meter.ctx;
    const dpr = layout.dpr;
    const w = meter.canvas.width;
    const h = meter.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const spineX = layout.spineX;
    const majorLen = layout.majorLen;
    const minorLen = layout.minorLen;
    const lineWidth = Math.max(1, Math.round(1.25 * dpr)) / dpr;
    const faintLineWidth = Math.max(1, Math.round(0.9 * dpr)) / dpr;

    // Vertical spine (bounded track)
    ctx.strokeStyle = meter.colors.lines || 'rgba(248,250,252,0.9)';
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = faintLineWidth;
    ctx.beginPath();
    ctx.moveTo(spineX, 0);
    ctx.lineTo(spineX, layout.viewportH);
    ctx.stroke();

    const medium = this._waterLevels?.medium ?? 0;
    const delta = this.params?.water?.levelDelta ?? 0.25;
    if (!Number.isFinite(delta) || delta === 0) return;

    // Fixed range in meters, relative to "nivel medio".
    // Render marks from -10 to +29, but only label multiples of 10.
    const meterMin = layout.meterMin ?? -10;
    const meterMax = layout.meterMax ?? 35;

    // Clear and rebuild labels each layout pass.
    while (meter.labels.firstChild) meter.labels.removeChild(meter.labels.firstChild);

    const makeLabel = (text, yPx) => {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.position = 'absolute';
      // Place labels to the right of the tick lines to avoid overlap.
      el.style.left = `${Math.round(spineX + majorLen + layout.labelOffsetX)}px`;
      el.style.top = `${Math.round(yPx)}px`;
      el.style.transform = 'translateY(-50%)';
      el.style.whiteSpace = 'nowrap';
      el.style.color = meter.colors.text;
      el.style.fontSize = `${Math.round(layout.fontSizePx)}px`;
      el.style.lineHeight = '1.1';
      el.style.fontWeight = '600';
      el.style.padding = `${Math.round(layout.labelPadY)}px ${Math.round(layout.labelPadX)}px`;
      el.style.borderRadius = `${Math.round(layout.labelPadX)}px`;
      el.style.background = 'transparent';
      if (this._uiFontFamily) {
        el.style.fontFamily = this._uiFontFamily;
      }
      meter.labels.appendChild(el);
    };

    const pxPerM = layout.pxPerM ?? (layout.viewportH / Math.max(1e-6, (meterMax - meterMin)));
    const metersToScreenY = (metersRelToMedium) => (meterMax - metersRelToMedium) * pxPerM;

    // Ticks
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = meter.colors.lines || 'rgba(248,250,252,0.9)';
    ctx.lineWidth = lineWidth;

    for (let m = meterMin; m <= meterMax; m++) {
      const yMajor = metersToScreenY(m);
      if (yMajor < -40 || yMajor > layout.viewportH + 40) continue;

      // Major tick
      ctx.beginPath();
      ctx.moveTo(spineX, yMajor);
      ctx.lineTo(spineX + majorLen, yMajor);
      ctx.stroke();

      // Label
      if (m === 0) {
        makeLabel('0 mts: nivel medio', yMajor);
      } else if (m % 10 === 0) {
        const sign = m > 0 ? '+' : '';
        makeLabel(`${sign}${m} mts`, yMajor);
      }

      // Minor ticks between this and next major
      if (m < meterMax) {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = faintLineWidth;
        const subdivisions = 10;
        const denom = subdivisions + 1; // 10 internal ticks
        for (let i = 1; i <= subdivisions; i++) {
          const frac = i / denom;
          const yMinor = metersToScreenY(m + frac);
          if (yMinor < -20 || yMinor > layout.viewportH + 20) continue;
          ctx.beginPath();
          ctx.moveTo(spineX, yMinor);
          ctx.lineTo(spineX + minorLen, yMinor);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = lineWidth;
      }
    }
  }

  _updateDepthMeterPointer() {
    const meter = this._depthMeter;
    const layout = meter?._layout;
    if (!meter?.pointerSvg || !layout) return;

    const low = this._waterLevels?.low ?? 0;
    const medium = this._waterLevels?.medium ?? 0;
    const high = this._waterLevels?.high ?? 0;
    const aboveDen = high - medium;
    const belowDen = medium - low;
    const meterMin = layout.meterMin ?? -10;
    const meterMax = layout.meterMax ?? 35;
    const pxPerM = layout.pxPerM ?? (layout.viewportH / Math.max(1e-6, (meterMax - meterMin)));

    // Map water level to "meter units":
    // -10..0 spans low→medium, 0..10 spans medium→high.
    let meters = 0;
    if (this._currentWaterLevel >= medium) {
      meters = aboveDen !== 0 ? (10 * (this._currentWaterLevel - medium)) / aboveDen : 0;
    } else {
      meters = belowDen !== 0 ? (10 * (this._currentWaterLevel - medium)) / belowDen : 0;
    }

    const clampedMeters = clamp(meters, meterMin, meterMax);
    const yPx = (meterMax - clampedMeters) * pxPerM;

    // Triangle sits just to the left of the spine, pointing right into it.
    const left = layout.spineX - layout.pointerSizePx;
    meter.pointerSvg.style.left = `${Math.round(left)}px`;
    meter.pointerSvg.style.top = `${Math.round(yPx - layout.pointerSizePx / 2)}px`;
  }

  _ensureTutorialOverlay(root) {
    if (this._tutorialOverlay || !root) return;
    const { colors, ui } = this.params;

    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '30';
    overlay.style.pointerEvents = 'auto';
    overlay.style.padding = '4vw';

    const dimmer = document.createElement('div');
    dimmer.style.position = 'absolute';
    dimmer.style.inset = '0';
    dimmer.style.background = 'rgba(0, 0, 0, 0.68)';
    dimmer.style.backdropFilter = 'blur(0.6vmin)';
    dimmer.style.pointerEvents = 'auto';
    overlay.appendChild(dimmer);

    const spotlight = document.createElement('div');
    spotlight.style.position = 'absolute';
    spotlight.style.left = '0';
    spotlight.style.top = '0';
    spotlight.style.width = '0';
    spotlight.style.height = '0';
    spotlight.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.68)';
    spotlight.style.borderRadius = '1.4vw';
    spotlight.style.transition = 'all 0.2s ease';
    spotlight.style.pointerEvents = 'none';
    spotlight.style.background = 'rgba(255,255,255,0.08)';
    spotlight.style.mixBlendMode = 'screen';
    overlay.appendChild(spotlight);

    const card = document.createElement('div');
    card.style.position = 'relative';
    card.style.maxWidth = 'min(92vw, 720px)';
    card.style.width = 'min(92vw, 720px)';
    card.style.padding = '2.2vh 2.4vw';
    card.style.background = colors.uiBackgroundActive || 'rgba(10,34,61,0.85)';
    card.style.borderRadius = `${(ui.borderRadius * 110).toFixed(3)}vmin`;
    card.style.boxShadow = `0 0 ${(ui.gap * 180).toFixed(3)}vh rgba(0,0,0,${ui.shadowOpacity ?? 0.4})`;
    card.style.color = colors.uiText || '#f8fafc';
    card.style.backdropFilter = 'blur(0.8vmin)';
    card.style.pointerEvents = 'auto';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '1.4vh';
    card.style.alignItems = 'center';
    card.style.textAlign = 'center';
    overlay.appendChild(card);

    const text = document.createElement('div');
    text.style.fontSize = `${(ui.fontScale * 120).toFixed(3)}vmin`;
    text.style.lineHeight = '1.35';
    text.style.fontWeight = '600';
    if (this._uiFontFamily) {
      text.style.fontFamily = this._uiFontFamily;
    }
    card.appendChild(text);

    const button = document.createElement('button');
    button.textContent = 'Click para continuar';
    button.style.fontSize = `${(ui.fontScale * 105).toFixed(3)}vmin`;
    button.style.fontWeight = '700';
    button.style.padding = '1.1vh 2.2vw';
    button.style.border = 'none';
    button.style.borderRadius = `${(ui.borderRadius * 90).toFixed(3)}vmin`;
    button.style.background = colors.uiAccent || '#ffd166';
    button.style.color = '#1a1f2c';
    button.style.cursor = 'pointer';
    button.style.marginTop = `${(ui.gap * 120).toFixed(3)}vh`;
    button.style.boxShadow = `0 0 ${(ui.gap * 140).toFixed(3)}vh rgba(0,0,0,${ui.shadowOpacity ?? 0.4})`;
    button.style.transition = 'transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease';
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-2px) scale(1.01)';
      button.style.boxShadow = `0 0 ${(ui.gap * 180).toFixed(3)}vh rgba(0,0,0,${ui.shadowOpacity ?? 0.55})`;
      button.style.filter = 'brightness(1.03)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translateY(0) scale(1)';
      button.style.boxShadow = `0 0 ${(ui.gap * 140).toFixed(3)}vh rgba(0,0,0,${ui.shadowOpacity ?? 0.4})`;
      button.style.filter = 'none';
    });
    button.addEventListener('click', () => this._handleTutorialAdvance());
    card.appendChild(button);

    const skipButton = document.createElement('button');
    skipButton.textContent = 'Saltar tutorial';
    skipButton.style.fontSize = `${(ui.fontScale * 85).toFixed(3)}vmin`;
    skipButton.style.fontWeight = '600';
    skipButton.style.padding = '0.8vh 1.6vw';
    skipButton.style.border = 'none';
    skipButton.style.background = 'transparent';
    skipButton.style.color = 'rgba(255, 255, 255, 0.6)';
    skipButton.style.cursor = 'pointer';
    skipButton.style.marginTop = '1vh';
    skipButton.style.textDecoration = 'underline';
    skipButton.style.transition = 'color 0.15s ease';
    skipButton.addEventListener('mouseenter', () => {
      skipButton.style.color = 'rgba(255, 255, 255, 0.9)';
    });
    skipButton.addEventListener('mouseleave', () => {
      skipButton.style.color = 'rgba(255, 255, 255, 0.6)';
    });
    skipButton.addEventListener('click', () => this._skipTutorial());
    card.appendChild(skipButton);

    root.appendChild(overlay);
    this._tutorialOverlay = overlay;
    this._tutorialDimmer = dimmer;
    this._tutorialSpotlight = spotlight;
    this._tutorialCard = card;
    this._tutorialText = text;
    this._tutorialButton = button;

    // Audio for tutorial
    this._tutorialAudio = new Audio();
    this._tutorialAudio.volume = 1.0;
  }

  _skipTutorial() {
    if (!this._tutorial) return;
    this._tutorial.queue = [];
    this._tutorial.current = null;
    this._tutorial.active = false;
    this._tutorial.paused = false;
    if (this._tutorialOverlay) {
      this._tutorialOverlay.style.display = 'none';
    }
    if (this._tutorialAudio) {
      this._tutorialAudio.pause();
      this._tutorialAudio.currentTime = 0;
    }
    this._setCursorVisible(true);
  }

  _initTutorialSystem() {
    if (!this._tutorial) {
      this._tutorial = { active: false, paused: false, queue: [], current: null };
    }
    this._tutorial.queue = [];
    this._tutorial.current = null;
    this._tutorial.active = false;
    this._tutorial.paused = false;
    // Reset completion so each fresh mount shows tutorials again.
    this._tutorialCompleted = new Set();
    this._updateTutorialLayout();
  }

  _startInitialTutorial() {
    const steps = [
      { type: 'modal', text: '¡Bienvenido al Simulador Delta+! El objetivo de este juego es crear una isla como las que pueden encontrarse en el Delta del Paraná.' },
      { type: 'modal', text: 'Las islas del Delta del Paraná, aunque suene increíble, empiezan así: tan solo un banco de arena en el fondo del río.' },
      { type: 'modal', text: 'A medida que se deposita sedimento, ese banco va creciendo hasta emerger sobre el nivel del agua, permitiendo que algunas especies vegetales colonicen esa tierra y la fijen...' },
      { type: 'modal', text: 'Te proponemos que construyas una nueva isla, aportando sedimento, semillas de distintas especies vegetales y cambiando el nivel del agua para que nuevas plantas puedan crecer.' },
      { type: 'modal', text: '¿Te animás a probar?' },
      { type: 'highlight', target: 'sediment', text: 'Cuando la herramienta Sedimento está activa, podés presionar bajo el agua para hacer crecer el banco de arena.' },
      { type: 'highlight', target: 'weather', text: 'Podés subir o bajar el nivel del agua si lo necesitás.' }
    ];
    this._startTutorialSequence('intro', steps);
  }

  _startStageTutorial(stageId) {
    if (!stageId) return;
    if (stageId === 'colonization') {
      const steps = [
        { type: 'modal', text: 'Lograste llevar el banco de arena por sobre el nivel promedio del agua. ¡Buen trabajo! Eso permite que algunas especies vegetales empiecen a colonizar el suelo.' },
        { type: 'modal', text: 'Las semillas solo pueden instalarse y crecer cuando la isla está sobre el agua, pero necesitan agua para sobrevivir.' },
        { type: 'modal', text: '¡Cuidado! Si las plantas pasan demasiado tiempo bajo el agua, morirán y tendrás que empezar su crecimiento desde cero.' },
        { type: 'modal', text: 'Hacé crecer completamente a todas las especies disponibles para avanzar.' },
        { type: 'highlight', target: 'seeder', text: 'Elegí las semillas que quieras hacer crecer y tocá el suelo para que crezcan en ese lugar.' },
        { type: 'highlight', target: 'remove', text: 'Si querés eliminar semillas o plantas ya crecidas, podés hacerlo utilizando la herramienta Pala.' }
      ];
      this._startTutorialSequence('colonization', steps);
    }

    if (stageId === 'expansion') {
      const steps = [
        { type: 'modal', text: 'Ahora podés instalar las semillas no colonizadoras. Completá el ecosistema de la isla.' }
      ];
      this._startTutorialSequence('expansion', steps);
    }
  }

  _onStageChanged(stageId) {
    this._startStageTutorial(stageId);
  }

  _startTutorialSequence(id, steps) {
    if (!steps || !steps.length) return;
    if (!this._tutorialCompleted) {
      this._tutorialCompleted = new Set();
    }
    if (this._tutorialCompleted.has(id)) return;
    this._tutorialCompleted.add(id);

    this._tutorial.active = true;
    for (let i = 0; i < steps.length; i++) {
      const step = { ...steps[i], _sequenceId: id, _stepIndex: i };
      this._tutorial.queue.push(step);
    }
    if (!this._tutorial.current) {
      this._showNextTutorialStep();
    }
  }

  _handleTutorialAdvance() {
    this._showNextTutorialStep();
  }

  _showNextTutorialStep() {
    // Stop previous audio
    if (this._tutorialAudio) {
      this._tutorialAudio.pause();
      this._tutorialAudio.currentTime = 0;
    }

    const next = this._tutorial.queue.shift();
    if (!next) {
      this._tutorial.current = null;
      this._tutorial.paused = false;
      this._tutorial.active = false;
      if (this._tutorialOverlay) {
        this._tutorialOverlay.style.display = 'none';
        this._tutorialOverlay.style.pointerEvents = 'none';
      }
      this._flushStageIntroIfReady();
      return;
    }

    this._tutorial.current = next;
    this._tutorial.paused = true;
    this._pointerDown = false;
    if (!this._tutorialOverlay || !this._tutorialText || !this._tutorialButton) return;

    this._tutorialOverlay.style.display = 'flex';
    this._tutorialOverlay.style.pointerEvents = 'auto';
    this._tutorialText.textContent = next.text || '';

    // Play audio
    if (this._tutorialAudio && next._sequenceId && next._stepIndex !== undefined) {
      const audioPath = `/game-assets/simulador/voiceovers/tutorial_${next._sequenceId}_${next._stepIndex}.mp3`;
      this._tutorialAudio.src = audioPath;
      this._tutorialAudio.play().catch(e => console.warn("Tutorial audio play failed", e));
    }

    if (next.type === 'highlight' && next.target) {
      if (this._tutorialSpotlight) {
        this._tutorialSpotlight.style.display = 'block';
      }
    } else if (this._tutorialSpotlight) {
      this._tutorialSpotlight.style.display = 'none';
    }

    this._updateTutorialLayout();
  }

  _resolveTutorialTargets(step) {
    if (!step) return [];
    if (!this._buttons) return [];
    switch (step.target) {
      case 'sediment':
        return [this._buttons.sediment].filter(Boolean);
      case 'weather': {
        const weather = this._buttons.weather || {};
        return [weather.topContainer, weather.bottomContainer].filter(Boolean);
      }
      case 'seeder':
        return [this._buttons.seeder].filter(Boolean);
      case 'remove':
        return [this._buttons.remove].filter(Boolean);
      default:
        return [];
    }
  }

  _updateTutorialLayout() {
    if (!this._tutorial?.current || !this._tutorialOverlay) return;
    const overlayRect = this.app?.root?.getBoundingClientRect();
    if (!overlayRect) return;

    const step = this._tutorial.current;
    const targets = this._resolveTutorialTargets(step);
    const spotlight = this._tutorialSpotlight;
    if (!spotlight) return;

    const padding = 12; // px
    const rect = this._computeUnionRect(targets, overlayRect);
    if (!rect) {
      spotlight.style.display = 'none';
    } else {
      spotlight.style.display = 'block';
      spotlight.style.left = `${rect.left - padding - overlayRect.left}px`;
      spotlight.style.top = `${rect.top - padding - overlayRect.top}px`;
      spotlight.style.width = `${rect.width + padding * 2}px`;
      spotlight.style.height = `${rect.height + padding * 2}px`;
    }
  }

  _computeUnionRect(elements, fallbackRect = null) {
    if (!elements || !elements.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = false;
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!el || !el.getBoundingClientRect) continue;
      const r = el.getBoundingClientRect();
      if (!r || !Number.isFinite(r.left) || !Number.isFinite(r.width)) continue;
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right);
      maxY = Math.max(maxY, r.bottom);
      found = true;
    }
    if (!found) return fallbackRect ? { left: fallbackRect.left, top: fallbackRect.top, width: fallbackRect.width, height: fallbackRect.height, right: fallbackRect.right, bottom: fallbackRect.bottom } : null;
    return { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX, height: maxY - minY };
  }

  _applyFontSettings() {
    const fontsCfg = this.params.ui?.fonts;
    if (!fontsCfg) {
      this._uiFontFamily = null;
      return;
    }

    if (fontsCfg.fontKitHref && typeof document !== 'undefined') {
      if (loadedFontHref !== fontsCfg.fontKitHref) {
        const existing = document.querySelector(`link[${FONT_LINK_DATA_ATTR}="true"]`);
        if (existing) {
          existing.parentElement?.removeChild(existing);
        }
        const linkEl = document.createElement('link');
        linkEl.rel = 'stylesheet';
        linkEl.href = fontsCfg.fontKitHref;
        linkEl.setAttribute(FONT_LINK_DATA_ATTR, 'true');
        document.head?.appendChild(linkEl);
        loadedFontHref = fontsCfg.fontKitHref;
      }
    }

    if (fontsCfg.family) {
      this._uiFontFamily = fontsCfg.family;
      if (this.app?.root) {
        this.app.root.style.fontFamily = fontsCfg.family;
      }
      if (typeof document !== 'undefined' && document.body) {
        document.body.style.fontFamily = fontsCfg.family;
      }
    } else {
      this._uiFontFamily = null;
    }
  }

  _updateParticleSize(width, height) {
    if (!this._particlesPoints || !this._particlesPoints.material?.uniforms?.size) return;
    const minSide = Math.max(1, Math.min(width, height));
    this._particlesPoints.material.uniforms.size.value = Math.max(2, minSide * this.params.sediment.particleSize);
  }

  _syncWaterButtons() {
    const weatherButtons = this._buttons.weather;
    if (!weatherButtons) return;
    const atLow = this._waterLevelIndex <= 0;
    const atHigh = this._waterLevelIndex >= 2;

    if (weatherButtons.lower) {
      weatherButtons.lower.style.pointerEvents = atLow ? 'none' : 'auto';
      weatherButtons.lower.style.opacity = atLow ? '0.45' : '1';
      weatherButtons.lower.style.cursor = atLow ? 'default' : 'pointer';
    }

    if (weatherButtons.raise) {
      weatherButtons.raise.style.pointerEvents = atHigh ? 'none' : 'auto';
      weatherButtons.raise.style.opacity = atHigh ? '0.45' : '1';
      weatherButtons.raise.style.cursor = atHigh ? 'default' : 'pointer';
    }
  }

  _applyViewportRect(element, rect, track = true, cachedMetrics = null) {
    if (!element || !rect) return;

    if (track && this._uiRectEntries) {
      this._uiRectEntries.push({ element, rect });
    }

    const metrics = cachedMetrics || this._computeUILayoutMetrics();
    if (!metrics) return;
    const { baseW, baseH, scale, offsetX, offsetY } = metrics;

    const toDesignW = (pct) => (pct / 100) * baseW;
    const toDesignH = (pct) => (pct / 100) * baseH;

    const designLeft = typeof rect.leftPct === 'number' ? toDesignW(rect.leftPct) : null;
    const designTop = typeof rect.topPct === 'number' ? toDesignH(rect.topPct) : null;

    if (designLeft !== null) {
      element.style.left = `${offsetX + designLeft * scale}px`;
    }
    if (designTop !== null) {
      element.style.top = `${offsetY + designTop * scale}px`;
    }

    const hasWidthPct = typeof rect.widthPct === 'number';
    const hasHeightPct = typeof rect.heightPct === 'number';
    const lockAspect = rect.lockAspect !== false;

    const designWidth = hasWidthPct ? toDesignW(rect.widthPct) : null;
    const designHeight = hasHeightPct ? toDesignH(rect.heightPct) : null;

    let heightPx = null;
    if (hasHeightPct) {
      heightPx = (designHeight ?? 0) * scale;
      element.style.height = `${heightPx}px`;
    }

    if (lockAspect && heightPx !== null && designWidth && designHeight && designHeight > 0) {
      const ratio = designWidth / designHeight;
      const widthPx = heightPx * ratio;
      element.style.width = `${widthPx}px`;
    } else if (!lockAspect && hasWidthPct && designWidth !== null) {
      const widthPx = designWidth * scale;
      element.style.width = `${widthPx}px`;
    } else if (heightPx === null && hasWidthPct && designWidth !== null) {
      const widthPx = designWidth * scale;
      element.style.width = `${widthPx}px`;
    }
  }

  _applySegmentMask(element, maskUrl, segments, posPct) {
    if (!element || !maskUrl) return;
    const size = `100% ${Math.max(1, segments) * 100}%`;
    const position = `center ${posPct}%`;
    element.style.maskImage = `url(${maskUrl})`;
    element.style.webkitMaskImage = `url(${maskUrl})`;
    element.style.maskSize = size;
    element.style.webkitMaskSize = size;
    element.style.maskPosition = position;
    element.style.webkitMaskPosition = position;
    element.style.maskRepeat = 'no-repeat';
    element.style.webkitMaskRepeat = 'no-repeat';
  }

  _indexToWeatherState(index) {
    if (index >= 2) return 'high';
    if (index === 1) return 'medium';
    return 'low';
  }

  _setWeatherVisualInstant(state) {
    if (!this._weatherConfig) {
      this._weatherState = state;
      return;
    }

    this._clearWeatherAnimation(null, { resolveCancelled: false });

    const topPlan = this._getWeatherPlan('top', state, state);
    const bottomPlan = this._getWeatherPlan('bottom', state, state);

    if (topPlan) {
      if (Number.isFinite(topPlan.finalFrame)) {
        this._setWeatherFrame('top', topPlan.finalFrame);
      }
      if (topPlan.loop) {
        const loopFps = topPlan.loop.fps ?? Math.max(1, this._weatherConfig.fps ?? 25);
        this._startWeatherLoop('top', topPlan.loop.start, topPlan.loop.end, loopFps);
      }
    }

    if (bottomPlan && Number.isFinite(bottomPlan.finalFrame)) {
      this._setWeatherFrame('bottom', bottomPlan.finalFrame);
    }

    this._weatherState = state;
  }

  _queueWeatherStateChange(fromState, toState) {
    if (!this._weatherConfig || (!this._weatherChannels.top && !this._weatherChannels.bottom)) {
      this._weatherState = toState;
      return;
    }
    if (!this._weatherTransitionPromise) {
      this._weatherTransitionPromise = Promise.resolve();
    }
    this._weatherTransitionPromise = this._weatherTransitionPromise
      .then(() => this._transitionWeatherState(fromState, toState))
      .catch(() => {});
  }

  async _transitionWeatherState(fromState, toState) {
    if (!this._weatherConfig || (!this._weatherChannels.top && !this._weatherChannels.bottom)) {
      this._weatherState = toState;
      return;
    }

    const transitions = [];
    const topPlan = this._getWeatherPlan('top', fromState, toState);
    if (topPlan) {
      transitions.push(this._executeWeatherPlan('top', topPlan));
    }
    const bottomPlan = this._getWeatherPlan('bottom', fromState, toState);
    if (bottomPlan) {
      transitions.push(this._executeWeatherPlan('bottom', bottomPlan));
    }

    if (transitions.length) {
      await Promise.all(transitions);
    }

    this._weatherState = toState;
  }

  _getWeatherPlan(channelKey, fromState, toState) {
    if (!this._weatherConfig) return null;
    const channelCfg = this._weatherConfig[channelKey];
    if (!channelCfg) return null;

    const normalize = (state) => {
      if (state === 'medium') return 'medium';
      if (state === 'high') return 'high';
      return 'low';
    };

    const from = normalize(fromState);
    const to = normalize(toState);
    const fpsDefault = Math.max(1, this._weatherConfig.fps ?? 25);
    const plan = { sequences: [], finalFrame: undefined, loop: null, fps: fpsDefault };
    const addSequence = (start, end) => {
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      const s = Math.round(start);
      const e = Math.round(end);
      if (s === e) return;
      plan.sequences.push({ start: s, end: e, fps: fpsDefault });
    };

    if (channelKey === 'top') {
      const frames = channelCfg.frames || {};
      const low = frames.low;
      const medium = frames.medium;
      const highTransition = frames.highTransitionStart ?? frames.highLoopStart ?? medium ?? low;
      const loopStart = frames.highLoopStart ?? highTransition;
      const loopEnd = frames.highLoopEnd ?? loopStart;
      const hasLoop = Number.isFinite(loopStart) && Number.isFinite(loopEnd);

      if (!Number.isFinite(low) || !Number.isFinite(medium)) {
        return null;
      }

      if (from === to) {
        if (to === 'high' && hasLoop) {
          plan.finalFrame = Math.round(loopStart);
          plan.loop = { start: Math.round(loopStart), end: Math.round(loopEnd), fps: fpsDefault };
        } else if (to === 'medium') {
          plan.finalFrame = Math.round(medium);
        } else {
          plan.finalFrame = Math.round(low);
        }
        return plan;
      }

      let finalFrame;
      let loop = null;
      const path = `${from}->${to}`;
      switch (path) {
        case 'low->medium':
          addSequence(low, medium);
          finalFrame = medium;
          break;
        case 'medium->low':
          addSequence(medium, low);
          finalFrame = low;
          break;
        case 'medium->high':
          addSequence(medium, highTransition);
          if (hasLoop) {
            loop = { start: Math.round(loopStart), end: Math.round(loopEnd), fps: fpsDefault };
            finalFrame = loop.start;
          } else {
            finalFrame = highTransition;
          }
          break;
        case 'low->high':
          addSequence(low, medium);
          addSequence(medium, highTransition);
          if (hasLoop) {
            loop = { start: Math.round(loopStart), end: Math.round(loopEnd), fps: fpsDefault };
            finalFrame = loop.start;
          } else {
            finalFrame = highTransition;
          }
          break;
        case 'high->medium':
          addSequence(loopStart, medium);
          finalFrame = medium;
          break;
        case 'high->low':
          addSequence(loopStart, medium);
          addSequence(medium, low);
          finalFrame = low;
          break;
        default:
          finalFrame = to === 'medium' ? medium : low;
          break;
      }

      if (Number.isFinite(finalFrame)) {
        plan.finalFrame = Math.round(finalFrame);
      }
      if (loop) {
        plan.loop = loop;
      }

      if (!plan.sequences.length && !Number.isFinite(plan.finalFrame) && !plan.loop) {
        return null;
      }
      return plan;
    }

    if (channelKey === 'bottom') {
      const frames = channelCfg.frames || {};
      const low = frames.low;
      const medium = frames.medium;
      const high = frames.high;
      if (!Number.isFinite(low) || !Number.isFinite(medium) || !Number.isFinite(high)) {
        return null;
      }

      if (from === to) {
        const final = to === 'high' ? high : to === 'medium' ? medium : low;
        plan.finalFrame = Math.round(final);
        return plan;
      }

      let finalFrame;
      const path = `${from}->${to}`;
      switch (path) {
        case 'low->medium':
          addSequence(low, medium);
          finalFrame = medium;
          break;
        case 'medium->low':
          addSequence(medium, low);
          finalFrame = low;
          break;
        case 'medium->high':
          addSequence(medium, high);
          finalFrame = high;
          break;
        case 'low->high':
          addSequence(low, medium);
          addSequence(medium, high);
          finalFrame = high;
          break;
        case 'high->medium':
          addSequence(high, medium);
          finalFrame = medium;
          break;
        case 'high->low':
          addSequence(high, medium);
          addSequence(medium, low);
          finalFrame = low;
          break;
        default:
          finalFrame = to === 'high' ? high : to === 'medium' ? medium : low;
          break;
      }

      if (Number.isFinite(finalFrame)) {
        plan.finalFrame = Math.round(finalFrame);
      }

      if (!plan.sequences.length && !Number.isFinite(plan.finalFrame)) {
        return null;
      }
      return plan;
    }

    return null;
  }

  async _executeWeatherPlan(channelKey, plan) {
    if (!plan) return;
    this._clearWeatherAnimation(channelKey, { resolveCancelled: true });

    if (Array.isArray(plan.sequences) && plan.sequences.length) {
      for (let i = 0; i < plan.sequences.length; i++) {
        const seq = plan.sequences[i];
        await this._playWeatherRange(channelKey, seq.start, seq.end, seq.fps ?? plan.fps);
      }
    }

    if (Number.isFinite(plan.finalFrame)) {
      this._setWeatherFrame(channelKey, plan.finalFrame);
    }

    if (plan.loop) {
      this._startWeatherLoop(channelKey, plan.loop.start, plan.loop.end, plan.loop.fps ?? plan.fps);
    }
  }

  _playWeatherRange(channelKey, start, end, fps) {
    const channel = this._weatherChannels?.[channelKey];
    if (!channel?.image) {
      return Promise.resolve();
    }
    const s = Math.round(start ?? 0);
    const e = Math.round(end ?? s);
    if (s === e) {
      this._setWeatherFrame(channelKey, s);
      return Promise.resolve();
    }
    const step = s < e ? 1 : -1;
    const frameDuration = 1000 / (Math.max(1, fps ?? this._weatherConfig?.fps ?? 25) * WEATHER_PLAYBACK_SPEED);
    const frameJump = Math.max(1, Math.round(WEATHER_PLAYBACK_SPEED));

    return new Promise((resolve) => {
      const anim = { timerId: null, resolve, type: 'sequence' };
      let current = s;

      const tick = () => {
        this._setWeatherFrame(channelKey, current);
        if (current === e) {
          if (this._weatherAnimations[channelKey] === anim) {
            this._weatherAnimations[channelKey] = null;
          }
          if (typeof anim.resolve === 'function') {
            const done = anim.resolve;
            anim.resolve = null;
            done();
          }
          return;
        }
        if (step > 0) {
          current = Math.min(current + step * frameJump, e);
        } else {
          current = Math.max(current + step * frameJump, e);
        }
        anim.timerId = setTimeout(tick, frameDuration);
      };

      this._weatherAnimations[channelKey] = anim;
      tick();
    });
  }

  _startWeatherLoop(channelKey, start, end, fps) {
    const channel = this._weatherChannels?.[channelKey];
    if (!channel?.image) return;
    const frameDuration = 1000 / (Math.max(1, fps ?? this._weatherConfig?.fps ?? 25) * WEATHER_PLAYBACK_SPEED);
    const s = Math.round(start ?? 0);
    const e = Math.round(end ?? s);
    if (s === e) {
      this._setWeatherFrame(channelKey, s);
      return;
    }

    const step = s < e ? 1 : -1;
    let current = s;
    const anim = { timerId: null, loop: true, type: 'loop' };
    const frameJump = Math.max(1, Math.round(WEATHER_PLAYBACK_SPEED));
    const range = Math.abs(e - s) + 1;

    const tick = () => {
      this._setWeatherFrame(channelKey, current);
      if (step > 0) {
        let next = current + step * frameJump;
        if (next > e) {
          const offset = (next - s) % range;
          next = s + offset;
        }
        current = next;
      } else {
        let next = current + step * frameJump;
        if (next < e) {
          const offset = (s - next) % range;
          next = s - offset;
          if (next < e) {
            next = s;
          }
        }
        current = next;
      }
      anim.timerId = setTimeout(tick, frameDuration);
    };

    this._weatherAnimations[channelKey] = anim;
    tick();
  }

  _clearWeatherAnimation(channelKey = null, options = {}) {
    const { resolveCancelled = true } = options;
    if (!this._weatherAnimations) return;
    const keys = channelKey ? [channelKey] : Object.keys(this._weatherAnimations);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const anim = this._weatherAnimations[key];
      if (!anim) continue;
      if (anim.timerId !== null) {
        clearTimeout(anim.timerId);
        anim.timerId = null;
      }
      if (resolveCancelled && typeof anim.resolve === 'function') {
        const resolver = anim.resolve;
        anim.resolve = null;
        resolver();
      }
      this._weatherAnimations[key] = null;
    }
  }

  _createWeatherSheetMeta(channelCfg, basePath = this._uiAssetBasePath || '') {
    const sheetCfg = channelCfg?.sheet;
    if (!sheetCfg?.file) return null;
    const columns = Math.max(1, Math.round(sheetCfg.columns ?? 1));
    const rows = Math.max(1, Math.round(sheetCfg.rows ?? 1));
    const maxFrames = columns * rows;
    const requestedFrames = Math.round(sheetCfg.frameCount ?? maxFrames);
    const totalFrames = clamp(requestedFrames, 1, maxFrames);
    const frameOffset = Math.max(0, Math.round(sheetCfg.frameOffset ?? 0));
    const frameWidth = sheetCfg.frameWidth || 512;
    const frameHeight = sheetCfg.frameHeight || 288;
    const src = this._normalizeAssetPath(basePath, sheetCfg.file);
    return {
      src,
      columns,
      rows,
      totalFrames,
      frameOffset,
      frameWidth,
      frameHeight
    };
  }

  _weatherFrameToUrl(channelKey, frame) {
    if (!Number.isFinite(frame)) return '';
    const cfg = this._weatherChannels?.[channelKey]?.config || this._weatherConfig?.[channelKey];
    if (!cfg) return '';
    const digits = Math.max(1, cfg.frameDigits ?? 1);
    const prefix = cfg.framePrefix || '';
    const extension = cfg.frameExtension || '.png';
    const folderPath = cfg.folder
      ? this._normalizeAssetPath(this._uiAssetBasePath, cfg.folder)
      : this._uiAssetBasePath;
    const frameNumber = Math.max(0, Math.round(frame ?? 0));
    const filename = `${prefix}${frameNumber.toString().padStart(digits, '0')}${extension}`;
    return this._normalizeAssetPath(folderPath, filename);
  }

  _setWeatherFrame(channelKey, frame) {
    if (!Number.isFinite(frame)) return;
    if (!this._weatherCurrentFrame) {
      this._weatherCurrentFrame = {};
    }
    const channel = this._weatherChannels?.[channelKey];
    if (!channel?.image) return;
    const rounded = Math.round(frame);
    if (this._weatherCurrentFrame[channelKey] === rounded) {
      return;
    }
    this._weatherCurrentFrame[channelKey] = rounded;

    if (channel.sheet) {
      this._applyWeatherSheetFrame(channel, rounded);
      return;
    }

    const url = this._weatherFrameToUrl(channelKey, rounded);
    if (!url) return;
    channel.image.src = url;
  }

  _applyWeatherSheetFrame(channel, frameNumber) {
    if (!channel?.sheet || !channel?.image?.style) return;
    const sheet = channel.sheet;
    const total = Math.max(1, sheet.totalFrames ?? (sheet.columns * sheet.rows));
    const offset = Math.max(0, sheet.frameOffset ?? 0);
    let idx = Math.round((Number.isFinite(frameNumber) ? frameNumber : 0) - offset);
    if (!Number.isFinite(idx)) idx = 0;
    idx = clamp(idx, 0, total - 1);
    const col = idx % sheet.columns;
    const row = Math.floor(idx / sheet.columns);
    const x = sheet.columns > 1 ? (col / (sheet.columns - 1)) * 100 : 0;
    const y = sheet.rows > 1 ? (row / (sheet.rows - 1)) * 100 : 0;
    channel.image.style.backgroundSize = `${sheet.columns * 100}% ${sheet.rows * 100}%`;
    channel.image.style.backgroundPosition = `${x}% ${y}%`;
  }

  _syncToolButtons() {
    const activeId = this._activeTool;

    const highlightButton = (element, isActive, enabled = true) => {
      if (!element) return;
      element.style.transform = isActive && enabled ? 'scale(1.03)' : 'scale(1)';
      if (enabled) {
        element.style.filter = isActive ? 'drop-shadow(0 0 1.4vw rgba(255, 209, 102, 0.85))' : 'none';
        element.style.opacity = '1';
        element.style.pointerEvents = 'auto';
        element.style.cursor = 'pointer';
      } else {
        element.style.filter = 'grayscale(100%) brightness(0.65)';
        element.style.opacity = '0.65';
        element.style.pointerEvents = 'none';
        element.style.cursor = 'default';
      }
    };

    highlightButton(this._buttons.sediment, activeId === 'sediment', this._sedimentEnabled);
    highlightButton(this._buttons.remove, activeId === 'remove', this._removeEnabled);

    const unavailableFilter = 'grayscale(100%) brightness(0.65)';
    const unavailableOpacity = '0.65';
    const seedIds = Object.keys(this._seedButtons);
    for (let i = 0; i < seedIds.length; i++) {
      const seedId = seedIds[i];
      const entry = this._seedButtons[seedId];
      if (!entry) continue;
      const { segment, image, overlay, highlight } = entry;
      const available = this._availableSeedIds.has(seedId);
      const isActive = activeId === seedId;

      if (segment) {
        segment.style.pointerEvents = available ? 'auto' : 'none';
        segment.style.cursor = available ? 'pointer' : 'default';
        segment.style.transform = 'scale(1)';
        segment.style.boxShadow = 'none';
        segment.style.opacity = available ? '1' : unavailableOpacity;
        segment.style.filter = available ? 'none' : unavailableFilter;
      }

      if (overlay) {
        overlay.style.opacity = available ? '0' : '1';
      }

      if (highlight) {
        highlight.style.opacity = available && isActive ? '1' : '0';
        highlight.style.transform = available && isActive ? 'scale(1.03)' : 'scale(1)';
      }

      if (image) {
        const filters = [];
        if (!available) {
          filters.push(unavailableFilter);
        }
        if (available && isActive) {
          filters.push('saturate(1.2) brightness(1.05)');
        }
        image.style.filter = filters.length ? filters.join(' ') : 'none';
        image.style.opacity = available ? '1' : unavailableOpacity;
        image.style.transform = available && isActive ? 'scale(1.05)' : 'scale(1)';
      }
    }

    if (activeId !== 'sediment') {
      this._pointerDown = false;
    }
    this._updateSeedLabels();
    this._updateSeedLabelDisplay(activeId);
    this._refreshCursor();
  }

  _updateSeedLabelDisplay(activeSeedId) {
    const labelCfg = this.params.ui?.elements?.seeder?.label || {};
    const hiddenOffsetVW = labelCfg.hiddenOffsetVW ?? 1.2;
    const fallbackHidden = `translate3d(${hiddenOffsetVW}vw, -50%, 0)`;
    const fallbackVisible = 'translate3d(0, -50%, 0)';
    const entries = Object.entries(this._seedButtons || {});
    for (let i = 0; i < entries.length; i++) {
      const [seedId, entry] = entries[i];
      if (!entry?.label) continue;
      const available = this._availableSeedIds.has(seedId);
      const shouldShow = available && seedId === activeSeedId;
      const labelEl = entry.label;
      const hiddenTransform = labelEl.dataset.hiddenTransform || fallbackHidden;
      const visibleTransform = labelEl.dataset.visibleTransform || fallbackVisible;
      if (shouldShow) {
        labelEl.style.opacity = '1';
        labelEl.style.transform = visibleTransform;
      } else {
        labelEl.style.opacity = '0';
        labelEl.style.transform = hiddenTransform;
      }
    }
  }

  _isToolAvailable(toolId) {
    if (!toolId) return false;
    if (toolId === 'sediment') {
      return this._sedimentEnabled;
    }
    if (toolId === 'remove') {
      return this._removeEnabled;
    }
    return this._availableSeedIds.has(toolId);
  }

  _toggleTool(toolId) {
    if (!this._isToolAvailable(toolId)) {
      return;
    }
    if (toolId === this._activeTool) {
      return;
    }
    this._playSelectSound();
    this._activeTool = toolId;
    if (this._activeTool !== 'sediment') {
      this._pointerDown = false;
    }
    this._syncToolButtons();
  }

  _destroyUI() {
    this._stopHintCycle({ immediate: true });
    this._clearWeatherAnimation(null, { resolveCancelled: false });
    if (this._uiRoot && this._uiRoot.parentElement) {
      this._uiRoot.parentElement.removeChild(this._uiRoot);
    }
    this._setCursorVisible(false);
    if (this.app?.canvas && this._originalCanvasCursor !== null) {
      this.app.canvas.style.cursor = this._originalCanvasCursor;
      this._originalCanvasCursor = null;
    }
    if (this._uiLogoEl && this._onUiLogoPointerUp) {
      this._uiLogoEl.removeEventListener('pointerup', this._onUiLogoPointerUp);
    }
    this._uiLogoEl = null;
    this._uiRoot = null;
    this._buttons = {};
    this._seedButtons = {};
    this._cursorEl = null;
    this._goalMessageEl = null;
    this._depthMeter = null;
    this._lastPointerInfo = null;
    this._activeTool = null;
    this._removeEnabled = false;
    this._weatherChannels = {};
    this._weatherAnimations = {};
    this._weatherCurrentFrame = { top: null, bottom: null };
    this._weatherConfig = null;
    
    this._progressBarFill = null;
    this._progressBarLabel = null;
    this._progressBarContainer = null;

    this._weatherTransitionPromise = Promise.resolve();
    this._weatherState = 'low';
    this._uiAssetBasePath = this.params.ui?.elements?.basePath || '';
    this._removeMessageEl();
    this._uiRectEntries = [];

    this._tutorialOverlay = null;
    this._tutorialDimmer = null;
    this._tutorialSpotlight = null;
    this._tutorialCard = null;
    this._tutorialText = null;
    this._tutorialButton = null;
    if (this._tutorial) {
      this._tutorial.active = false;
      this._tutorial.paused = false;
      this._tutorial.queue = [];
      this._tutorial.current = null;
    }
  }

  _setWaterLevel(index) {
    const clamped = clamp(index, 0, 2);
    const previousIndex = this._waterLevelIndex;
    this._waterLevelIndex = clamped;
    this._targetWaterLevel = [this._waterLevels.low, this._waterLevels.medium, this._waterLevels.high][clamped];
    if (clamped !== previousIndex) {
      this._playWaterLevelSound(previousIndex, clamped);
    }
    this._syncWaterButtons();
    this._queueWeatherStateChange(
      this._indexToWeatherState(previousIndex),
      this._indexToWeatherState(clamped)
    );
    this._updateCloudSettings(clamped);
  }

  _updateCloudSettings(waterLevelIndex) {
    const config = this.params.sky?.clouds;
    if (!config) return;
    
    let targetCount = 3;
    let brightness = 1;
    let rainEnabled = false;
    
    if (waterLevelIndex === 1) { // Medium
      targetCount = 20;
    } else if (waterLevelIndex === 2) { // High
      targetCount = 60;
        brightness = 0.5;
        rainEnabled = true;
    }
    
    this._cloudTargetCount = targetCount;

    // Sky Color Transition
    if (waterLevelIndex === 2) {
        this._skyTargetTopColor.copy(this._skyGrayTopColor);
        this._skyTargetBottomColor.copy(this._skyGrayBottomColor);
    } else {
        this._skyTargetTopColor.copy(this._skyBaseTopColor);
        this._skyTargetBottomColor.copy(this._skyBaseBottomColor);
    }

    // Rain
    if (this._rainSystem) {
        this._rainSystem.visible = rainEnabled;
    }
    
    // Animate brightness
    const targetColor = new THREE.Color(brightness, brightness, brightness);
    if (this._clouds) {
        this._clouds.forEach(cloud => {
            if (cloud.mesh && cloud.mesh.material) {
                cloud.targetColor = targetColor;
            }
        });
    }
    this._cloudTargetColor = targetColor;

    // Handle count changes immediately
    const activeClouds = this._clouds.filter(c => !c.dying);
    const diff = targetCount - activeClouds.length;

    if (diff > 0) {
        // Spawn new clouds randomly on screen with fade in
        for (let i = 0; i < diff; i++) {
            this._spawnCloud({ position: 'random', opacity: 0, fadeIn: true });
        }
    } else if (diff < 0) {
        // Mark excess clouds as dying
        const toRemove = -diff;
        // Pick random active clouds to remove
        const candidates = activeClouds.filter(c => !c.dying);
        // Shuffle candidates
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        
        for (let i = 0; i < toRemove && i < candidates.length; i++) {
            candidates[i].dying = true;
        }
    }
  }

  _bindEvents() {
    const canvas = this.app.canvas;
    canvas.addEventListener('pointerdown', this._boundOnPointerDown);
    canvas.addEventListener('pointermove', this._boundOnPointerMove);
    canvas.addEventListener('pointerleave', this._boundOnPointerLeave);
    window.addEventListener('pointerup', this._boundOnPointerUp);
    if (this.app?.root) {
      this.app.root.addEventListener('selectstart', this._boundPreventSelection);
    }
  }

  _unbindEvents() {
    const canvas = this.app.canvas;
    canvas.removeEventListener('pointerdown', this._boundOnPointerDown);
    canvas.removeEventListener('pointermove', this._boundOnPointerMove);
    canvas.removeEventListener('pointerleave', this._boundOnPointerLeave);
    window.removeEventListener('pointerup', this._boundOnPointerUp);
    if (this.app?.root) {
      this.app.root.removeEventListener('selectstart', this._boundPreventSelection);
    }
  }

  _handlePointerDown(event) {
    if (this._tutorial?.paused) return;
    if (event.button !== 0) return;
    const tool = this._activeTool;
    if (!tool) return;
    const point = this._recordPointerPosition(event);
    if (!point) return;
    this._resumeAmbientAudio();
    if (tool === 'sediment') {
      const state = this._resolveInteractionState(point.x, point.y);
      if (!state?.canSediment) return;
      const emitted = this._emitSediment(point.x, point.y, state);
      this._pointerDown = emitted;
    } else if (tool === 'remove') {
      if (!this._removeEnabled) return;
      const plant = this._findPlantAt(point.x, point.y);
      if (plant) {
        this._removePlant(plant);
      }
    } else {
      this._handlePlantingAction(tool, point.x, point.y);
    }
  }

  _handlePointerMove(event) {
    if (this._tutorial?.paused) return;
    const point = this._recordPointerPosition(event);
    if (!point) return;
    if (!this._pointerDown || this._activeTool !== 'sediment' || event.buttons === 0) {
      if (event.buttons === 0) this._pointerDown = false;
      return;
    }
    const state = this._resolveInteractionState(point.x, point.y);
    if (!state?.canSediment) {
      this._pointerDown = false;
      return;
    }
    const emitted = this._emitSediment(point.x, point.y, state);
    if (!emitted) {
      this._pointerDown = false;
    }
  }

  _handlePointerLeave() {
    this._pointerDown = false;
    this._lastPointerInfo = null;
    this._setCursorVisible(false);
  }

  _recordPointerPosition(event) {
    const point = this._getWorldPointer(event);
    if (!point) {
      this._lastPointerInfo = null;
      this._refreshCursor();
      return null;
    }
    this._lastPointerInfo = {
      clientX: event.clientX,
      clientY: event.clientY,
      worldX: point.x,
      worldY: point.y
    };
    this._refreshCursor();
    return point;
  }

  _setCursorVisible(visible) {
    if (!this._cursorEl) return;
    this._cursorEl.style.display = visible ? 'block' : 'none';
    if (!visible) {
      this._cursorEl.style.opacity = '0';
    }
  }

  _refreshCursor() {
    if (!this._cursorEl) return;
    const info = this._lastPointerInfo;
    if (!info) {
      this._cursorEl.style.opacity = '0';
      this._setCursorVisible(false);
      return;
    }

    this._cursorEl.style.left = `${info.clientX}px`;
    this._cursorEl.style.top = `${info.clientY}px`;

    const state = this._resolveInteractionState(info.worldX, info.worldY);
    const colors = this.params.colors;
    const cursorCfg = this.params.ui.cursor || {};
    const diameter = cursorCfg.diameterVW ?? 1.8;
    const borderWidth = cursorCfg.borderWidthVW ?? 0.14;
    const transitionSeconds = cursorCfg.transitionSeconds ?? 0.12;

    this._cursorEl.style.width = `${diameter}vw`;
    this._cursorEl.style.height = `${diameter}vw`;
    this._cursorEl.style.borderWidth = `${borderWidth}vw`;
    this._cursorEl.style.transition = `background ${transitionSeconds}s ease, box-shadow ${transitionSeconds}s ease, opacity ${transitionSeconds}s ease`;

    let mode = 'blocked';
    if (!this._activeTool) {
      mode = 'none';
    } else if (this._activeTool === 'sediment') {
      mode = state?.canSediment ? 'sediment' : 'blocked';
    } else if (this._activeTool === 'remove') {
      const plant = this._findPlantAt(info.worldX, info.worldY);
      mode = plant ? 'remove' : 'blocked';
    } else {
      const seedAvailable = this._availableSeedIds.has(this._activeTool);
      mode = seedAvailable && state?.canPlant ? 'seed' : 'blocked';
    }

    if (mode === 'none') {
      this._cursorEl.style.opacity = '0';
      this._setCursorVisible(false);
      return;
    }

    const palette = {
      sediment: colors.cursorSediment,
      seed: colors.cursorSeed,
      remove: colors.cursorRemove,
      blocked: colors.cursorDisabled
    };
    const color = palette[mode] || colors.cursorDisabled;
    this._cursorEl.style.background = color;
    this._cursorEl.style.opacity = mode === 'blocked' ? '0.7' : '0.95';
    this._cursorEl.style.boxShadow = mode === 'blocked'
      ? '0 0 0.6vw rgba(0,0,0,0.25)'
      : '0 0 1vw rgba(0,0,0,0.35)';
    this._setCursorVisible(true);
  }

  _getWorldPointer(event) {
    const rect = this.app.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    const x = clamp(nx * this.worldWidth, 0, this.worldWidth);
    const y = this.worldBottom + (1 - ny) * this.worldHeight;
    return { x, y };
  }

  _disposeObjects() {
    const disposeMesh = (mesh) => {
      if (!mesh) return;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose?.());
        else mesh.material.dispose?.();
      }
      this.scene.remove(mesh);
    };

    disposeMesh(this._background);
    disposeMesh(this._waterStrip?.mesh);
    disposeMesh(this._riverbedStrip?.mesh);
    disposeMesh(this._averageLine);
    disposeMesh(this._particlesPoints);

    if (this._cloudGroup) {
      for (let i = this._cloudGroup.children.length - 1; i >= 0; i--) {
        const child = this._cloudGroup.children[i];
        if (child.material) {
          child.material.dispose?.();
        }
      }
      this.scene.remove(this._cloudGroup);
    }
    this._cloudGroup = null;
    this._clouds = [];
    this._cloudSpawnTimer = 0;
    this._cloudTextures.forEach((texture) => texture.dispose?.());
    this._cloudTextures.clear();
    if (this._cloudUnitPlane) {
      this._cloudUnitPlane.dispose?.();
      this._cloudUnitPlane = null;
    }

    if (this._seedEffectGroup) {
      for (let i = 0; i < this._seedEffectGroup.children.length; i++) {
        const child = this._seedEffectGroup.children[i];
        if (child.geometry) child.geometry.dispose?.();
      }
      this.scene.remove(this._seedEffectGroup);
    }
    if (this._seedEffectMaterial) {
      this._seedEffectMaterial.dispose?.();
    }

    for (let i = 0; i < this._plants.length; i++) {
      const plant = this._plants[i];
      this._clearPlantSequenceCallbacks(plant);
      this._releasePlantAnimation(plant);
      plant.disposed = true;
      if (plant.mesh) {
        this.scene.remove(plant.mesh);
      }
      if (plant.loaderMesh) {
        this.scene.remove(plant.loaderMesh);
        if (plant.loaderMesh.geometry) plant.loaderMesh.geometry.dispose();
        if (plant.loaderMesh.material) plant.loaderMesh.material.dispose();
      }
      if (plant.glowMesh) {
        this.scene.remove(plant.glowMesh);
        if (plant.glowMesh.geometry) plant.glowMesh.geometry.dispose();
        if (plant.glowMesh.material) plant.glowMesh.material.dispose();
      }
    }

    this._plantGeometryCache.forEach((geo) => geo.dispose?.());
    this._seedMaterialCache.forEach((mat) => mat.dispose?.());
    this._plantMaterialCache.forEach((mat) => mat.dispose?.());
    const sequenceEntries = Array.from(this._plantSequenceCache.values());
    for (let i = 0; i < sequenceEntries.length; i++) {
      this._disposeSequence(sequenceEntries[i]);
    }
    this._plantSequenceCache.clear();
    this._plantMaterialCache.clear();
    this._plantGeometryCache.clear();
    this._seedMaterialCache.clear();
    this._seedCatalog.clear();
    if (this._unitPlantPlane) {
      this._unitPlantPlane.dispose?.();
      this._unitPlantPlane = null;
    }

    this._seedBursts = [];
    this._seedEffectGroup = null;
    this._seedEffectMaterial = null;
    this._plants = [];
    this._availableSeedIds.clear();

    this._background = null;
    if (this._backgroundTexture) {
      this._backgroundTexture.dispose?.();
      this._backgroundTexture = null;
    }
    this._waterStrip = null;
    this._riverbedStrip = null;
    if (this._sandTexture) {
      this._sandTexture.dispose?.();
      this._sandTexture = null;
    }
    this._averageLine = null;
    this._particlesPoints = null;
    this._particlesGeometry = null;
    this._particles = [];
    this._activeParticles = 0;
  }

  _buildStripGeometry(segments) {
    const vertexCount = (segments + 1) * 2;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint16Array(segments * 6);
    const topIndices = new Array(segments + 1);
    const bottomIndices = new Array(segments + 1);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const topIdx = i * 2;
      const bottomIdx = topIdx + 1;
      topIndices[i] = topIdx;
      bottomIndices[i] = bottomIdx;

      uvs[topIdx * 2] = t;
      uvs[topIdx * 2 + 1] = 0;
      uvs[bottomIdx * 2] = t;
      uvs[bottomIdx * 2 + 1] = 1;
    }

    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      const idx = i * 6;
      indices[idx + 0] = a;
      indices[idx + 1] = b;
      indices[idx + 2] = c;
      indices[idx + 3] = b;
      indices[idx + 4] = d;
      indices[idx + 5] = c;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return { geometry, topIndices, bottomIndices };
  }

  _createProgressBar(root) {
    const { ui, colors } = this.params;
    
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '40px';
    container.style.top = '40px';
    container.style.width = '300px';
    container.style.padding = '15px 20px';
    container.style.background = colors.uiBackground || 'rgba(10, 34, 61, 0.6)';
    container.style.borderRadius = '12px';
    container.style.backdropFilter = 'blur(4px)';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '10';
    
    const label = document.createElement('div');
    label.textContent = 'Progreso';
    label.style.color = colors.uiText || '#f8fafc';
    label.style.fontSize = '16px';
    label.style.fontWeight = '600';
    if (this._uiFontFamily) {
      label.style.fontFamily = this._uiFontFamily;
    }
    container.appendChild(label);

    const barContainer = document.createElement('div');
    barContainer.style.width = '100%';
    barContainer.style.height = '12px';
    barContainer.style.background = 'rgba(0, 0, 0, 0.4)';
    barContainer.style.borderRadius = '6px';
    barContainer.style.overflow = 'hidden';
    container.appendChild(barContainer);

    const barFill = document.createElement('div');
    barFill.style.width = '0%';
    barFill.style.height = '100%';
    barFill.style.background = colors.uiAccent || '#ffd166';
    barFill.style.transition = 'width 0.3s ease-out';
    barContainer.appendChild(barFill);

    root.appendChild(container);
    
    this._progressBarFill = barFill;
    this._progressBarLabel = label;
    this._progressBarContainer = container;
  }

  _updateProgressBar() {
    if (!this._progressBarFill) return;
    
    const stage = this._stages[this._currentStageIndex];
    if (stage && this._progressBarLabel) {
        this._progressBarLabel.textContent = stage.name || 'Progreso de etapa';
    }

    const progress = this._calculateStageProgress();
    const pct = Math.min(100, Math.max(0, progress * 100));
    this._progressBarFill.style.width = `${pct}%`;
    
    if (progress >= 1.0 && !this._stageComplete) {
        this._onStageGoalReached();
    }
  }

  _calculateStageProgress() {
    const stage = this._stages[this._currentStageIndex];
    if (!stage || !stage.goal) return 0;

    const goal = stage.goal;
    
    if (goal.type === 'riverbedCoverage') {
      return this._calculateLandCoverage(goal);
    } else if (goal.type === 'riverbedMaxHeight') {
      return this._calculateRiverbedMaxHeightProgress(goal);
    } else if (goal.type === 'plantCounts') {
        return this._calculatePlantProgress(goal);
    }
    
    return 0;
  }

  _calculateLandCoverage(goal) {
    const heights = this._riverbedHeights;
    if (!heights?.length) return 0;
    
    const threshold = Math.max(0, goal.coverage ?? 0.1);
    if (threshold === 0) return 1;

    const level = this._waterLevels.medium;
    let elevated = 0;
    for (let i = 0; i < heights.length; i++) {
      if (heights[i] >= level + (goal.minElevationAboveWater || 0)) elevated += 1;
    }
    
    const coverage = elevated / heights.length;
    return coverage / threshold;
  }

  _calculateRiverbedMaxHeightProgress(goal) {
    const heights = this._riverbedHeights;
    if (!heights?.length) return 0;

    const riverbed = this.params.riverbed || {};
    const segments = riverbed.segments ?? (heights.length - 1);
    if (!Number.isFinite(segments) || segments <= 0) return 0;

    const plateauStartRaw = clamp(riverbed.plateauStart ?? 0.2, 0, 1);
    const plateauEndRaw = clamp(riverbed.plateauEnd ?? 0.8, 0, 1);
    const innerStart = Math.min(plateauStartRaw, plateauEndRaw);
    const innerEnd = Math.max(plateauStartRaw, plateauEndRaw);

    const transitionWidth = Math.max(0.0001, riverbed.transitionWidth ?? 0.1);
    const halfTransition = transitionWidth * 0.5;
    const outerStart = clamp(innerStart - halfTransition, 0, 1);
    const outerEnd = clamp(innerEnd + halfTransition, 0, 1);
    const leftSpan = Math.max(1e-5, innerStart - outerStart);
    const rightSpan = Math.max(1e-5, outerEnd - innerEnd);

    const capCfg = riverbed.growthCap ?? {};
    const capEnabled = capCfg.enabled !== false;
    const islandSpan = Math.max(1e-5, innerEnd - innerStart);

    const avgWaterLevel = (this._waterLevels?.medium ?? this.params.water?.baseLevel ?? 0);
    const noiseAmp = Math.max(0, capCfg.noiseAmplitude ?? 0);
    const baseAboveAverage = Math.max(noiseAmp + 0.02, capCfg.baseAboveAverageWater ?? 0.09);
    const baseCap = avgWaterLevel + baseAboveAverage;
    const sideLift = Math.max(0, capCfg.sideLift ?? 0);
    const noiseFreq = Math.max(1e-4, capCfg.noiseFrequency ?? 1);
    const capSeed = (typeof capCfg.seed === 'number' && Number.isFinite(capCfg.seed)) ? capCfg.seed : 0;

    const plateauCapAtU = (u) => {
      const uClamped = clamp(u, 0, 1);
      const parabola = 4 * (uClamped - 0.5) * (uClamped - 0.5);
      const capNoise = this._noise2D(uClamped * noiseFreq + capSeed * 0.13, capSeed) * noiseAmp;
      const profile = baseCap + sideLift * parabola + capNoise;
      return clamp(profile, riverbed.bottom, riverbed.maxHeight);
    };

    const capAtIndex = (i, normalized) => {
      if (!capEnabled) return riverbed.maxHeight;
      if (normalized < outerStart || normalized > outerEnd) return riverbed.maxHeight;

      const baseAtX = (this._riverbedBase?.[i] ?? riverbed.bottom);
      const leftEdgeCap = plateauCapAtU(0);
      const rightEdgeCap = plateauCapAtU(1);

      if (normalized >= innerStart && normalized <= innerEnd) {
        const u = (normalized - innerStart) / islandSpan;
        return plateauCapAtU(u);
      }

      if (normalized < innerStart) {
        const t = saturate((normalized - outerStart) / leftSpan);
        return lerp(baseAtX, leftEdgeCap, smoothstep(0, 1, t));
      }
      const t = saturate((outerEnd - normalized) / rightSpan);
      return lerp(baseAtX, rightEdgeCap, smoothstep(0, 1, t));
    };

    const epsilon = Math.max(0, goal?.epsilon ?? 0.0015);
    let total = 0;
    let reached = 0;

    for (let i = 0; i <= segments; i++) {
      const normalized = i / segments;
      if (normalized < outerStart || normalized > outerEnd) continue;
      total += 1;

      const maxAtX = capAtIndex(i, normalized);
      if ((heights[i] ?? riverbed.bottom) >= maxAtX - epsilon) {
        reached += 1;
      }
    }

    if (total <= 0) return 1;
    const progress = reached / total;
    const threshold = 0.8;
    return Math.min(1, progress / threshold);
  }

  _calculatePlantProgress(goal) {
    const species = goal.species || {};
    const ids = Object.keys(species);
    if (!ids.length) return 1;

    let totalPoints = 0;
    let maxTotalPoints = 0;
    const pointsPerPlant = this._plantStages.length; 

    for (const id of ids) {
        const requiredCount = species[id];
        const maxSpeciesPoints = requiredCount * pointsPerPlant;
        maxTotalPoints += maxSpeciesPoints;

        const plantsOfSpecies = this._plants.filter(p => p.seed?.id === id);
        
        const plantPoints = plantsOfSpecies.map(p => p.stageIndex + 1)
            .sort((a, b) => b - a);
        
        let speciesPoints = 0;
        for (let i = 0; i < Math.min(requiredCount, plantPoints.length); i++) {
            speciesPoints += plantPoints[i];
        }
        
        totalPoints += speciesPoints;
    }

    if (maxTotalPoints === 0) return 1;
    return totalPoints / maxTotalPoints;
  }
}
