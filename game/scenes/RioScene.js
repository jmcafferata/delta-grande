import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BaseScene } from '../core/BaseScene.js';
import { AssetLoader } from '../core/AssetLoader.js';
import { EventBus } from '../core/EventBus.js';
import { UI } from '../core/UI.js';
import { State } from '../core/State.js';

const ensureTrailingSlash = (value = '') => (value.endsWith('/') ? value : `${value}/`);
const computePublicBaseUrl = () => {
  const envBase = import.meta?.env?.BASE_URL;
  if (envBase) {
    return ensureTrailingSlash(envBase);
  }
  if (typeof window !== 'undefined' && window.location) {
    // When served from /game/, step one level up so shared assets resolve both locally and online.
    return ensureTrailingSlash(new URL('../', window.location.href).href);
  }
  return '/';
};

const PUBLIC_BASE_URL = computePublicBaseUrl();
const resolvePublicAsset = (path) => {
  const trimmed = path.replace(/^\/+/, '');
  return `${PUBLIC_BASE_URL}${trimmed}`;
};
import {
  autoRigTwoBoneFishMesh,
  findTailBoneFromSkeleton,
  findTailBoneDirectional,
  findHeadBoneDirectional
} from '../utils/autoRigFish.js';


/**
 * =============================================================
 * RioScene — geometry + behavior aligned to explicit world params
 * =============================================================
 *
 * What’s new / key guarantees
 * ---------------------------
 * • A single, explicit set of world-space parameters drives *everything*:
 *   - surfaceLevel  : y of the water surface plane, fog toggle, swimbox Y max,
 *                     and camera Y max (via cameraSurfaceMargin).
 *   - floorLevel    : y of the riverbed; also camera Y min and swimbox Y min.
 *   - shoreLevel    : x of the shoreline; also swimbox X min.
 *   - cameraLevel   : camera’s current x (distance from shore); also swimbox X max.
 *   - leftLimit     : z min for both swimbox and camera movement.
 *   - rightLimit    : z max for both swimbox and camera movement.
 *
 * • No hidden offsets or derived magic: the above parameters are used directly.
 *   (The only deliberate offset is cameraSurfaceMargin so the camera can go
 *    slightly above the water surface for comfort; it’s an explicit param.)
 *
 * • Fish biasing keeps Gaussian behavior but default σ = 0 for X and Y
 *   (shore/camera and high/low directions) to simplify debugging.
 *   You can tune both σ and the means per stratum/shoring easily in params.
 *
 * • Gameplay Update: A fish-catching deck UI is now overlaid on the scene.
 *   - Players can cycle through fish species using arrow keys.
 *   - Clicking a fish in the water while the matching species is selected
 *     "catches" it, revealing its model in the deck and incrementing a counter.
 */

/* -------------------------------------------------------------
 * Utility functions
 * ------------------------------------------------------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp  = (a, b, t) => a + (b - a) * t;

// Standard normal noise (Box–Muller). mean=0, sigma=1
const randn = () => {
  let u = 1 - Math.random();
  let v = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// Asegura que cada clon tenga materiales propios (sin compartir referencias)
function makeMaterialsUnique(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map(m => (m && m.clone) ? m.clone() : m);
    } else if (o.material && o.material.clone) {
      o.material = o.material.clone();
    }
  });
}

// Unified helper so any UI element (map overlays, deck logos, etc.) can mimic the ESC shortcut.
const triggerPauseMenuOverlay = () => {
  if (typeof window === 'undefined') return;
  if (typeof window.showPauseMenu === 'function') {
    window.showPauseMenu();
    return;
  }
  const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  window.dispatchEvent(escapeEvent);
};


/* -------------------------------------------------------------
 * Spatial hash (O(n) neighborhood queries)
 * ------------------------------------------------------------- */
class SpatialHash {
  constructor(cellSize = 3.0) {
    this.s = cellSize;   // tune ~ separationRadius
    this.map = new Map();
  }
  _key(v) {
    const s = this.s;
    return `${Math.floor(v.x/s)},${Math.floor(v.y/s)},${Math.floor(v.z/s)}`;
  }
  rebuild(agents) {
    this.map.clear();
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const k = this._key(a.pos);
      let bin = this.map.get(k);
      if (!bin) { bin = []; this.map.set(k, bin); }
      bin.push(a);
    }
  }
  neighbors(p) {
    const res = [];
    const s = this.s;
    const cx = Math.floor(p.x/s), cy = Math.floor(p.y/s), cz = Math.floor(p.z/s);
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
      const bin = this.map.get(`${cx+dx},${cy+dy},${cz+dz}`);
      if (bin) res.push(...bin);
    }
    return res;
  }
}

/* -------------------------------------------------------------
 * Bubble System for surface transition
 * ------------------------------------------------------------- */
class BubbleSystem {
  constructor(container, baseColor = null) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.baseColor = baseColor; // THREE.Color or null
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '10'
    });
    container.appendChild(this.canvas);
    this.bubbles = [];
    this.active = false;
    this.intensity = 0; // 0..1
    this.maxBubbles = 0;
    this._maxSpawnPerFrame = 60;
    this._fadeInSec = 0.12;
    this._fadeOutSec = 0.18;
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    this._onVVResize = () => this.resize();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this._onVVResize);
      window.visualViewport.addEventListener('scroll', this._onVVResize);
    }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (window.visualViewport && this._onVVResize) {
      window.visualViewport.removeEventListener('resize', this._onVVResize);
      window.visualViewport.removeEventListener('scroll', this._onVVResize);
    }
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }

  resize() {
    const parent = this.container || this.canvas.parentElement;
    const vv = window.visualViewport;
    const w = Math.floor(parent?.clientWidth || vv?.width || window.innerWidth || 1);
    const h = Math.floor(parent?.clientHeight || vv?.height || window.innerHeight || 1);
    this.canvas.width = Math.max(1, w);
    this.canvas.height = Math.max(1, h);
    // Area-based cap so “full intensity” can cover the screen across resolutions.
    // Tuned so 1080p lands around ~400 bubbles.
    const area = Math.max(1, this.canvas.width * this.canvas.height);
    this.maxBubbles = clamp(Math.round(area / 5200), 180, 900);
  }

  setIntensity(value) {
    const v = clamp(Number(value) || 0, 0, 1);
    this.intensity = v;
    this.active = v > 0;

    // Requirement: outside the margin, bubbles drop to 0 immediately.
    if (!this.active) {
      this.bubbles.length = 0;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  createBubble() {
    // Wider size range (with bias toward smaller bubbles), so a few feel close to camera.
    const minRadius = 4;
    const maxRadius = 196;

    const pBig = 0.03; // ~3% giants
    const t = (Math.random() < pBig)
      ? (1 - Math.pow(Math.random(), 6)) // hug the max
      : Math.pow(Math.random(), 3.5);    // mostly small

    const radius = minRadius + t * (maxRadius - minRadius);
    return {
      x: Math.random() * this.canvas.width,
      y: this.canvas.height + radius + Math.random() * 200,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -Math.random() * 8 - 4,
      radius: radius,
      alphaBase: Math.random() * 0.4 + 0.1,
      alpha: 0,
      ageSec: 0,
      lifeSec: Math.random() * 0.9 + 0.7,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: Math.random() * 0.1 + 0.05,
      wobbleAmp: Math.random() * 3 + 1
    };
  }

  update(dt) {
    if (!this.active && this.bubbles.length === 0) return;

    const smoothstep01 = (t) => {
      const x = clamp(t, 0, 1);
      return x * x * (3 - 2 * x);
    };

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Keep bubble density proportional to intensity.
    if (this.active) {
      const target = Math.round(this.maxBubbles * this.intensity);
      const need = target - this.bubbles.length;
      if (need > 0) {
        const spawn = Math.min(need, this._maxSpawnPerFrame);
        for (let i = 0; i < spawn; i++) {
          const b = this.createBubble();
          // Spawn across the screen so it fills immediately near surface.
          b.y = Math.random() * this.canvas.height;
          this.bubbles.push(b);
        }
      } else if (need < 0) {
        // As intensity drops but still > 0, thin out quickly.
        this.bubbles.length = target;
      }
    }

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];

      b.ageSec += dt;
      const fadeIn = smoothstep01(b.ageSec / Math.max(0.0001, this._fadeInSec));
      const fadeOut = smoothstep01((b.lifeSec - b.ageSec) / Math.max(0.0001, this._fadeOutSec));
      // Also scale alpha with overall intensity so entering/leaving is smoother.
      b.alpha = b.alphaBase * fadeIn * fadeOut * clamp(this.intensity, 0, 1);

      if (b.ageSec >= b.lifeSec) {
        if (this.active) {
          Object.assign(b, this.createBubble());
        } else {
          this.bubbles.splice(i, 1);
          continue;
        }
      }

      b.x += b.vx + Math.sin(b.wobble) * b.wobbleAmp;
      b.y += b.vy;
      b.wobble += b.wobbleSpeed;

      if (b.y + b.radius < -50) {
        if (this.active) {
          Object.assign(b, this.createBubble());
        } else {
          this.bubbles.splice(i, 1);
          continue;
        }
      }

      this.drawBubble(b);
    }
  }

  drawBubble(b) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = b.alpha;
    
    // Main bubble body
    ctx.beginPath();
    const grad = ctx.createRadialGradient(
      b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.1,
      b.x, b.y, b.radius
    );

    let r = 200, g = 230, b_col = 255;
    if (this.baseColor) {
      // Make bubbles significantly darker than the background for contrast
      const darker = this.baseColor.clone().multiplyScalar(0.4);
      r = Math.floor(darker.r * 255);
      g = Math.floor(darker.g * 255);
      b_col = Math.floor(darker.b * 255);
    }

    grad.addColorStop(0, 'rgba(255, 255, 255, 0.4)'); // Dimmer center
    grad.addColorStop(0.4, `rgba(${r}, ${g}, ${b_col}, 0.7)`); // Darker, more opaque body
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b_col}, 0.3)`); // Darker edges
    
    ctx.fillStyle = grad;
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Rim highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Specular highlight
    ctx.beginPath();
    ctx.ellipse(b.x - b.radius * 0.4, b.y - b.radius * 0.4, b.radius * 0.2, b.radius * 0.1, Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fill();

    ctx.restore();
  }
}


/* -------------------------------------------------------------
 * Param scales and species configuration
 * ------------------------------------------------------------- */
const SizeScale       = { small: 1.0,  medium: 1.5,  large: 2.0 };
const SpeedScale      = { slow: 0.3,   medium: 0.8,  fast: 1.5 };
const AbundanceCount  = { scarce: 2,   usual: 6,    veryCommon: 10 };
//const AbundanceCount  = { scarce: 1,   usual: 1,    veryCommon: 1 };

/**
 * Species water-column / shore mapping keys:
 *   - water: 'surface' | 'midwater' | 'bottom'
 *   - shore: 'near'    | 'mid'      | 'deep'
 *
 * If a GLB fails to load, a colored prism is used as fallback.
 * `flips` may invert local axes so the auto-detected long axis
 * points “forward” correctly per model.
 */

const default_wiggle = {
  mode: 'lr',                   // 'lr' (left/right) or 'ud' (up/down)
  moving: 'tail',               // 'tail' (default) or 'head'
  periodSec: 0.7,               // wiggle period
  amplitudeDeg: 18,             // rotation amplitude
  softness: 0.12                // head–tail blend width (0..0.5)
}

const SPECIES = [
  {
    key: 'dorado',
    displayName: 'Dorado (Salminus brasiliensis)',
    glb: '/game-assets/sub/fish/dorado.glb',
    fallbackColor: 0xF3C623,
    flips: { x: false, y: false, z: false },
    wiggle: {
      enabled: true,
      mode: default_wiggle.mode,
      moving: default_wiggle.moving,
      periodSec: default_wiggle.periodSec,
      amplitudeDeg: 9,
      softness: 0
    },
    size: 'large', abundance: 'usual', speed: 'fast', water: 'midwater', shore: 'mid'
  },
  {
    key: 'sabalo',
    displayName: 'Sábalo (Prochilodus lineatus)',
    glb: '/game-assets/sub/fish/sabalo.glb',
    fallbackColor: 0x9FB2BF,
    flips: { x: false, y: false, z: true },
    wiggle: {
      enabled: true,
      mode: default_wiggle.mode,
      moving: default_wiggle.moving,
      periodSec: default_wiggle.periodSec,
      amplitudeDeg: default_wiggle.amplitudeDeg,
      softness: default_wiggle.softness
    },
    size: 'medium', abundance: 'veryCommon', speed: 'medium', water: 'bottom', shore: 'near'
  },
  {
    key: 'pacu',
    displayName: 'Pacú (Piaractus mesopotamicus)',
    glb: '/game-assets/sub/fish/pacu.glb',
    fallbackColor: 0xA14A2E,
    flips: { x: false, y: false, z: true },
    wiggle: {
      enabled: true,
      mode: default_wiggle.mode,
      moving: default_wiggle.moving,
      periodSec: default_wiggle.periodSec,
      amplitudeDeg: default_wiggle.amplitudeDeg,
      softness: default_wiggle.softness
    },
    size: 'medium', abundance: 'usual', speed: 'medium', water: 'surface', shore: 'mid'
  },
  {
    key: 'armado_chancho',
    displayName: 'Armado chancho (Pterodoras granulosus)',
    glb: '/game-assets/sub/fish/armado_chancho.glb',
    fallbackColor: 0x6D5D4B,
    flips: { x: false, y: false, z: false },
    wiggle: {
      enabled: true,
      mode: default_wiggle.mode,
      moving: default_wiggle.moving,
      periodSec: default_wiggle.periodSec,
      amplitudeDeg: 9,
      softness: default_wiggle.softness
    },
    size: 'medium', abundance: 'usual', speed: 'slow', water: 'bottom', shore: 'deep'
  },
  {
    key: 'palometa_brava',
    displayName: 'Palometa brava (Serrasalmus maculatus)',
    glb: '/game-assets/sub/fish/palometa_brava.glb',
    fallbackColor: 0xD04F4F,
    flips: { x: false, y: false, z: false },
    wiggle: {
      enabled: true,
      mode: default_wiggle.mode,
      moving: default_wiggle.moving,
      periodSec: default_wiggle.periodSec,
      amplitudeDeg: default_wiggle.amplitudeDeg,
      softness: default_wiggle.softness
    },
    size: 'small', abundance: 'veryCommon', speed: 'fast', water: 'surface', shore: 'near'
  },
  {
    key: 'vieja_del_agua',
    displayName: 'Vieja del agua (Hypostomus commersoni)',
    glb: '/game-assets/sub/fish/vieja_del_agua.glb',
    fallbackColor: 0x556B2F,
    flips: { x: false, y: false, z: false },
    wiggle: {
      enabled: false,
      mode: 'ud',
      moving: default_wiggle.moving,
      periodSec: default_wiggle.periodSec,
      amplitudeDeg: default_wiggle.amplitudeDeg,
      softness: default_wiggle.softness
    },
    size: 'medium', abundance: 'veryCommon', speed: 'slow', water: 'bottom', shore: 'mid'
  },
  {
    key: 'surubi_pintado',
    displayName: 'Surubí pintado (Pseudoplatystoma corruscans)',
    glb: '/game-assets/sub/fish/surubi_pintado.glb',
    fallbackColor: 0xC0C0C0,
    flips: { x: false, y: false, z: true },
    wiggle: {
      enabled: true,
      mode: default_wiggle.mode,
      moving: default_wiggle.moving,
      periodSec: default_wiggle.periodSec,
      amplitudeDeg: default_wiggle.amplitudeDeg,
      softness: default_wiggle.softness
    },
    size: 'large', abundance: 'scarce', speed: 'medium', water: 'midwater', shore: 'deep'
  },
  {
    key: 'raya_negra',
    displayName: 'Raya negra (Potamotrygon spp.)',
    glb: '/game-assets/sub/fish/raya_negra.glb',
    fallbackColor: 0x222222,
    flips: { x: false, y: true, z: false },
    wiggle: {
      enabled: false,
      mode: 'ud',
      moving: default_wiggle.moving,
      periodSec: default_wiggle.periodSec,
      amplitudeDeg: default_wiggle.amplitudeDeg,
      softness: default_wiggle.softness
    },
    size: 'medium', abundance: 'usual', speed: 'slow', water: 'bottom', shore: 'near'
  }
];

const SPECIES_FACTS = {
  raya_negra: [
    "Habita fondos arenosos o fangosos de ríos y arroyos.",
    "Tiene cuerpo plano y cola larga con aguijón venenoso.",
    "Se alimenta de crustáceos, moluscos y peces pequeños.",
    "Es ovovivípara (las crías se desarrollan dentro del cuerpo).",
    "Puede medir más de un metro de ancho.",
    "Suele camuflarse en el fondo para cazar.",
    "Su veneno no es mortal, pero causa dolor intenso.",
    "Respira moviendo el agua por aberturas situadas encima del cuerpo.",
    "Es activa principalmente durante la noche.",
    "En Entre Ríos se la encuentra en zonas profundas del Paraná."
  ],
  surubi_pintado: [
    "Es un gran bagre de piel moteada (Pseudoplatystoma corruscans).",
    "Puede superar los 50 kg de peso.",
    "Predador tope de ambientes fluviales.",
    "Se alimenta de peces más chicos y crustáceos.",
    "Realiza migraciones para reproducirse.",
    "Muy valorado en la pesca deportiva.",
    "También llamado “manguruyú pintado” en algunas regiones.",
    "Su piel carece de escamas.",
    "Requiere aguas limpias y con corriente para reproducirse.",
    "Su carne es firme y de alto valor gastronómico."
  ],
  vieja_del_agua: [
    "Posee cuerpo cubierto de placas óseas.",
    "Se adhiere a superficies con su boca en forma de ventosa.",
    "Come algas y restos orgánicos.",
    "Cumple un rol ecológico limpiando fondos y rocas.",
    "Prefiere aguas calmas y claras.",
    "Su nombre científico común es Hypostomus spp.",
    "Tolera aguas con bajo nivel de oxígeno.",
    "Tiene hábitos principalmente nocturnos.",
    "Puede fijarse a las piedras incluso con corriente fuerte.",
    "Es muy resistente y común en acuarios de agua dulce."
  ],
  palometa_brava: [
    "De cuerpo plateado y dientes muy filosos.",
    "Relacionada con las pirañas (Serrasalmus).",
    "Vive en cardúmenes.",
    "Se alimenta de peces, escamas y a veces frutas.",
    "Abunda en verano en aguas cálidas.",
    "Puede causar mordidas dolorosas.",
    "De crecimiento rápido y vida relativamente corta.",
    "Su agresividad aumenta con altas temperaturas.",
    "Cumple un rol ecológico controlando poblaciones de peces.",
    "Es frecuente verla en cardúmenes cerca de la superficie."
  ],
  armado_chancho: [
    "Bagre grande con placas óseas defensivas.",
    "Su cuerpo es robusto y su boca inferior, adaptada al fondo.",
    "Se alimenta de materia orgánica y pequeños invertebrados.",
    "Habita zonas profundas de ríos y lagunas.",
    "Su carne es muy apreciada.",
    "Puede emitir sonidos con su vejiga natatoria.",
    "También conocido como Pterodoras granulosus.",
    "Su cuerpo está cubierto de espinas protectoras.",
    "Es un nadador lento.",
    "Desempeña un papel importante reciclando materia orgánica."
  ],
  pacu: [
    "De cuerpo alto y dientes similares a los humanos.",
    "Omnívoro: come frutos, semillas y pequeños animales.",
    "Muy fuerte y buscado en pesca deportiva.",
    "Puede superar los 10 kg.",
    "Vive en aguas cálidas y tranquilas.",
    "Ayuda a dispersar semillas en los ríos.",
    "Pertenece a la familia de las pirañas, pero es pacífico.",
    "Puede adaptarse a estanques y represas.",
    "Se reproduce durante las crecientes del río.",
    "Su consumo es habitual en la gastronomía mesopotámica"
  ],
  sabalo: [
    "Especie más abundante del Paraná.",
    "Come algas, plancton y materia orgánica.",
    "Base alimentaria de muchos peces carnívoros.",
    "Realiza migraciones largas para desovar.",
    "Tiene gran importancia comercial.",
    "Filtra el alimento con sus branquias.",
    "Su nombre científico es Prochilodus lineatus.",
    "Es esencial para mantener el equilibrio ecológico del río.",
    "Sus migraciones masivas son conocidas como “subida del sábalo”.",
    "Sirve como indicador biológico de la salud del ecosistema."
  ],
  dorado: [
    "Depredador emblemático del Paraná (Salminus brasiliensis).",
    "De color dorado intenso y gran potencia.",
    "Puede alcanzar más de 20 kg.",
    "Vive en aguas con corriente.",
    "Se alimenta de peces, especialmente sábalos.",
    "Muy valorado en la pesca deportiva y conservación.",
    "Se lo considera el “tigre del río” por su ferocidad.",
    "Necesita aguas oxigenadas y correntosas.",
    "Su reproducción depende de los pulsos de inundación.",
    "Es una especie protegida: en muchos lugares se promueve su devolución al río."
  ]
};

/* -------------------------------------------------------------
 * Single source of truth: explicit world & behavior parameters
 * Place any tunables here; everything else reads from this block.
 * ------------------------------------------------------------- */
const DEFAULT_PARAMS = {
  /** Camera pose (initial) & world orientation */
  start: { x: 80.0, y: -6.542, z: 4.291, yawDeg: -90 },

  /** World hard limits (explicit, non-derived) */
  surfaceLevel: 5.722,   // y of the water surface plane
  floorLevel:  -15.05,   // y of riverbed (camera min Y and swimbox min Y)
  shoreLevel:  50.0,     // x of shoreline (swimbox min X)
  leftLimit:   -60.0,    // z min for both camera and swimbox
  rightLimit:   60.0,    // z max for both camera and swimbox

  /** Camera constraints aligned to world limits */
  cameraSurfaceMargin: 0.3,   // how much camera may go above surfaceLevel
  cameraFloorMargin:  4.0,    // how much camera must stay above floorLevel
  cameraLeftMargin:   55.0,    // how far from leftLimit (Z min) the camera is kept
  cameraRightMargin:  45.0,    // how far from rightLimit (Z max) the camera is kept
  cameraXBounds: [-300, 300], // x soft bounds; shoreLevel still acts as hard min

  /** Mouse-driven camera motion (x = shore↔deep, y = up↔down) */
  speeds: { x: 8.0, y: 10.0 },
  wheelStepX: 1.0,
  responseCurve: { x: 1.0, y: 1.35 },
  deadzone: 0.08,
  damping: 0.15,

  /** Wheel zoom dampening parameters */
  wheelZoom: {
    acceleration: 3.0,     // How quickly velocity builds up from wheel input
    maxVelocity: 15.0,     // Maximum zoom velocity
    damping: 0.92,         // Velocity decay per frame (0.9 = 10% decay)
    friction: 0.85,        // Additional friction when no wheel input
  },

  /** Visuals */
  skyColor: 0xF6B26B,
  waterColor: 0x1b1a16,
  waterSurfaceOpacity: 1.0,
  waterSurfaceThicknessMeters: 0.2,

    /** Vegetation (floor, surface, shore) */
  vegetation: {
    enabled: true,

    // Global defaults (used if a species doesn't override)
    defaults: {
      yawRandom: true,            // randomize Y rotation
      scaleJitter: [0.9, 1.15],   // uniform random scale per instance
      floorYOffset: 0,         // base lift above floorLevel (floor plants)
      surfaceDrift: {             // default drift for surface plants
        radius: 0.8,              // meters
        speed: 0.12               // cycles/sec (2π * speed = rad/sec)
      }
    },

    // Floor:
    floor: {
      // tronco:  { glb: '/game-assets/sub/vegetation/tronco.glb',  count: 12, yOffset: -4.0, fitLongest: 12.0 },
      // egeria:  { glb: '/game-assets/sub/vegetation/egeria.glb',  count: 100, yOffset: -4.0, fitHeight: 2.0 }
    },

    // Surface:
    surface: {
      irupe:    { glb: '/game-assets/sub/vegetation/irupe.glb',    count: 18, yOffset: 0.06, fitLongest: 1.1, drift: { radius: 1.1, speed: 0.04 } },
      camalote: { glb: '/game-assets/sub/vegetation/camalote.glb', count: 14, yOffset: 0.03, scale: 0.9,      drift: { radius: 1.6, speed: 0.04 } }
    },

    // Shore:
    shore: {
      // aliso:      { glb: '/game-assets/sub/vegetation/aliso.glb',      count: 5,  xOffsetMin: 10, xOffsetMax: 30,  yOffset: 12,  fitHeight: 2.6 },
      // ceibo:      { glb: '/game-assets/sub/vegetation/ceibo.glb',      count: 4,  xOffsetMin: 10, xOffsetMax: 30,  yOffset: 12,  scale: 1.1 },
      // cortadera:  { glb: '/game-assets/sub/vegetation/cortadera.glb',  count: 10, xOffsetMin: 10, xOffsetMax: 30,  yOffset: 12,  fitLongest: 1.8 },
      // espinillo:  { glb: '/game-assets/sub/vegetation/espinillo.glb',  count: 6,  xOffsetMin: 10, xOffsetMax: 30,  yOffset: 12,  scale: 1.0 },
      // paja:       { glb: '/game-assets/sub/vegetation/paja.glb',       count: 12, xOffsetMin: 10, xOffsetMax: 30,  yOffset: 12, scale: 1.2 },
      // sauce:      { glb: '/game-assets/sub/vegetation/sauce.glb',      count: 5,  xOffsetMin: 10, xOffsetMax: 30,  yOffset: 12,  fitHeight: 3.5 },
      // sauce_2:    { glb: '/game-assets/sub/vegetation/sauce_2.glb',    count: 5,  xOffsetMin: 10, xOffsetMax: 30,  yOffset: 12, scale: 0.95 }
    }

  },


  /** Fog (enabled when camera is UNDER the surfaceLevel) */
  fogNear: 1.0,   // distance where fog starts (no hidden derivation)
  fogFar:  50.0,  // distance where fog fully obscures

  /** Above-water fog */
  aboveFog: {
    enabled: true,
    color: 0xB7BEC6,       // soft gray/blue
    useExp2: false,        // true => FogExp2(density), false => Fog(near,far)
    near: 10.0,
    far: 150.0,
    density: 0.015,        // only used if useExp2=true
    surfaceHysteresis: 0.03 // reduce flicker at the surface (meters)
  },

  /** Lightweight “steam” / mist patches just above the water */
  mist: {
    enabled: false,
    color: 0xC9CED6,
    opacity: 0.55,         // 0..1
    height: 0.5,          // meters above surface
    count: 30,             // number of patches
    sizeRange: [8, 20],    // meters (min, max) per patch
    windDirDeg: 15,        // world wind heading (deg, 0 = +X)
    windSpeed: 0.01,       // meters/sec
    softness: 0.5,         // Soft particles depth blend width
    jitterAmp: 0.2,        // small local bobbing in meters
    underwaterOpacity: 0.0,
    fadeSec: 2,
    jitterFreqRange: [0.01, 0.03]  // Hz per patch (min,max)
  },

    /** Shoreline haze — a single vertical card at x=shoreLevel */
  shoreHaze: {
    enabled: true,
    /** PNG with baked alpha (the one I gave you): */
    src: '/game-assets/sub/interfaz/shore_haze_bottom1_quadratic_1024x2048.png',
    /** How tall above the water surface (meters) */
    height: 50.0,
    /** Extra Z padding beyond [leftLimit, rightLimit] to avoid edge pops */
    zPad: 2.0,
    /** Opacity multiplier on top of the PNG’s alpha (0..1) */
    opacity: 0.6,
    /** Use the same color as mist (material color tints the white PNG) */
    color: 0xC9CED6,

    /** Rendering & filtering */
    doubleSide: false,         // face water only; set true if you need both sides
    depthWrite: false,         // avoid stacking artifacts
    depthTest: true,
    anisotropy: 4,
    minFilter: 'LinearMipMapLinearFilter', // name strings resolved at build
    magFilter: 'LinearFilter'
  },


  /** Shore vegetation background — image card behind shoreHaze */
  shoreVegBackground: {
    enabled: true,
    src: '/game-assets/sub/vegetation/veg-background.png',
    /** World height in meters (width preserves image aspect) */
    height: 10.0,
    /** Offset (meters) relative to the haze bottom edge (surfaceLevel) */
    bottomOffset: 9.0,
    /** Distance (meters) between the shore haze plane and the first vegetation row (in X) */
    xOffsetFromHaze: 25.03,
    /** Distance (meters) between vegetation rows (in X) */
    rowSpacingX: 3.0,
    /** Vertical offset (meters) added cumulatively for each subsequent row */
    rowSpacingY: 3.0
  },

  /** Second layer of shore vegetation background */
  shoreVegBackground2: {
    enabled: true,
    src: '/game-assets/sub/vegetation/veg-background-2.png',
    /** World height in meters (width preserves image aspect) */
    height: 10.0,
    /** Offset (meters) relative to the haze bottom edge (surfaceLevel) */
    bottomOffset: 0.0,
    /** Distance (meters) between the shore haze plane and the first vegetation row (in X) */
    xOffsetFromHaze: 17.0,
    /** Distance (meters) between vegetation rows (in X) */
    rowSpacingX: 3.0,
    /** Vertical offset (meters) added cumulatively for each subsequent row */
    rowSpacingY: 3.0
  },


  /** Surface transition FX (video overlay while crossing the membrane) */
  surfaceFX: {
    enabled: true,
    src: '/game-assets/sub/others/surface.webm',
    crossfadeMs: 700,
    blendMode: 'plus-lighter',
    fallbackBlendMode: 'screen',
    filter: 'brightness(1.35) contrast(2.1) saturate(0.35)',
    playbackRate: 1.0
  },



  /** Base model scale and tiling (floor/walls GLB) */
  overrideScale: 129.36780721031408, // explicit scale; if null, scale to modelLongestTarget
  modelLongestTarget: 129.368,
  tiling: { countEachSide: 1, gap: -60.0, gapMultiplier: 0.5 },

  /** Fish baseline behavior (species modify around these) */
  fish: {
    renderDistance: 50.0,
    speedMin: 2.0,
    speedMax: 4.0,
    accel: 8.0,
    separationRadius: 2.0,
    separationStrength: 1.2,
    targetReachDist: 1.5,
    retargetTime: [4.0, 8.0], // [min, max] seconds
    fallbackDims: { x: 1.6, y: 0.4, z: 0.5 },
  },

  fishTracker: {
    strokeColor: '#ffffff',
    strokeWeightRatio: 0.01,
    hideAboveWater: true
  },

  fishPositionBias: {
    meansX: { near: 0.15,  mid: 0.50, deep: 0.85 },
    sigmaX: { near: 0.20,  mid: 0.20, deep: 0.20 }, // set >0 later (e.g., 0.10)
    meansY: { surface: 0.80, midwater: 0.50, bottom: 0.08 },
    sigmaY: { surface: 0.10, midwater: 0.20, bottom: 0.05 }, // set >0 later (e.g., 0.12)
  },

  debug: {
    tiles: true,       // floor/walls tiling
    water: true,       // water surface plane
    fog: true,         // underwater fog
    fish: true,        // spawn + render fish
    fishUpdate: true,  // per-frame fish simulation
    deck: true,        // create deck UI
    deckRender: true   // per-frame deck mini-canvas renders
  },

    /** Deck UI (column on the right) */
  deckUI: {
    // placement & sizing
    visibleCount: 5,            // how many cards visible at once
    // Margin priority: Px > Vh, keeping margin steady when width changes
    rightMarginVh: 0.035,
    topMarginVh:   0.06,   // 6% of viewport height
    bottomMarginVh:0.10,   // 10% of viewport height
    verticalOverlapPct: 0.10,   // 10% of a card covered by the next one
    centerOpacity: 1.0,
    edgeOpacity: 0.3,           // opacity at farthest visible cards
    opacityFalloffExp: 1.35,    // how fast opacity falls with distance
    scrollDamping: 0.25,        // 0..1, higher = snappier
    snapAfterWheelMs: 160,      // debounce before snapping to nearest

    // card background images
    assets: {
      base:  '/game-assets/sub/interfaz/deck-card.png',
      selected: '/game-assets/sub/interfaz/deck-card-selected.png',
      completed: '/game-assets/sub/interfaz/deck-card-completed.png',
      logo: '/game-assets/sub/interfaz/logo.png'
    },

    // --- NEW: absolute boxes in card space ---
    boxes: {
      // percentages of card width/height
      species: { xPct: 0.08, yPct: 0.02, wPct: 0.55, hPct: 0.22 },
      numbers: { xPct: 0.72, yPct: 0.02, wPct: 0.22, hPct: 0.22 },
      model:   { xPct: 0.04, yPct: 0.27, wPct: 0.95, hPct: 0.64 }
    },
    lineHeight: 1.02,   // used for 2-line height fit
    debugBoxes: false,

    // logo behavior
    logoOverlapStartPct: 0.7,  // logo starts overlapping the bottom-most card at 0% height
    logoWidthFactor: 0.95,       // logo width relative to card width

    // selected glow (CSS, for the canvas of the selected card)
    selectedGlowFilter: 'drop-shadow(0 0 8px #FFD400) drop-shadow(0 0 18px #FFD400) drop-shadow(0 0 28px #FFD400)',
    successGlowFilter: 'drop-shadow(0 0 8px #00FF6A) drop-shadow(0 0 18px #00FF6A) drop-shadow(0 0 28px #00FF6A)',
    errorGlowFilter:   'drop-shadow(0 0 8px #FF4D4D) drop-shadow(0 0 18px #FF4D4D) drop-shadow(0 0 28px #FF4D4D)',
    
    // Glow timings (ms)
    glowTransitionInMs: 400,
    glowHoldMs: 700,
    glowTransitionOutMs: 400,

    // logo placement: push it a bit LOWER than before so it overlaps less
    logoExtraPushVh: 0.00,     // extra downward push in vh AFTER overlap is computed

    // Adobe Fonts
    fontKitHref: 'https://use.typekit.net/vmy8ypx.css',
    fonts: {
      family: `"new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`,
      speciesMaxPx: 20,
      numbersMaxPx: 22
    },
    colors: {
      speciesText: '#FFC96A',        // filled
      numbersTotalFill: '#FFC96A',   // filled
      numbersFoundStroke: '#FFC96A', // stroke-only (completed -> filled)
      silhouetteDefault: '#2B6CB0',  // blue (non-selected)
      silhouetteSelected: '#FFD400'  // yellow (selected)
    }
  },

  /** Depth ruler overlay */
  rulerUI: {
    enabled: true,
    src: '/game-assets/sub/interfaz/ruler.png',

    leftMarginVw: 0.02,
    visiblePortionAtBottom: 0.5, // fraction of image that should fill viewport height at max depth
    topAnchorVh: 0.4,            // when camera highest, ruler top sits at 40% viewport height

    // z-order: should be behind deck (deck is ~9997)
    zIndex: 9995,
    opacity: 0.5
  },

  /* === ADD: timer UI and cursor UI params (after rulerUI) === */
  /** Timer overlay (bottom-right by right/bottom margins) */
  timerUI: {
    src: '/game-assets/sub/interfaz/timer.png',
    // Prefer Vh-based values so size/margin stay constant when width changes
    xMarginVh: 0.3,    // right margin as fraction of viewport HEIGHT (deck-style)
    yMarginVh: 0.055,   // bottom margin as fraction of viewport height
    widthVh:   0.3,     // timer width tied to container height for consistency
    zIndex:    9996,
    textColor: '#FFD400', // bright yellow (matches glow)
    // font: reuse deckUI font so we keep New Science Mono Bold everywhere
    fontFamily: `"new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`,
    textScale: 0.95
  },

  /** Cursor overlay */
  cursorUI: {
    src: '/game-assets/sub/interfaz/cursor.png',
    scale: 0.15,     // overall scale around the pointer
    zIndex: 100000,  // above everything
    enabled: true,

    // NEW: click animation sequence (filenames like: "D+pre CURSOR_click_00163.png", ...)
    anim: {
      dir: '/game-assets/sub/interfaz/cursor_animation',
      prefix: 'D+pre CURSOR_click_',
      pad: 5,              // zero-padding width in filenames (e.g., 00163)
      startIndex: 163,     // <-- ajustá si tu primera imagen NO es 00163
      maxFramesProbe: 1200 // tope de prueba por si hay huecos; param seguro
    }
  },

  /** Raycast configuration for fish detection */
  raycastUI: {
    // Make raycast area similar to cursor size for better detection
    // Uses cursor scale as reference (0.15) to determine detection area
    radiusScale: 0.15,  // Same as cursor scale for consistent feel
    maxDistance: 100,   // Maximum raycast distance
    // If true, uses fat raycast (multiple rays), else uses distance-based detection
    useFatRaycast: true
  },

  /** Radar overlay (plays on correct-catch) */
  radarUI: {
    enabled: true,
    zIndex: 100001,
    // scaling factor separate from cursor
    scale: 1,
    anim: {
      sheetSrc: resolvePublicAsset('game-assets/sub/interfaz/radar_animation/radar.webp'),
      columns: 7,
      rows: 7,
      frameCount: 46,
      fps: 30
    }
  },

  /** Completed-species celebration overlay */
  completedOverlay: {
    enabled: true,
    delayAfterSelectSec: 1.0,
    fps: 30,
    fontFamily: `"new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`,
    space: {
      heightVh: 1.0,          // space height follows viewport height 1:1
      marginLeftVh: 0.0,
      marginTopVh: 0.0,
      marginRightVh: 0.0,
      marginBottomVh: 0.0,
      designHeightPx: 1080,   // reference height for pixel-based styles
      designWidthPx: 1920,    // used to derive width/height ratio (defaults to 16:9)
      widthToHeight: null,    // optional override; defaults to designWidth/designHeight
      scaleMultiplier: 1.3    // enlarges/reduces everything uniformly (clamped to viewport)
    },

    speciesName: {
      dir: '/game-assets/sub/interfaz/completed-species-name',
      prefix: 'BASE especie nombre_',
      pad: 5,
      startIndex: 0,
      maxFramesProbe: 900,
      loopTailFrames: 30,
      position: { xPct: 0.1, yPct: 0.1 },
      widthPct: 0.2,
      textColor: '#E6C200',
      textShadow: '0 2px 10px rgba(0,0,0,0.75)',
      primaryStyle: {
        fontSizePx: 26,
        topPct: 0.27,
        heightPct: 0.24,
        textAlign: 'center',
        lineHeight: 1.0
      },
      secondaryStyle: {
        fontSizePx: 16,
        topPct: 0.5,
        heightPct: 0.18,
        textAlign: 'center',
        lineHeight: 1.0
      }
    },

    speciesImage: {
      dir: '/game-assets/sub/interfaz/completed-species-image',
      prefix: 'VNT pre_01_',
      pad: 5,
      startIndex: 0,
      maxFramesProbe: 900,
      loopTailFrames: 30,
      delayAfterNameSec: 0.5,
      offsetPct: { x: 0.08, y: 0.015 },
      widthPct: 0.26,
      imageBox: { xPct: 0.10, yPct: 0.12, wPct: 0.80, hPct: 0.76 },
      imageScale: 0.8,
      backgroundColor: 'rgba(0,0,0,0)',
      borderRadiusPx: 8
    },

    speciesInfo: {
      dir: '/game-assets/sub/interfaz/completed-species-info',
      prefix: 'BASE data especie_',
      pad: 5,
      startIndex: 0,
      maxFramesProbe: 900,
      loopTailFrames: 30,
      delayAfterNameSec: 0.8,
      offsetPct: { x: 0.28, y: 0.25 },
      widthPct: 0.2,
      textBox: { xPct: 0.17, yPct: 0.14, wPct: 0.70, hPct: 0.72 },
      textColor: '#E6C200',
      fontSizePx: 18,
      lineHeight: 1.35,
      scrollThumbColor: 'rgba(230, 194, 0, 0.7)',
      scrollTrackColor: 'rgba(0,0,0,0.35)'
    }
  },



  /** Audio */
  audio: {
    volumes: {
      surface: 0.7,         // volumen del loop “Salida a tomar aire…”
      underwater: 0.7,      // volumen del loop “Juego delta - Bajo el agua…”
      music: 0.0,           // volumen base del tema “Músicos Entrerios…”
      lanchas: 0.0,         // volumen base del loop “lanchas.mp3” (mismo comportamiento que música)
      sfxCatch: 0.9,        // volumen SFX “Pez agarrado.mp3”
      sfxWrong: 0.9,        // volumen SFX “Pez equivocado.mp3”
      sfxCompleted: 0.9     // volumen SFX “completed_species.mp3”
    },
    eq: {
      // Frecuencias objetivo (ajustables)
      aboveHz: 12000,       // al estar SOBRE la superficie (10–12 kHz)
      surfaceUnderHz: 450,  // justo DEBAJO de la superficie
      bottomHz: 20,         // en el fondo

      // Tiempos de rampa (segundos)
      rampEnterSec: 0.15,   // al ENTRAR al agua: rápido 10–12 kHz -> 300 Hz
      rampExitSec: 0.30,    // al SALIR del agua: rápido 300 Hz -> 10–12 kHz
      rampWhileSec: 0.10,   // mientras se mueve dentro del agua (interpolación frame a frame)

      // Curva de profundidad (‘exp’ o ‘lin’)
      depthCurve: 'exp'
    },
    musicDepth: {
      maxVolAbove: 0.4,     // volumen arriba de la superficie
      maxVolUnder: 0.4,     // volumen PICO justo al entrar al agua (luego baja con la profundidad)
      minVolBottom: 0.05    // volumen mínimo en el fondo
    },
    surfaceHysteresis: 0.03, // margen en metros para evitar “flapping” del cruce
    start: {
      // Cómo arranca el tema continuo ANTES de la intro (apenas se habilita el audio)
      forceOpenAboveHz: true,  // si true y estás sobre la superficie, abre a aboveHz instantáneamente
      forceAudibleVol: 0.5     // volumen mínimo inicial para oír la banda al habilitar audio
    },
    offsets: {
      surface: {
        onTransitionEnterSec: 0.9,  // abajo→arriba
        defaultStartSec: 2.5,       // inicio ya arriba / reinicio
        loopStartSec: 2.5
      },
      underwater: {
        onTransitionEnterSec: 0.0,  // arriba→abajo
        defaultStartSec: 2.5,       // inicio ya abajo / reinicio
        loopStartSec: 2.5
      }
    }
  },

  /** Intro sequence (camera & overlay text) */
  intro: {
    enabled: true,
    text: "Hay muchas especies en los ríos del Delta del Paraná...\n¿Podrás encontrarlas todas?",
    /** seconds */
    preHold: 3.0,         // wait before starting the downward move
    moveDuration: 6.0,     // time to go from highest Y to start.y
    postHold: 2.0,        // wait after arriving before intro ends
    fadeIn: 3.0,           // overlay text fade-in time
    fadeOut: 1.5           // overlay text fade-out time
  },
};

/* ========================================================================== */
/* Fish species & agent implementation (unchanged behavior, clearer mapping)  */
/* ========================================================================== */

class FishSpecies {
  constructor(def, scene, baseFishParams, positionBias) {
    this.def = def;
    this.scene = scene;
    this.base = baseFishParams;

    this.sizeScale  = SizeScale[def.size] || 1;
    this.speedScale = SpeedScale[def.speed] || 1;
    this.count      = AbundanceCount[def.abundance] || 10;

    this.biasXMean  = positionBias.meansX[def.shore];
    this.biasXSigma = positionBias.sigmaX[def.shore];
    this.biasYMean  = positionBias.meansY[def.water];
    this.biasYSigma = positionBias.sigmaY[def.water];

    this.template = null;
    this.usesFallback = false;

    this.wiggle = Object.assign({
      enabled: true,
      mode: 'lr',        // 'lr' (left/right, default) or 'ud' (up/down)
      moving: 'tail',     // NEW: 'tail' (default) or 'head'
      periodSec: 0.8,    // seconds
      amplitudeDeg: 16,  // degrees
      softness: 0.12     // blend width head↔tail (0..0.5)
    }, def.wiggle || {});
  }

  async ensureTemplate() {
    if (this.template) return this.template;
    try {
      const gltf = await AssetLoader.gltf(this.def.glb);
      // Keep a reference to animations for agent mixers
      this.animations = Array.isArray(gltf.animations) ? gltf.animations : [];
      const root = (gltf.scene || gltf.scenes?.[0]);
      if (root) {
        // IMPORTANT: do NOT auto-rig here — keep the template pristine for the deck.
        this.template = root;
        this.usesFallback = false;
        return this.template;
      }
    } catch (_) { /* fall through to fallback */ }

    // Fallback: colored prism (no animations)
    this.animations = [];
    const dims = this.base.fallbackDims;
    const geo = new THREE.BoxGeometry(dims.x, dims.y, dims.z);
    const mat = new THREE.MeshStandardMaterial({
      color: this.def.fallbackColor,
      metalness: 0.1,
      roughness: 0.6
    });
    this.template = new THREE.Mesh(geo, mat);
    this.usesFallback = true;
    return this.template;
  }



  /** Create a fully initialized agent for this species */
  async createAgent(swimBox) {
    await this.ensureTemplate();

    // Deep-clone the template to preserve skinning/rig
    const mesh = this.usesFallback
      ? this.template.clone(true)
      : SkeletonUtils.clone(this.template);

    // NEW: Share materials among all water agents of the same species to reduce draw calls.
    // We only clone them ONCE per species (the first time an agent is created).
    if (!this._sharedWaterMaterials) {
      makeMaterialsUnique(mesh);
      this._sharedWaterMaterials = new Map();
      mesh.traverse(o => {
        if (o.isMesh) this._sharedWaterMaterials.set(o.name || o.uuid, o.material);
      });
    } else {
      mesh.traverse(o => {
        if (o.isMesh) {
          const shared = this._sharedWaterMaterials.get(o.name || o.uuid);
          if (shared) o.material = shared;
        }
      });
    }

    // Ensure a unique name for raycasting + tag species key
    mesh.name = `fish_${this.def.key}_${Math.random().toString(36).substr(2, 9)}`;
    mesh.userData.speciesKey = this.def.key;

    // Scale by species size
    mesh.scale.multiplyScalar(this.sizeScale);

    // --- Auto-rig only this agent clone if the template had no skin and wiggle is enabled ---
    let hasSkinAlready = false;
    mesh.traverse(o => { if (o.isSkinnedMesh) hasSkinAlready = true; });

    if (!hasSkinAlready && this.wiggle.enabled) {
      // Find the biggest mesh on the CLONE
      let biggestMesh = null; let biggest = -1;
      mesh.traverse(o => {
        if (o.isMesh && o.geometry) {
          const tri = o.geometry.index ? o.geometry.index.count / 3
                                      : (o.geometry.attributes.position?.count || 0) / 3;
          if (tri > biggest) { biggest = tri; biggestMesh = o; }
        }
      });
      if (biggestMesh) {
        // Approximate forward from bbox (on the clone)
        const box = new THREE.Box3().setFromObject(biggestMesh);
        const size = new THREE.Vector3(); box.getSize(size);
        const axes = [
          { v: new THREE.Vector3(1,0,0), len: size.x },
          { v: new THREE.Vector3(0,1,0), len: size.y },
          { v: new THREE.Vector3(0,0,1), len: size.z },
        ].sort((a,b)=>b.len-a.len);
        const forwardLocal = axes[0].v.clone().normalize();

        const { skinned, bones } = autoRigTwoBoneFishMesh(biggestMesh, {
          forwardLocal,
          softness: this.wiggle.softness
        });
        if (skinned) {
          const parent = biggestMesh.parent;
          const idx = parent.children.indexOf(biggestMesh);
          if (idx >= 0) { parent.children[idx] = skinned; skinned.parent = parent; }
          else { parent.add(skinned); }
          biggestMesh.removeFromParent();
          skinned.userData._autoTailBone = bones.tail;
        }
      }
    }


    // Initial kinematics
    const pos = this.randBiasedPoint(swimBox);
    const speedMin = this.base.speedMin * this.speedScale;
    const speedMax = this.base.speedMax * this.speedScale;
    const vel = new THREE.Vector3()
      .randomDirection()
      .multiplyScalar(lerp(speedMin, speedMax, Math.random()));
    const target = this.randBiasedPoint(swimBox);
    const now = performance.now() * 0.001;
    const ret = this.base.retargetTime;
    const nextRetargetAt = now + lerp(ret[0], ret[1], Math.random());

    // Agent
    const agent = new FishAgent({
      mesh, pos, vel, target, nextRetargetAt,
      speedMin, speedMax, species: this
    });

    // --- Pick which end moves ('tail' default, or 'head'), directionally robust ---
    let firstSkinned = null;
    mesh.traverse(o => { if (!firstSkinned && o.isSkinnedMesh) firstSkinned = o; });

    let chosenBone = null;
    if (firstSkinned) {
      // Derive local forward (toward head) from bbox, then apply species flips
      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3(); box.getSize(size);
      const axes = [
        { v: new THREE.Vector3(1,0,0), len: size.x },
        { v: new THREE.Vector3(0,1,0), len: size.y },
        { v: new THREE.Vector3(0,0,1), len: size.z },
      ].sort((a,b)=>b.len-a.len);
      let forwardLocal = axes[0].v.clone().normalize();

      const { x: fx, y: fy, z: fz } = (this.def.flips || {x:false,y:false,z:false});
      if (fx) forwardLocal.x *= -1;
      if (fy) forwardLocal.y *= -1;
      if (fz) forwardLocal.z *= -1;

      // Choose which end we want to animate
      if ((this.wiggle.moving || 'tail') === 'head') {
        chosenBone = findHeadBoneDirectional(firstSkinned, { ownerMesh: mesh, forwardLocal });
      } else {
        chosenBone = findTailBoneDirectional(firstSkinned, { ownerMesh: mesh, forwardLocal });
      }

      // Fallback if directional fails
      if (!chosenBone) chosenBone = findTailBoneFromSkeleton(firstSkinned);
    }

    // Stash wiggle settings on the agent
    agent.wiggleBone  = chosenBone || null;   // <-- renamed from tailBone to generic wiggleBone
    agent.wiggle      = Object.assign({}, this.wiggle);
    agent.wigglePhase = Math.random() * Math.PI * 2;


    // Animation mixer (if the species has clips)
    agent.mixer = null;
    if (!this.usesFallback && this.animations && this.animations.length) {
      agent.mixer = new THREE.AnimationMixer(mesh);
      const clip = this.animations[0];
      const action = agent.mixer.clipAction(clip);
      action.play();
    }

    agent.applyOrientation();
    mesh.position.copy(pos);
    return agent;
  }


  /**
   * Generate a biased random point within the swimBox.
   * - X is biased between shoreLevel (minX) and cameraLevel (maxX)
   * - Y is biased between floorLevel (minY) and surfaceLevel (maxY)
   * - Z has uniform distribution across [minZ, maxZ]
   * Gaussian noise uses sigma fractions of the axis span (σ=0 => no spread).
   */
  randBiasedPoint(swimBox) {
    const min = swimBox.min, max = swimBox.max;

    // X (shore ↔ camera)
    const xSpan = max.x - min.x;
    const xMean = min.x + clamp(this.biasXMean, 0, 1) * xSpan;
    const xSigma = this.biasXSigma * xSpan;
    let x = xMean + (xSigma > 0 ? randn() * xSigma : 0);

    // Y (floor ↔ surface)
    const ySpan = max.y - min.y;
    const yMean = min.y + clamp(this.biasYMean, 0, 1) * ySpan;
    const ySigma = this.biasYSigma * ySpan;
    let y = yMean + (ySigma > 0 ? randn() * ySigma : 0);

    // Z uniform
    let z = lerp(min.z, max.z, Math.random());

    // Clamp to swimBox
    x = clamp(x, min.x, max.x);
    y = clamp(y, min.y, max.y);
    z = clamp(z, min.z, max.z);

    return new THREE.Vector3(x, y, z);
  }
}

class FishAgent {
  constructor({ mesh, pos, vel, target, nextRetargetAt, speedMin, speedMax, species }) {
    this.mesh = mesh;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.target = target.clone();
    this.nextRetargetAt = nextRetargetAt;
    this.speedMin = speedMin;
    this.speedMax = speedMax;
    this.species = species;

    this._localForward = null; // cached local-space forward axis
    this.tracked = false;
    this.tracker = null;

  }

  /** Detect the longest local axis of the mesh as "forward", honoring species flips. */
  _detectLocalForward() {
    if (this._localForward) return this._localForward.clone();

    const box = new THREE.Box3().setFromObject(this.mesh);
    const size = new THREE.Vector3(); box.getSize(size);
    const axes = [
      { v: new THREE.Vector3(1,0,0), len: size.x },
      { v: new THREE.Vector3(0,1,0), len: size.y },
      { v: new THREE.Vector3(0,0,1), len: size.z },
    ];
    axes.sort((a, b) => b.len - a.len);
    let f = axes[0].v.clone();

    // Apply declared flips
    const { x, y, z } = this.species.def.flips;
    if (x) f.x *= -1; if (y) f.y *= -1; if (z) f.z *= -1;

    this._localForward = f.normalize();
    return this._localForward.clone();
  }

    /** Orient to face velocity but with NO ROLL: left/right stays horizontal. */
  _quatNoRollTowardVelocity() {
    const v = this.vel.clone();
    if (v.lengthSq() < 1e-10) return this.mesh.quaternion.clone();
    v.normalize();

    // 1) Align local forward to velocity (might include roll)
    const localFwd = this._detectLocalForward();
    const qAlign = new THREE.Quaternion().setFromUnitVectors(localFwd, v);

    // 2) Build a *local-space* up that’s orthogonal to localFwd (robust even if Y≈fwd)
    const seed = Math.abs(localFwd.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const localRight = new THREE.Vector3().crossVectors(localFwd, seed).normalize();
    const localUp    = new THREE.Vector3().crossVectors(localRight, localFwd).normalize();

    // 3) Where does that up land in world after qAlign?
    const worldUpNow = localUp.clone().applyQuaternion(qAlign).normalize();
    const worldUp    = new THREE.Vector3(0, 1, 0);

    // 4) Twist around the forward axis so that up -> +worldUp (upright, no roll)
    // Signed angle between current-up and worldUp, around v (the forward dir)
    const dot = THREE.MathUtils.clamp(worldUpNow.dot(worldUp), -1, 1);
    let angle = Math.acos(dot);
    const cross = new THREE.Vector3().crossVectors(worldUpNow, worldUp);
    if (cross.dot(v) < 0) angle = -angle;

    const qFix = new THREE.Quaternion().setFromAxisAngle(v, angle);
    return qFix.multiply(qAlign);
  }


  applyOrientation() {
    if (this.vel.lengthSq() < 1e-10) return;
    this.mesh.quaternion.copy(this._quatNoRollTowardVelocity());
  }
}

/* ========================================================================== */
/* Deck UI for fish catching gameplay                                         */
/* ========================================================================== */
class Deck {
  constructor(speciesList, speciesObjs, deckParams = {}, callbacks = {}) {
    this.cfg = deckParams;
    this.callbacks = callbacks;
    this._ensureAdobeFontLink(this.cfg.fontKitHref);
    this.cardSeparation = 220; // not used now; kept for compatibility
    this.speciesList = speciesList;
    this.speciesObjs = speciesObjs;

    this.cards = [];
    this.currentIndex = 0;
    this.isAnimating = false;
    
    // Game state
    this.gameWon = false;

    // scrolling
    this.isPointerInside = false;
    this._scrollTarget = 0; // float "index" target
    this._scrollCurrent = 0;
    this._lastWheelTs = 0;
    this._snapTimer = null;

    // DOM
    this.container = document.createElement('div');
    this.container.id = 'deck-container';
    this.container.style.userSelect = 'none';
    this.container.style.webkitUserSelect = 'none';
    this.container.style.msUserSelect = 'none';
    document.body.appendChild(this.container);
    this.container.style.visibility = 'hidden';
    this._updateDeckCursor();

    // fixed logo holder
    this.logoEl = document.createElement('img');
    this.logoEl.id = 'deck-logo';
    this.logoEl.src = this.cfg.assets.logo;
    this.logoEl.style.visibility = 'hidden';
    this.logoEl.style.pointerEvents = 'auto';
    this.logoEl.style.cursor = 'pointer';
    this._logoPointerHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      triggerPauseMenuOverlay();
    };
    this.logoEl.addEventListener('pointerup', this._logoPointerHandler);
    document.body.appendChild(this.logoEl);

    // inject CSS once
    this._injectCSS();

    // silhouette materials (colors from params)
    const colDefault = new THREE.Color(this.cfg.colors.silhouetteDefault);
    const colSelected = new THREE.Color(this.cfg.colors.silhouetteSelected);
    this.silhouetteMaterial = new THREE.MeshBasicMaterial({ color: colDefault, transparent: true, opacity: 1.0 });
    this.silhouetteSkinned  = new THREE.MeshBasicMaterial({ color: colDefault, skinning: true, transparent: true, opacity: 1.0 });
    this.silhouetteMaterialSelected = new THREE.MeshBasicMaterial({ color: colSelected, transparent: true, opacity: 1.0 });
    this.silhouetteSkinnedSelected  = new THREE.MeshBasicMaterial({ color: colSelected, skinning: true, transparent: true, opacity: 1.0 });

    // preload base card image so we can compute aspect
    this._cardImg = new Image();
    this._cardImg.onload = () => this.updateLayout();
    this._cardImg.src = this.cfg.assets.base;

    // pointer capture
    this.container.addEventListener('mouseenter', () => {
      this.isPointerInside = true;
      this._updateDeckCursor();
    });
    this.container.addEventListener('mouseleave', () => {
      this.isPointerInside = false;
      this._updateDeckCursor();
    });

    window.addEventListener('resize', () => this.updateLayout(), { passive: true });
  }

  getProgressSnapshot() {
    const total = this.cards.reduce((acc, card) => acc + (Number(card.winCount) || 0), 0);
    const tagged = this.cards.reduce((acc, card) => acc + (Number(card.count) || 0), 0);
    const progress = total > 0 ? tagged / total : 0;
    return {
      tagged,
      total,
      progress,
      pct: Math.round(Math.max(0, Math.min(1, progress)) * 100)
    };
  }

  async build() {
    // Clear existing
    this.container.innerHTML = '';

    for (let i = 0; i < this.speciesList.length; i++) {
      const speciesDef = this.speciesList[i];
      const speciesObj = this.speciesObjs.find(s => s.def.key === speciesDef.key);

      // card root
      const cardEl = document.createElement('div');
      cardEl.className = 'deck-card-vert';
      cardEl.dataset.speciesKey = speciesDef.key;
      cardEl.style.userSelect = 'none';
      cardEl.style.webkitUserSelect = 'none';
      cardEl.style.msUserSelect = 'none';

      // three layered backgrounds for smooth state transitions
      const imgBase = document.createElement('img');
      imgBase.className = 'deck-bg deck-bg-base';
      imgBase.src = this.cfg.assets.base;

      const imgSelected = document.createElement('img');
      imgSelected.className = 'deck-bg deck-bg-selected';
      imgSelected.src = this.cfg.assets.selected;

      const imgCompleted = document.createElement('img');
      imgCompleted.className = 'deck-bg deck-bg-completed';
      imgCompleted.src = this.cfg.assets.completed;

      // canvas for 3D silhouette (WRAPPED to clip glow)
      const modelWrap = document.createElement('div');
      modelWrap.className = 'deck-model-wrap';

      const canvasEl = document.createElement('canvas');
      canvasEl.className = 'deck-canvas';

      modelWrap.appendChild(canvasEl);

      // text overlays
      const textWrap = document.createElement('div');
      textWrap.className = 'deck-text-wrap';
      textWrap.style.userSelect = 'none';
      textWrap.style.webkitUserSelect = 'none';
      textWrap.style.msUserSelect = 'none';

      const nameEl = document.createElement('div');
      nameEl.className = 'species-name';
      const rawName = speciesDef.displayName || '';
      const plain = rawName.split('(')[0].trim().toUpperCase();
      nameEl.textContent = plain;
      nameEl.style.userSelect = 'none';
      nameEl.style.webkitUserSelect = 'none';
      nameEl.style.msUserSelect = 'none';

      // NEW: single numbers element (two lines: found \n total)
      const numbersEl = document.createElement('div');
      numbersEl.className = 'numbers-mono';
      // Fill after we know totals
      const totalForThisSpecies = speciesObj.count ?? 0;
      numbersEl.textContent = `0\n${totalForThisSpecies}`;
      numbersEl.title = `Atrapa ${totalForThisSpecies} peces`;
      numbersEl.style.userSelect = 'none';
      numbersEl.style.webkitUserSelect = 'none';
      numbersEl.style.msUserSelect = 'none';

      textWrap.appendChild(nameEl);
      textWrap.appendChild(numbersEl);

      cardEl.appendChild(imgBase);
      cardEl.appendChild(imgSelected);
      cardEl.appendChild(imgCompleted);
      cardEl.appendChild(modelWrap);
      cardEl.appendChild(textWrap);
      this.container.appendChild(cardEl);

      // click to center
      cardEl.addEventListener('click', () => {
        this.currentIndex = i;
        this._scrollTarget = i;
        this._scrollCurrent = i; // jump, then animate opacity/z-order smoothly
        this._updateColumn(true);
      });

      // small WebGL scene per card
      const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, alpha: true, antialias: true, preserveDrawingBuffer: false });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(150, 100, false);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 100);
      camera.position.z = 3;

      const light = new THREE.AmbientLight(0xffffff, 2);
      scene.add(light);
      const dirLight = new THREE.DirectionalLight(0xffffff, 3);
      dirLight.position.set(2, 5, 3);
      scene.add(dirLight);

      await speciesObj.ensureTemplate();

      // Build TWO models: textured + silhouette. Share the same transform.
      const modelTex = SkeletonUtils.clone(speciesObj.template);
      const modelSil = SkeletonUtils.clone(speciesObj.template);

      makeMaterialsUnique(modelTex);
      // Fit & center using the textured model, then apply same to silhouette
      scene.add(modelTex);
      scene.updateMatrixWorld(true);

      let box = new THREE.Box3().setFromObject(modelTex);
      let size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const fitScale = 2.5 / maxDim;

      modelTex.scale.multiplyScalar(fitScale);
      box.setFromObject(modelTex);
      const center = box.getCenter(new THREE.Vector3());
      modelTex.position.sub(center);

      // Apply same transform to silhouette clone
      modelSil.scale.copy(modelTex.scale);
      modelSil.position.copy(modelTex.position);

      // Put silhouette into scene after transform
      scene.add(modelSil);

      // Save original materials from the TEXTURED model
      const originalMaterials = this.cloneMaterials(modelTex);

      // Apply silhouette materials on the silhouette model
      modelSil.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.isSkinnedMesh ? this.silhouetteSkinned : this.silhouetteMaterial;
        o.material.opacity = 1.0;
      });

      // Start undiscovered → show silhouette only
      modelTex.visible = false;
      modelSil.visible = true;

      const baseName = plain;

      // store card
      this.cards.push({
        key: speciesDef.key,
        element: cardEl,
        renderer,
        scene,
        camera,
        modelTex,
        modelSil,
        nameEl,
        numbersEl,
        modelWrap,
        baseName,
        fullDisplayName: speciesDef.displayName,
        revealed: false,
        completed: false,
        count: 0,
        totalCount: totalForThisSpecies,
        winCount: totalForThisSpecies,
        originalMaterials,
        bgBase: imgBase,
        bgSel: imgSelected,
        bgDone: imgCompleted
      });
    }

    // Initial selection
    this.currentIndex = Math.max(0, Math.min(this.cards.length - 1, this.cfg.startIndex ?? 0));
    this._scrollTarget = this.currentIndex;
    this._scrollCurrent = this.currentIndex;

    // Wait for fonts + base card image to be ready before showing anything
    await this._waitForAssets();

    // One more layout pass now that fonts/images are ready
    this.updateLayout();

    // Finally, reveal the UI; intro logic still controls opacity afterwards
    this.container.style.visibility = 'visible';
    this.logoEl.style.visibility = 'visible';

    // Notify initial progress (typically 0%)
    this.callbacks?.onProgress?.(this.getProgressSnapshot());
  }

  // === public API ===
  cycle(direction) {
    if (this.isAnimating) return;
    const n = this.cards.length;
    this.currentIndex = (this.currentIndex + direction + n) % n;
    this._scrollTo(this.currentIndex);
  }

  onWheel(deltaY) {
    const n = this.cards.length;
    const dir = Math.sign(deltaY);
    // continuous scrolling: add small increments toward direction
    this._scrollTarget = this._wrapIndexFloat(this._scrollTarget + 0.25 * dir, n);
    this._lastWheelTs = performance.now();
    if (this._snapTimer) clearTimeout(this._snapTimer);
    this._snapTimer = setTimeout(() => {
      // snap to nearest integer index
      const nearest = Math.round(this._scrollTarget);
      this.currentIndex = (nearest % n + n) % n;
      this._scrollTo(this.currentIndex, true);
    }, this.cfg.snapAfterWheelMs);
  }

  update(dt) {
    // animate fish in each card
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      if (c.modelSil) c.modelSil.rotation.y += 0.5 * dt;
      if (c.modelTex) c.modelTex.rotation.y += 0.5 * dt;
      c.renderer.render(c.scene, c.camera);
    }

    // smooth scroll toward target
    const n = this.cards.length;
    if (n > 0) {
      const diff = this._shortestDelta(this._scrollCurrent, this._scrollTarget, n);
      this._scrollCurrent = this._wrapIndexFloat(this._scrollCurrent + diff * this.cfg.scrollDamping, n);
      this._updateColumn(false);
    }
  }

  destroy() {
    if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
    if (this.logoEl && this.logoEl.parentNode) {
      if (this._logoPointerHandler) {
        this.logoEl.removeEventListener('pointerup', this._logoPointerHandler);
      }
      this.logoEl.parentNode.removeChild(this.logoEl);
    }
    this._logoPointerHandler = null;
  }

  // === interactions with gameplay ===
  setSilhouette(cardIndex) {
    // handled in build; kept for compatibility
  }

  setRevealed(cardIndex) {
    const card = this.cards[cardIndex];
    if (!card) return;

    if (!card.revealed) {
      card.revealed = true;
    }
  }

  checkMatch(speciesKey, opts = {}) {
    const { skipIncrement = false } = opts;
    const cur = this.cards[this.currentIndex];
    if (cur && cur.key === speciesKey) {
      if (!skipIncrement) {
        if (!cur.revealed) this.setRevealed(this.currentIndex);
        const newCount = Math.min(cur.totalCount, cur.count + 1);
        if (newCount !== cur.count) {
          cur.count = newCount;
          cur.numbersEl.textContent = `${cur.count}\n${cur.winCount}`;
          this.callbacks?.onProgress?.(this.getProgressSnapshot());
        }
        if (cur.count >= cur.winCount && !cur.completed) {
          cur.completed = true;
          cur.element.classList.add('completed');
          this.callbacks?.onSpeciesCompleted?.();
          this.checkGameWin();
          this.callbacks?.onProgress?.(this.getProgressSnapshot());
        }
      } else if (!cur.revealed) {
        this.setRevealed(this.currentIndex);
      }
      this._flashCanvasGlow(cur, 'success');
      return true;
    } else {
      const wrong = this.cards[this.currentIndex];
      this._flashCanvasGlow(wrong, 'error');
      return false;
    }
  }

  checkGameWin() {
    // Check if all species have reached their required total count
    const allCompleted = this.cards.every(card => card.completed);
    if (allCompleted && !this.gameWon) {
      this.gameWon = true;
      this.showWinMessage();
    }
  }

  showWinMessage() {
    console.log('🎉 Congratulations! You have won the game by finding half of each species!');
    // You can add more visual feedback here like a popup or overlay
    // For now, we'll just log to console
  }



  // === layout & visuals ===
  updateLayout() {
    // Compute card size from window and params
    const vw = Math.max(1, window.innerWidth || 1);
    const vh = Math.max(1, window.innerHeight || 1);

    const right = Number.isFinite(this.cfg.rightMarginPx)
      ? Math.max(0, this.cfg.rightMarginPx)
      : Math.max(0, Math.round((Number.isFinite(this.cfg.rightMarginVh) ? this.cfg.rightMarginVh : 0) * vh));

    const top    = Math.round((this.cfg.topMarginVh   ?? 0.06) * vh);
    const bottom = Math.round((this.cfg.bottomMarginVh?? 0.10) * vh);

    // available column height for cards (logo sits below, with overlap)
    const availH = Math.max(100, vh - top - bottom);

    // card aspect from image (fallback to 3:2)
    const aspect = (this._cardImg && this._cardImg.naturalWidth > 0)
      ? (this._cardImg.naturalWidth / this._cardImg.naturalHeight)
      : (3 / 2);

    // slot height considering vertical overlap
    const overlap = THREE.MathUtils.clamp(this.cfg.verticalOverlapPct, 0, 0.45);
    const slots = Math.max(1, this.cfg.visibleCount|0);
    const slotH = availH / (slots - overlap * (slots - 1));
    const cardH = slotH / (1 - overlap);
    const cardW = cardH * aspect;

    // position the column container (fixed on right)
    Object.assign(this.container.style, {
      position: 'fixed',
      top: `${top}px`,
      right: `${right}px`,
      width: `${cardW}px`,
      height: `${availH}px`,
      pointerEvents: 'auto',
      overflow: 'hidden',
      zIndex: 9997
    });
    this._updateDeckCursor();

    // logo sizing and position
    const logoW = cardW * (this.cfg.logoWidthFactor ?? 1);
    // keep natural aspect ratio; height will follow the image intrinsic ratio
    Object.assign(this.logoEl.style, {
      position: 'fixed',
      right: `${right}px`,
      width: `${logoW}px`,
      height: 'auto',
      zIndex: String(this.cfg.logoZIndex ?? 10000),
    });

    // compute vertical position:
    // place the logo just below the column, then pull it up by a fraction of the logo height (overlap),
    // then push it further DOWN by an extra vh to reduce overlap overall.
    const logoRect = this.logoEl.getBoundingClientRect(); // may be 0 on first call
    const tmpLogoH = logoRect.height || (cardH * 0.6); // fallback guess before first paint
    const overlapY = Math.round((this.cfg.logoOverlapStartPct ?? 0.18) * tmpLogoH);
    const extraPush = Math.round((this.cfg.logoExtraPushVh ?? 0.05) * vh);

    const logoTop = top + availH - overlapY + extraPush;
    this.logoEl.style.top = `${logoTop}px`;


    // set each card's absolute size (position handled in _updateColumn)
    for (const c of this.cards) {
      Object.assign(c.element.style, {
        position: 'absolute',
        width: `${cardW}px`,
        height: `${cardH}px`,
        left: '0px' // anchored to container left
      });
      
      // --- NEW ABSOLUTE-BOX LAYOUT --- //
      const speciesBox = this.cfg.boxes.species;
      const numbersBox = this.cfg.boxes.numbers;
      const modelBox   = this.cfg.boxes.model;
      const lhMul      = this.cfg.lineHeight ?? 1.05;

      // Convert % boxes to pixels
      const sX = Math.round(speciesBox.xPct * cardW);
      const sY = Math.round(speciesBox.yPct * cardH);
      const sW = Math.round(speciesBox.wPct * cardW);
      const sH = Math.round(speciesBox.hPct * cardH);

      const nX = Math.round(numbersBox.xPct * cardW);
      const nY = Math.round(numbersBox.yPct * cardH);
      const nW = Math.round(numbersBox.wPct * cardW);
      const nH = Math.round(numbersBox.hPct * cardH);

      const mX = Math.round(modelBox.xPct * cardW);
      const mY = Math.round(modelBox.yPct * cardH);
      const mW = Math.round(modelBox.wPct * cardW);
      const mH = Math.round(modelBox.hPct * cardH);

      // --- NUDGE ÓPTICO (compensación de métrica del font) ---
      // pequeño corrimiento hacia la derecha/abajo para centrar "a ojo"
      const OPTICAL_NUDGE = { dxPct: 5, dyPct: 3 }; // % del ancho/alto de cada caja


      // --- DEBUG BOXES (optional) ---
      if (this.cfg.debugBoxes) {
        if (!c._dbg) c._dbg = {};
        const ensure = (k, color) => {
          if (!c._dbg[k]) {
            const d = document.createElement('div');
            d.className = 'deck-debug-box';
            d.style.position = 'absolute';
            d.style.border = `2px dashed ${color}`;
            d.style.pointerEvents = 'none';
            d.style.zIndex = 9999;
            c.element.appendChild(d);
            c._dbg[k] = d;
          }
          return c._dbg[k];
        };
        const ds = ensure('species', '#00FF99');
        const dn = ensure('numbers', '#FFD400');
        const dm = ensure('model',   '#4DA3FF');

        Object.assign(ds.style, { left: `${sX}px`, top: `${sY}px`, width: `${sW}px`, height: `${sH}px` });
        Object.assign(dn.style, { left: `${nX}px`, top: `${nY}px`, width: `${nW}px`, height: `${nH}px` });
        Object.assign(dm.style, { left: `${mX}px`, top: `${mY}px`, width: `${mW}px`, height: `${mH}px` });
      } else if (c._dbg) {
        // remove overlays if they exist and debug switched off
        for (const k of Object.keys(c._dbg)) {
          const el = c._dbg[k];
          if (el && el.parentNode) el.parentNode.removeChild(el);
        }
        c._dbg = null;
      }

      // Position species name box
      Object.assign(c.nameEl.style, {
        position: 'absolute',
        left: `${sX}px`,
        top: `${sY}px`,
        width: `${sW}px`,
        height: `${sH}px`,
        display: 'grid',           // grid en vez de flex
        placeItems: 'center',      // centra vertical y horizontalmente
        textAlign: 'center',
        fontFamily: this.cfg.fonts.family,
        color: this.cfg.colors.speciesText,
        fontWeight: '700',
        lineHeight: `${lhMul}`,
        whiteSpace: 'pre',         // respetar \n; no wrap automático
        wordBreak: 'normal',       // no cortar palabras
        overflow: 'hidden',
        margin: '0',
        padding: '0',
        textIndent: '0',
        letterSpacing: '0'
      });

      // Compensación óptica: leve corrimiento derecha/abajo
      const sDx = (OPTICAL_NUDGE.dxPct / 100) * sW;
      const sDy = (OPTICAL_NUDGE.dyPct / 100) * sH;
      c.nameEl.style.transform = `translate(${sDx}px, ${sDy}px)`;

      // Compute species font-size from height (2 lines fill the box height)
      const speciesPx = Math.max(8, Math.floor((sH) / (2 * lhMul)));

      // Decide if we need 2 lines or 1
      const rawName = (c.baseName || '').replace(/\s+/g, ' ').trim();
      const oneLineFits = this._textWidthFits(c.nameEl, rawName, sW, speciesPx);
      let finalSpeciesText = rawName;
      if (!oneLineFits) {
        finalSpeciesText = this._splitIntoTwoBalancedLines(rawName); // garantiza solo 1 '\n'
      }
      // Apply text & font
      c.nameEl.style.fontSize = `${speciesPx}px`;
      c.nameEl.textContent = finalSpeciesText.replace(/[ \t]+\n/g, '\n').replace(/[ \t]+$/g, '');

      // Position numbers box
      Object.assign(c.numbersEl.style, {
        position: 'absolute',
        left: `${nX}px`,
        top: `${nY}px`,
        width: `${nW}px`,
        height: `${nH}px`,
        display: 'grid',          // grid centrado
        placeItems: 'center',
        textAlign: 'center',
        fontFamily: this.cfg.fonts.family,
        color: this.cfg.colors.numbersTotalFill,
        fontWeight: '800',
        lineHeight: `${lhMul}`,
        whiteSpace: 'pre',        // 2 líneas con \n
        wordBreak: 'normal',
        overflow: 'hidden',
        margin: '0',
        padding: '0',
        textIndent: '0',
        letterSpacing: '0'
      });

      // Cifras tabulares y lining para que todos los dígitos ocupen lo mismo
      c.numbersEl.style.fontVariantNumeric = 'tabular-nums lining-nums';
      c.numbersEl.style.fontFeatureSettings = '"tnum" 1, "lnum" 1';

      // Compensación óptica: leve corrimiento derecha/abajo
      const nDx = (OPTICAL_NUDGE.dxPct / 100) * nW;
      const nDy = (OPTICAL_NUDGE.dyPct / 100) * nH;
      c.numbersEl.style.transform = `translate(${nDx}px, ${nDy}px)`;


      // Numbers font from height (2 lines)
      const numbersPx = Math.max(8, Math.floor((nH) / (2 * lhMul)));
      c.numbersEl.style.fontSize = `${numbersPx}px`;

      // Saneamos para evitar espacios residuales
      c.numbersEl.textContent = String(c.numbersEl.textContent || '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]+$/g, '');

      // Position model WRAP box (clips glow)
      Object.assign(c.modelWrap.style, {
        position: 'absolute',
        left: `${mX}px`,
        top: `${mY}px`,
        width: `${mW}px`,
        height: `${mH}px`,
        overflow: 'hidden',   // key to clip glow
        pointerEvents: 'none'
      });

      // Make canvas fill the wrap; renderer matches box size
      const canvasEl = c.modelWrap.querySelector('canvas.deck-canvas');
      Object.assign(canvasEl.style, {
        position: 'absolute',
        left: `0px`,
        top: `0px`,
        width: `100%`,
        height: `100%`
      });

      c.renderer.setSize(Math.max(1, mW), Math.max(1, mH), false);
      c.camera.aspect = mW / Math.max(1, mH);
      c.camera.updateProjectionMatrix();


    }



    // after any size change, recompute positions/opacities
    this._updateColumn(true);
  }

  // === helpers ===
  cloneMaterials(model) {
    const map = new Map();
    model.traverse(o => {
      if (!o.isMesh) return;
      if (Array.isArray(o.material)) {
        map.set(o, o.material.map(m => m.clone()));
      } else if (o.material) {
        map.set(o, o.material.clone());
      }
    });
    return map;
  }

  _wrapIndexFloat(v, n) {
    // Wrap float index into [0, n)
    return ((v % n) + n) % n;
    }
  _shortestDelta(a, b, n) {
    // minimal signed distance in circular index space
    let d = b - a;
    if (d >  n/2) d -= n;
    if (d < -n/2) d += n;
    return d;
  }

  _scrollTo(indexInt, snapNow=false) {
    const n = this.cards.length;
    this._scrollTarget = (indexInt % n + n) % n;
    if (snapNow) this._scrollCurrent = this._scrollTarget;
    this._updateColumn(true);
  }

  _opacityForOffset(off, maxVisibleHalf) {
    // off = 0 at center; |off| increases upward/downward
    const t = Math.min(1, Math.abs(off) / maxVisibleHalf);
    const { centerOpacity, edgeOpacity, opacityFalloffExp } = this.cfg;
    const k = Math.pow(t, opacityFalloffExp);
    return centerOpacity * (1 - k) + edgeOpacity * k;
  }

  _updateColumn(force=false) {
    if (!this.cards || this.cards.length === 0) return;

    const rect = this.container.getBoundingClientRect();
    const cardH = parseFloat(this.cards[0].element.style.height) || 200;
    const overlap = this.cfg.verticalOverlapPct;
    const step = cardH * (1 - overlap);

    const n = this.cards.length;
    const centerIndex = this._scrollCurrent; // float
    const centerWrapped = this._wrapIndexFloat(centerIndex, n);
    let selectedIndex = Math.round(centerWrapped);
    if (n > 0) {
      selectedIndex = ((selectedIndex % n) + n) % n;
    }
    const half = Math.floor((this.cfg.visibleCount - 1) / 2);

    for (let i = 0; i < n; i++) {
      const offRaw = this._shortestDelta(centerIndex, i, n); // signed float offset
      // clamp visual range to avoid extreme translations (still render all for infinite loop feel)
      const visOff = offRaw;

      const y = rect.height/2 - cardH/2 + visOff * step;

      const opacity = this._opacityForOffset(visOff, Math.max(1, half));
      const zIndex = 1000 - Math.abs(Math.round(visOff)) * 10 + (visOff === 0 ? 10 : 0);

      const card = this.cards[i];
      card.element.style.transform = `translate3d(0, ${y}px, 0)`;
      card.element.style.opacity = `${opacity}`;
      card.element.style.zIndex = `${zIndex}`;

  const isSelected = (selectedIndex === i);
      card.element.classList.toggle('selected', !!isSelected);

      // Selected canvas glow
      const canv = card.element.querySelector('canvas.deck-canvas');
      if (canv) {
        const tmp = card._tmpGlowFilter;
        const base = this._baseCanvasFilter(card, isSelected);
        canv.style.filter = tmp != null ? tmp : base;

        // Aseguramos que el canvas tenga transición de filter por defecto
        if (!canv.style.transition) {
          const tIn = Math.max(0, this.cfg.glowTransitionInMs ?? 180);
          canv.style.transition = `filter ${tIn}ms ease`;
        }
      }

      // Discovery state: show textured once we’ve found ≥1 or revealed
      const discovered = card.revealed || card.count > 0;

      // Toggle visibility
      if (card.modelTex && card.modelSil) {
        card.modelTex.visible = discovered;
        card.modelSil.visible = !discovered;

        // Opacity: apply to whichever is visible
        const applyOpacity = (root) => {
          root.traverse(o => {
            if (!o.isMesh) return;
            if (o.material && 'opacity' in o.material) {
              o.material.transparent = true;
              o.material.opacity = opacity;
            }
          });
        };
        if (discovered) applyOpacity(card.modelTex);
        else applyOpacity(card.modelSil);

        // When silhouette is visible, recolor selected/non-selected
        if (!discovered) {
          card.modelSil.traverse(o => {
            if (!o.isMesh) return;
            const useSel = isSelected;
            const mat = (o.isSkinnedMesh
              ? (useSel ? this.silhouetteSkinnedSelected : this.silhouetteSkinned)
              : (useSel ? this.silhouetteMaterialSelected : this.silhouetteMaterial));
            o.material = mat;
            o.material.opacity = opacity;
          });
        }
      }


      // background state fading
  card.bgSel.style.opacity = (selectedIndex === i) ? '1' : '0';
      card.bgDone.style.opacity = card.completed ? '1' : '0';
    }
  }

  _flash(el, color) {
    if (!el) return;
    el.classList.add(`flash-${color}`);
    setTimeout(() => el.classList.remove(`flash-${color}`), 700);
  }

  _flashCanvasGlow(card, kind) {
    if (!card) return;
    const canv = card.element.querySelector('canvas.deck-canvas');
    if (!canv) return;

    const ok = String(kind).toLowerCase() === 'green' || kind === 'success';
    const target = ok
      ? (this.cfg.successGlowFilter || 'drop-shadow(0 0 8px #00FF6A) drop-shadow(0 0 18px #00FF6A) drop-shadow(0 0 28px #00FF6A)')
      : (this.cfg.errorGlowFilter   || 'drop-shadow(0 0 8px #FF4D4D) drop-shadow(0 0 18px #FF4D4D) drop-shadow(0 0 28px #FF4D4D)');

    const tIn  = Math.max(0, this.cfg.glowTransitionInMs  ?? 180);
    const hold = Math.max(0, this.cfg.glowHoldMs          ?? 650);
    const tOut = Math.max(0, this.cfg.glowTransitionOutMs ?? 220);

    // Estado base (amarillo si seleccionado, sino none)
    const isSelected = card.element.classList.contains('selected');
    const base = this._baseCanvasFilter(card, isSelected);

    // Cancelar animaciones previas
    clearTimeout(card._tmpGlowTimerIn);
    clearTimeout(card._tmpGlowTimerHold);
    clearTimeout(card._tmpGlowTimerOut);
    card._tmpGlowFilter = null; // dejemos que este valor sea el "modo temporal" activo

    // 1) Transition IN: del base -> target
    canv.style.transition = `filter ${tIn}ms ease`;
    // Forzamos base antes de cambiar para asegurar la transición
    canv.style.filter = base;
    // siguiente frame para que el navegador registre el estado inicial
    requestAnimationFrame(() => {
      card._tmpGlowFilter = target;
      canv.style.filter = target;
    });

    // 2) HOLD: mantener el target un tiempo
    card._tmpGlowTimerHold = setTimeout(() => {
      // 3) Transition OUT: del target -> base
      canv.style.transition = `filter ${tOut}ms ease`;
      card._tmpGlowFilter = null; // volvemos al base (decidido por _updateColumn)
      // Relee si sigue seleccionado (pudo cambiar)
      const isSelNow = card.element.classList.contains('selected');
      const baseNow = this._baseCanvasFilter(card, isSelNow);
      canv.style.filter = baseNow;
    }, tIn + hold);
  }



  _ensureAdobeFontLink(href) {
    if (!href) return;
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }


  _updateDeckCursor() {
    if (!this.container) return;
    this.container.style.cursor = this.isPointerInside ? 'auto' : 'none';
  }


  _injectCSS() {
    // If an external deck stylesheet exists, prefer that (avoids duplication)
    if (document.getElementById('__deck_css')) return;
    if (document.querySelector('link[href$="deck-style.css"], link[href*="deck-style.css"]')) return;

    // Fallback: inject minimal runtime CSS if external file isn't present
    const css = document.createElement('style');
    css.id = '__deck_css';
    css.textContent = `
      #deck-container {
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
        -ms-user-select: none;
      }
      .deck-card-vert {
        opacity: 1;
        will-change: transform, opacity;
        transition: opacity 200ms ease, transform 280ms cubic-bezier(.22,.61,.36,1), filter 200ms ease;
        user-select: none;
        -webkit-user-select: none;
        -ms-user-select: none;
      }
      .deck-card-vert .deck-bg { position: absolute; left:0; top:0; width:100%; height:100%; object-fit: cover; pointer-events: none; }
      .deck-card-vert .deck-bg-selected, .deck-card-vert .deck-bg-completed { opacity: 0; transition: opacity 220ms ease; }
      .deck-card-vert.completed .deck-bg-completed { opacity: 1 !important; }
      .deck-canvas { pointer-events: none; }
      .deck-text-wrap { pointer-events: none; }
      .deck-card-vert.selected .deck-canvas { will-change: filter; }
    `;
    document.head.appendChild(css);
  }

  async _waitForAssets() {
    const fontReady = (document.fonts && document.fonts.ready) ? document.fonts.ready.catch(()=>{}) : Promise.resolve();
    // Base card image decode (more reliable than onload once already set)
    const baseReady = (this._cardImg && this._cardImg.decode)
      ? this._cardImg.decode().catch(()=>{})
      : new Promise((res) => { if (this._cardImg?.complete) res(); else this._cardImg.onload = () => res(); });
    await Promise.all([fontReady, baseReady]);
  }


  _baseCanvasFilter(card, isSelected) {
    return isSelected ? (this.cfg.selectedGlowFilter || '') : 'none';
  }

  _textWidthFits(el, text, maxW, fontPx) {
    // Temporarily set measurement styles
    const prev = {
      fs: el.style.fontSize,
      ws: el.style.whiteSpace,
      wb: el.style.wordBreak,
      ow: el.style.overflow,
      ta: el.style.textAlign,
      ff: el.style.fontFamily,
      fw: el.style.fontWeight,
      lh: el.style.lineHeight
    };

    el.style.fontSize = `${fontPx}px`;
    el.style.whiteSpace = 'pre';     // single line (respect \n only)
    el.style.wordBreak = 'normal';
    el.style.overflow = 'visible';
    el.style.textAlign = 'left';     // avoid centering affecting scroll widths

    const prevContent = el.textContent;
    el.textContent = String(text).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

    // Force layout read
    const width = el.scrollWidth;

    // Restore
    el.textContent = prevContent;
    el.style.fontSize = prev.fs;
    el.style.whiteSpace = prev.ws;
    el.style.wordBreak = prev.wb;
    el.style.overflow = prev.ow;
    el.style.textAlign = prev.ta;
    el.style.fontFamily = prev.ff;
    el.style.fontWeight = prev.fw;
    el.style.lineHeight = prev.lh;

    return width <= maxW;
  }

  _splitIntoTwoBalancedLines(name) {
    // Normalizá espacios y quitá cualquier \n previo
    const clean = String(name).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = clean.split(' ').filter(Boolean);
    if (parts.length <= 1) return clean; // sin espacio para partir → 1 línea

    // Elegí el split que mejor balancea caracteres entre 2 líneas
    let best = { diff: Infinity, left: clean, right: '' };
    for (let i = 1; i < parts.length; i++) {
      const left = parts.slice(0, i).join(' ');
      const right = parts.slice(i).join(' ');
      const diff = Math.abs(left.length - right.length);
      if (diff < best.diff) best = { diff, left, right };
    }
    return `${best.left}\n${best.right}`; // SIEMPRE un único '\n'
  }



}


/* ========================================================================== */
/* Completed species celebration overlay                                      */
/* ========================================================================== */

class CompletedOverlay {
  constructor(params, { preloadSequence, fontFallback }) {
    this.params = params || {};
    this.preloadSequence = preloadSequence;
    this.fontFamily = params.fontFamily || fontFallback;

    this.root = null;
    this.spaceEl = null;
    this.components = {
      name: this._makeComponentConfig('speciesName'),
      image: this._makeComponentConfig('speciesImage'),
      info: this._makeComponentConfig('speciesInfo')
    };

    this._initialized = false;
    this._loadingPromise = null;
    this._sequencesPromise = null;
    this._activeKey = null;
    this._startTimes = { name: 0, image: 0, info: 0 };
    this._frameDuration = (params.fps && params.fps > 0) ? (1 / params.fps) : (1 / 30);

    this._imageLoadToken = 0;

    this._speciesCache = new Map(); // key -> { imageSrc, infoText, displayName }

    this._onResize = () => this.updateLayout();
    this._spaceMetrics = { width: 0, height: 0, left: 0, top: 0, scale: 1 };

    this.audio = new Audio();
    this.audio.volume = 1.0;
  }

  prepare() {
    return this._ensureInitialized();
  }

  _makeComponentConfig(key) {
    const cfg = (this.params && this.params[key]) ? Object.assign({}, this.params[key]) : {};
    return {
      key,
      cfg,
      sequence: null, // { kind: 'sheet'|'frames', ... }
      frames: [],
      aspect: 1,
      wrap: null,
      bgClipEl: null,
      imgEl: null,
      contentEl: null,
      lastFrameIndex: -1,
      frameIndex: 0,
      frameTime: 0,
      state: 'hidden', // hidden | pending | playing
      startDelay: 0
    };
  }

  async _ensureInitialized() {
    if (this._initialized) return;
    if (this._loadingPromise) {
      await this._loadingPromise;
      return;
    }

    this._loadingPromise = this._init();
    await this._loadingPromise;
    this._initialized = true;
    this._loadingPromise = null;
  }

  async _init() {
    this._createDom();
    this.updateLayout();
    window.addEventListener('resize', this._onResize, { passive: true });

    // Load background sequences asynchronously so overlay activation never blocks.
    this._sequencesPromise = this._loadSequences()
      .then(() => {
        // Recompute layout once we know aspect ratios
        this.updateLayout();
        // If overlay is already active, ensure first frames are applied immediately.
        Object.values(this.components).forEach((comp) => {
          if (comp.state === 'playing') {
            this._setComponentFrame(comp, this._loopFrameIndex(comp));
          }
        });
      })
      .catch((err) => console.error('[completedOverlay] sequence preload failed', err));
  }

  async _loadSequences() {
    const loadComponent = async (comp) => {
      const cfg = comp.cfg || {};
      if (!cfg.dir) return;

      const seq = await this.preloadSequence(cfg.dir, cfg.prefix, cfg.pad, cfg.startIndex, cfg.maxFramesProbe);

      // Back-compat: allow preloadSequence to return Image[]
      const normalized = Array.isArray(seq)
        ? { kind: 'frames', frames: seq }
        : seq;

      comp.sequence = normalized || null;

      if (normalized?.kind === 'frames') {
        comp.frames = normalized.frames || [];
        const first = comp.frames[0];
        comp.aspect = (first?.naturalWidth && first?.naturalHeight)
          ? (first.naturalWidth / first.naturalHeight)
          : 1;
      } else if (normalized?.kind === 'sheet') {
        comp.frames = []; // not used for sheet playback
        const meta = normalized.meta || {};
        const o = meta.original_frame_size;
        const frame0 = normalized.frames?.[0]?.frame;
        const w = (o?.w ?? frame0?.w ?? 1);
        const h = (o?.h ?? frame0?.h ?? 1);
        comp.aspect = (w > 0 && h > 0) ? (w / h) : 1;

        // Ensure the sheet src is set once.
        if (comp.imgEl && normalized.sheetSrc) {
          comp.imgEl.src = normalized.sheetSrc;
        }
      } else {
        comp.frames = [];
        comp.aspect = 1;
      }

      if (comp.key === 'speciesImage') {
        comp.startDelay = cfg.delayAfterNameSec ?? 0.5;
      } else if (comp.key === 'speciesInfo') {
        comp.startDelay = cfg.delayAfterNameSec ?? 0.8;
      } else {
        comp.startDelay = 0;
      }
    };

    await Promise.all([
      loadComponent(this.components.name),
      loadComponent(this.components.image),
      loadComponent(this.components.info)
    ]);
  }

  async waitForSequences() {
    if (this._sequencesPromise) {
      await this._sequencesPromise;
    }
  }

  _createDom() {
    if (this.root) return;

    if (!document.getElementById('__completed_overlay_css')) {
      const style = document.createElement('style');
      style.id = '__completed_overlay_css';
      style.textContent = `
        #completed-overlay-root {
          position: fixed;
          inset: 0;
          pointer-events: auto;
          z-index: 9999;
          visibility: hidden;
          user-select: none;
          -webkit-user-select: none;
          -ms-user-select: none;
        }
        .completed-overlay-wrap {
          position: absolute;
          pointer-events: auto;
          opacity: 0;
          visibility: hidden;
          transition: opacity 200ms ease;
          user-select: none;
          -webkit-user-select: none;
          -ms-user-select: none;
        }
        .completed-overlay-bg-clip {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
        .completed-overlay-space {
          position: fixed;
          transform-origin: top left;
        }
        .completed-overlay-wrap.active {
          opacity: 1;
          visibility: visible;
        }
        .completed-overlay-bg,
        .completed-overlay-content {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          user-select: none;
          -webkit-user-select: none;
          -ms-user-select: none;
        }
        .completed-overlay-text {
          color: #E6C200;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          white-space: normal;
          gap: 4px;
        }
        .completed-overlay-info-scroll {
          overflow-y: auto;
          padding-right: 8px;
        }
        #completed-overlay-root::-webkit-scrollbar,
        .completed-overlay-info-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .completed-overlay-info-scroll::-webkit-scrollbar-thumb {
          border-radius: 8px;
        }
        .completed-overlay-info-scroll::-webkit-scrollbar-track {
          border-radius: 8px;
        }
        .completed-name-primary {
          font-weight: 700;
          letter-spacing: 0.04em;
        }
        .completed-name-secondary {
          font-weight: 500;
          opacity: 0.85;
        }
      `;
      document.head.appendChild(style);
    }

    const root = document.createElement('div');
    root.id = 'completed-overlay-root';
    root.addEventListener('click', () => this.hide());
    document.body.appendChild(root);
    this.root = root;

    const space = document.createElement('div');
    space.className = 'completed-overlay-space';
    root.appendChild(space);
    this.spaceEl = space;

    // Species Name component
    const nameComp = this.components.name;
    nameComp.wrap = this._makeWrapDiv('species-name');
    nameComp.wrap.addEventListener('click', (e) => e.stopPropagation());
    nameComp.imgEl = this._makeBgImg();
    const nameClip = document.createElement('div');
    nameClip.className = 'completed-overlay-bg-clip';
    nameClip.appendChild(nameComp.imgEl);
    nameComp.bgClipEl = nameClip;
    nameComp.wrap.appendChild(nameClip);
  nameComp.wrap.style.zIndex = '30';

    const nameText = document.createElement('div');
    nameText.className = 'completed-overlay-content completed-overlay-text';
  nameText.style.pointerEvents = 'none';
    nameComp.wrap.appendChild(nameText);
    nameComp.contentEl = nameText;
    space.appendChild(nameComp.wrap);

    // Species Image component
    const imageComp = this.components.image;
    imageComp.wrap = this._makeWrapDiv('species-image');
    imageComp.wrap.addEventListener('click', (e) => e.stopPropagation());
    imageComp.imgEl = this._makeBgImg();
    const imageClip = document.createElement('div');
    imageClip.className = 'completed-overlay-bg-clip';
    imageClip.appendChild(imageComp.imgEl);
    imageComp.bgClipEl = imageClip;
    imageComp.wrap.appendChild(imageClip);
  imageComp.wrap.style.zIndex = '10';

    const imageInner = document.createElement('div');
    imageInner.className = 'completed-overlay-content';
    imageInner.style.display = 'flex';
    imageInner.style.alignItems = 'center';
    imageInner.style.justifyContent = 'center';
    imageInner.style.pointerEvents = 'none';

    const speciesImg = document.createElement('img');
    speciesImg.style.maxWidth = '100%';
    speciesImg.style.maxHeight = '100%';
    speciesImg.style.objectFit = 'contain';
    imageInner.appendChild(speciesImg);
    imageComp.wrap.appendChild(imageInner);
    imageComp.contentEl = speciesImg;
    space.appendChild(imageComp.wrap);

    // Species Info component
    const infoComp = this.components.info;
    infoComp.wrap = this._makeWrapDiv('species-info');
    infoComp.wrap.addEventListener('click', (e) => e.stopPropagation());
    infoComp.imgEl = this._makeBgImg();
    const infoClip = document.createElement('div');
    infoClip.className = 'completed-overlay-bg-clip';
    infoClip.appendChild(infoComp.imgEl);
    infoComp.bgClipEl = infoClip;
    infoComp.wrap.appendChild(infoClip);
  infoComp.wrap.style.zIndex = '40';
  infoComp.wrap.style.pointerEvents = 'auto';

    const infoInner = document.createElement('div');
    infoInner.className = 'completed-overlay-content completed-overlay-info-scroll';
    infoInner.style.whiteSpace = 'pre-wrap';
    infoInner.style.display = 'block';
    infoInner.style.pointerEvents = 'auto';
    infoInner.style.overflowY = 'auto';
    infoInner.style.boxSizing = 'border-box';
    infoInner.style.padding = '0 12px 0 0';
    infoComp.wrap.appendChild(infoInner);
    infoComp.contentEl = infoInner;
    space.appendChild(infoComp.wrap);

    this._applyScrollStyles();
  }

  _makeWrapDiv(suffix) {
    const div = document.createElement('div');
    div.className = 'completed-overlay-wrap';
    div.dataset.component = suffix;
    return div;
  }

  _makeBgImg() {
    const img = document.createElement('img');
    img.className = 'completed-overlay-bg';
    img.style.objectFit = 'unset';
    img.style.pointerEvents = 'none';
    img.style.position = 'absolute';
    img.style.left = '0px';
    img.style.top = '0px';
    img.style.transformOrigin = '0 0';
    img.style.willChange = 'transform';
    return img;
  }

  _applyScrollStyles() {
    const infoCfg = this.components.info.cfg || {};
    const thumb = infoCfg.scrollThumbColor || 'rgba(230, 194, 0, 0.7)';
    const track = infoCfg.scrollTrackColor || 'rgba(0,0,0,0.35)';

    if (!document.getElementById('__completed_overlay_scroll_css')) {
      const css = document.createElement('style');
      css.id = '__completed_overlay_scroll_css';
      css.textContent = `
        .completed-overlay-info-scroll::-webkit-scrollbar-thumb {
          background: ${thumb};
        }
        .completed-overlay-info-scroll::-webkit-scrollbar-track {
          background: ${track};
        }
      `;
      document.head.appendChild(css);
    }
  }

  destroy() {
    this.audio.pause();
    this.audio.src = '';
    window.removeEventListener('resize', this._onResize);
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    this.root = null;
    this._initialized = false;
  }

  hide() {
    if (!this.root) return;
    this.root.style.visibility = 'hidden';
    
    this.audio.pause();
    this.audio.currentTime = 0;

    Object.values(this.components).forEach(comp => {
      comp.state = 'hidden';
      comp.lastFrameIndex = -1;
      if (comp.wrap) comp.wrap.classList.remove('active');
    });

    this._activeKey = null;
  }

  _setComponentFrame(comp, index) {
    if (!comp.imgEl) return;
    const seq = comp.sequence;
    if (!seq) return;

    if (seq.kind === 'frames') {
      if (!comp.frames.length) return;
      const clamped = Math.max(0, Math.min(index, comp.frames.length - 1));
      if (clamped === comp.lastFrameIndex) return;
      comp.lastFrameIndex = clamped;
      comp.imgEl.style.left = '0px';
      comp.imgEl.style.top = '0px';
      comp.imgEl.style.width = '100%';
      comp.imgEl.style.height = '100%';
      comp.imgEl.style.position = 'absolute';
      comp.imgEl.style.objectFit = 'cover';
      comp.imgEl.src = comp.frames[clamped].src;
      return;
    }

    if (seq.kind === 'sheet') {
      const total = Math.max(0, Number(seq.totalFrames) || (seq.frames?.length || 0));
      if (!total) return;
      const clamped = Math.max(0, Math.min(index, total - 1));
      if (clamped === comp.lastFrameIndex) return;
      comp.lastFrameIndex = clamped;

      const entry = seq.frames?.[clamped];
      const frame = entry?.frame;
      if (!frame) return;

      const pageIndex = Number.isFinite(entry?.page) ? entry.page : 0;
      const pages = seq.pages || [];
      const page = pages[pageIndex] || pages[0] || null;
      if (!page) return;

      if (page.src && comp.imgEl.src !== page.src) {
        comp.imgEl.src = page.src;
      }

      const rect = comp._layoutRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;

      const sheetSize = page.size || { w: 1, h: 1 };
      const scaleX = rect.width / Math.max(1, frame.w);
      const scaleY = rect.height / Math.max(1, frame.h);

      // Avoid per-frame layout by keeping the page at natural size
      // and using transforms for crop positioning.
      const sizeKey = `${sheetSize.w}x${sheetSize.h}`;
      if (comp._sheetSizeKey !== sizeKey) {
        comp._sheetSizeKey = sizeKey;
        comp.imgEl.style.width = `${Math.round(sheetSize.w)}px`;
        comp.imgEl.style.height = `${Math.round(sheetSize.h)}px`;
      }

      const tx = Math.round(-frame.x * scaleX);
      const ty = Math.round(-frame.y * scaleY);
      comp.imgEl.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scaleX}, ${scaleY})`;
    }
  }

  _loopFrameIndex(comp) {
    const seq = comp.sequence;
    const total = (seq?.kind === 'sheet')
      ? Math.max(0, Number(seq.totalFrames) || (seq.frames?.length || 0))
      : comp.frames.length;
    if (!total) return 0;
    let idx = comp.frameIndex;
    if (idx < total) return idx;
    const loopTail = Math.max(1, Math.min(comp.cfg.loopTailFrames || 1, total));
    const startLoop = Math.max(0, total - loopTail);
    idx = startLoop + ((idx - startLoop) % loopTail);
    return idx;
  }

  async activate({ speciesKey, displayName, imageSrc, infoText }) {
    await this._ensureInitialized();

    this._activeKey = speciesKey;
    if (this.root) {
      this.root.style.visibility = 'visible';
    }

    const now = performance.now() * 0.001;
    this._startTimes.name = now + (this.components.name.startDelay || 0);
    this._startTimes.image = now + (this.components.image.startDelay || 0);
    this._startTimes.info = now + (this.components.info.startDelay || 0);

    Object.values(this.components).forEach(comp => {
      comp.state = 'pending';
      comp.frameIndex = 0;
      comp.frameTime = 0;
      comp.lastFrameIndex = -1;
      if (comp.wrap) comp.wrap.classList.remove('active');
    });

    this._applyNameContent(displayName);
    this._applyImageContent(imageSrc);
    this._applyInfoContent(infoText);

    // Play voiceover
    if (speciesKey) {
      const audioSrc = resolvePublicAsset(`game-assets/sub/voiceovers/${speciesKey}.mp3`);
      this.audio.src = audioSrc;
      this.audio.currentTime = 0;
      this.audio.play().catch(e => console.warn("CompletedOverlay audio play failed", e));
    }
  }

  _applyNameContent(displayName) {
    const comp = this.components.name;
    if (!comp.contentEl) return;
    const full = (displayName || '').trim();
    const match = full.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const primaryText = (match ? match[1] : full).trim();
    const secondaryText = match ? match[2].trim() : '';

    if (!comp.primaryEl) {
      comp.contentEl.textContent = '';
      const primary = document.createElement('div');
      primary.className = 'completed-name-primary';
      const secondary = document.createElement('div');
      secondary.className = 'completed-name-secondary';
      comp.contentEl.appendChild(primary);
      comp.contentEl.appendChild(secondary);
      comp.primaryEl = primary;
      comp.secondaryEl = secondary;
    }

    const primary = comp.primaryEl;
    const secondary = comp.secondaryEl;

    primary.textContent = primaryText ? primaryText.toLocaleUpperCase('es-AR') : '';
    secondary.textContent = secondaryText;
    secondary.style.display = secondaryText ? 'flex' : 'none';

    comp.contentEl.style.fontFamily = this.fontFamily;
    comp.contentEl.style.color = comp.cfg.textColor || '#E6C200';
    comp.contentEl.style.textShadow = comp.cfg.textShadow || '0 2px 10px rgba(0,0,0,0.75)';
    comp.contentEl.style.position = 'absolute';
    comp.contentEl.style.left = '0px';
    comp.contentEl.style.top = '0px';
    comp.contentEl.style.width = '100%';
    comp.contentEl.style.height = '100%';
    comp.contentEl.style.display = 'block';
    comp.contentEl.style.pointerEvents = 'none';
    comp.contentEl.style.gap = '0';

    primary.style.position = 'absolute';
    primary.style.pointerEvents = 'none';
    secondary.style.position = 'absolute';
    secondary.style.pointerEvents = 'none';

    this._applyFixedNameStylesFromCurrentBounds();
  }

  _applyImageContent(imageSrc) {
    const comp = this.components.image;
    if (!comp.contentEl) return;
    const imgEl = comp.contentEl;

    // Prevent stale previous species image from staying visible while new src loads.
    this._imageLoadToken += 1;
    const token = this._imageLoadToken;

    imgEl.style.visibility = 'hidden';
    imgEl.removeAttribute('src');

    if (!imageSrc) return;

    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = async () => {
      if (token !== this._imageLoadToken) return;
      try {
        if (probe.decode) await probe.decode();
      } catch (_) {}
      if (token !== this._imageLoadToken) return;
      imgEl.src = imageSrc;
      imgEl.style.visibility = 'visible';
    };
    probe.onerror = () => {
      if (token !== this._imageLoadToken) return;
      // Keep hidden on error rather than showing a previous species.
      imgEl.style.visibility = 'hidden';
    };
    probe.src = imageSrc;
  }

  _applyInfoContent(infoText) {
    const comp = this.components.info;
    if (!comp.contentEl) return;
    comp.contentEl.textContent = infoText || '';
    comp.contentEl.style.fontFamily = this.fontFamily;
    comp.contentEl.style.color = comp.cfg.textColor || '#E6C200';
    comp.contentEl.style.lineHeight = `${comp.cfg.lineHeight ?? 1.3}`;
    const fontSize = (comp.cfg.fontSizePx || 18);
    comp.contentEl.style.fontSize = `${fontSize}px`;
    comp.contentEl.scrollTop = 0;
  }

  update(dt, nowSec) {
    if (!this._activeKey || !this.root) return;

    const cmpEntries = Object.entries(this.components);
    for (const [key, comp] of cmpEntries) {
      const startAt = this._startTimes[key === 'name' ? 'name' : key];
      if (comp.state === 'pending') {
        if (nowSec >= startAt) {
          comp.state = 'playing';
          if (comp.wrap) comp.wrap.classList.add('active');
          this._setComponentFrame(comp, 0);
          if (comp.contentEl && key === 'name') {
            this._applyFixedNameStylesFromCurrentBounds();
          }
        }
      }

      if (comp.state === 'playing') {
        comp.frameTime += dt;
        if (comp.frameTime >= this._frameDuration) {
          const advance = Math.floor(comp.frameTime / this._frameDuration);
          comp.frameTime -= advance * this._frameDuration;
          comp.frameIndex += advance;
          const idx = this._loopFrameIndex(comp);
          comp.frameIndex = idx;
          this._setComponentFrame(comp, idx);
        }
      }
    }
  }

  updateLayout() {
    if (!this.root || !this.spaceEl) return;

    const vw = window.innerWidth;
    const vh = Math.max(1, window.innerHeight || 1);
    const spaceCfg = this.params.space || {};

    const marginLeft = Math.max(0, (spaceCfg.marginLeftVh ?? 0.05) * vh);
    const marginRight = Math.max(0, (spaceCfg.marginRightVh ?? 0.0) * vh);
    const marginTop = Math.max(0, (spaceCfg.marginTopVh ?? 0.05) * vh);
    const marginBottom = Math.max(0, (spaceCfg.marginBottomVh ?? 0.0) * vh);
    const availableWidth = Math.max(1, vw - marginLeft - marginRight);
    const availableHeight = Math.max(1, vh - marginTop - marginBottom);

    const designHeight = spaceCfg.designHeightPx || 1080;
    let designWidth = spaceCfg.designWidthPx;
    if (!Number.isFinite(designWidth) || designWidth <= 0) {
      let ratio = spaceCfg.widthToHeight;
      if (!Number.isFinite(ratio) || ratio <= 0) {
        ratio = 0.62;
      }
      designWidth = designHeight * ratio;
    }

    const targetHeight = Math.min(availableHeight, Math.max(1, (spaceCfg.heightVh ?? 1) * vh));
    let baseScale = targetHeight / designHeight;
    if (!Number.isFinite(baseScale) || baseScale <= 0) baseScale = 1;

    let scaleMultiplier = spaceCfg.scaleMultiplier;
    if (!Number.isFinite(scaleMultiplier) || scaleMultiplier <= 0) scaleMultiplier = 1;
    const layoutScale = baseScale * scaleMultiplier;

    const scaledWidth = designWidth * layoutScale;
    const scaledHeight = designHeight * layoutScale;
    const spaceLeft = Math.round(marginLeft);
    const spaceTop = Math.round(marginTop);

    Object.assign(this.spaceEl.style, {
      left: `${spaceLeft}px`,
      top: `${spaceTop}px`,
      width: `${designWidth}px`,
      height: `${designHeight}px`,
      transform: `scale(${layoutScale})`
    });

    this._spaceMetrics = {
      width: designWidth,
      height: designHeight,
      left: spaceLeft,
      top: spaceTop,
      scale: layoutScale,
      scaledWidth,
      scaledHeight
    };

    const layoutWidth = designWidth;
    const layoutHeight = designHeight;

    const nameComp = this.components.name;
    if (nameComp.wrap) {
      const cfg = nameComp.cfg || {};
      const width = Math.max(1, Math.round((cfg.widthPct ?? 0.3) * layoutWidth));
      const height = Math.max(1, Math.round(width / (nameComp.aspect || 1)));
      const left = Math.round((cfg.position?.xPct ?? 0.1) * layoutWidth);
      const top = Math.round((cfg.position?.yPct ?? 0.12) * layoutHeight);

      this._applyComponentLayout(nameComp, left, top, width, height);
      this._layoutNameText(width, height);
    }

    const imageComp = this.components.image;
    if (imageComp.wrap && nameComp.wrap) {
      const cfg = imageComp.cfg || {};
      const nameRect = nameComp._layoutRect || { left: 0, top: 0 };
      const baseLeft = nameRect.left;
      const baseTop = nameRect.top;

      const left = Math.round(baseLeft + (cfg.offsetPct?.x ?? 0) * layoutWidth);
      const top = Math.round(baseTop + (cfg.offsetPct?.y ?? 0) * layoutHeight);
      const width = Math.max(1, Math.round((cfg.widthPct ?? 0.24) * layoutWidth));
      const height = Math.max(1, Math.round(width / (imageComp.aspect || 1)));

      this._applyComponentLayout(imageComp, left, top, width, height);
      if (cfg.backgroundColor) {
        imageComp.wrap.style.background = cfg.backgroundColor;
      }
      if (cfg.borderRadiusPx) {
        imageComp.wrap.style.borderRadius = `${cfg.borderRadiusPx}px`;
      }
      this._layoutImageContent(width, height);
    }

    const infoComp = this.components.info;
    if (infoComp.wrap && nameComp.wrap) {
      const cfg = infoComp.cfg || {};
      const nameRect = nameComp._layoutRect || { left: 0, top: 0 };
      const baseLeft = nameRect.left;
      const baseTop = nameRect.top;

      const left = Math.round(baseLeft + (cfg.offsetPct?.x ?? 0) * layoutWidth);
      const top = Math.round(baseTop + (cfg.offsetPct?.y ?? 0) * layoutHeight);
      const width = Math.max(1, Math.round((cfg.widthPct ?? 0.3) * layoutWidth));
      const height = Math.max(1, Math.round(width / (infoComp.aspect || 1)));

      this._applyComponentLayout(infoComp, left, top, width, height);
      this._layoutInfoContent(width, height);
    }
  }

  _applyComponentLayout(comp, left, top, width, height) {
    const wrap = comp.wrap;
    if (!wrap) return;

    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
    wrap.style.width = `${width}px`;
    wrap.style.height = `${height}px`;
    comp._layoutRect = { left, top, width, height };
  }

  _layoutNameText(width, height) {
    const comp = this.components.name;
    if (!comp.contentEl) return;
    Object.assign(comp.contentEl.style, {
      left: '0px',
      top: '0px',
      width: `${width}px`,
      height: `${height}px`
    });

    this._applyFixedNameStyles(width, height);
  }

  _layoutImageContent(width, height) {
    const comp = this.components.image;
    const cfg = comp.cfg || {};
    const box = cfg.imageBox || { xPct: 0.1, yPct: 0.1, wPct: 0.8, hPct: 0.8 };
    const inner = comp.wrap ? comp.wrap.querySelector('.completed-overlay-content') : null;
    if (!inner) return;
    const left = Math.round(box.xPct * width);
    const top = Math.round(box.yPct * height);
    const w = Math.max(1, Math.round(box.wPct * width));
    const h = Math.max(1, Math.round(box.hPct * height));
    Object.assign(inner.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${w}px`,
      height: `${h}px`
    });
    if (comp.contentEl) {
      const baseScale = Number.isFinite(cfg.imageScale) ? cfg.imageScale : 1;
      comp.contentEl.style.transform = `scale(${baseScale})`;
      comp.contentEl.style.transformOrigin = '50% 50%';
    }
  }

  _layoutInfoContent(width, height) {
    const comp = this.components.info;
    const cfg = comp.cfg || {};
    if (!comp.contentEl) return;
    const box = cfg.textBox || { xPct: 0.1, yPct: 0.2, wPct: 0.8, hPct: 0.7 };
    const left = Math.round(box.xPct * width);
    const top = Math.round(box.yPct * height);
    const w = Math.max(1, Math.round(box.wPct * width));
    const h = Math.max(1, Math.round(box.hPct * height));
    Object.assign(comp.contentEl.style, {
      position: 'absolute',
      left: `${left}px`,
      top: `${top}px`,
      width: `${w}px`,
      height: `${h}px`
    });
  }

  _applyFixedNameStyles(width, height) {
    const comp = this.components.name;
    if (!comp?.primaryEl || !comp.contentEl) return;

    const primaryCfg = comp.cfg.primaryStyle || {};
    const secondaryCfg = comp.cfg.secondaryStyle || {};

    this._applySingleNameStyle(comp.primaryEl, primaryCfg, width, height, {
      defaultAlign: 'center'
    });

    if (comp.secondaryEl) {
      if (comp.secondaryEl.textContent) {
        comp.secondaryEl.style.display = 'flex';
        this._applySingleNameStyle(comp.secondaryEl, secondaryCfg, width, height, {
          defaultAlign: primaryCfg.textAlign || 'center'
        });
      } else {
        comp.secondaryEl.style.display = 'none';
      }
    }
  }

  _applyFixedNameStylesFromCurrentBounds() {
    const comp = this.components.name;
    if (!comp?.wrap) return;
    const rect = comp._layoutRect;
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    this._applyFixedNameStyles(rect.width, rect.height);
  }

  _applySingleNameStyle(el, cfg, width, height, { defaultAlign }) {
    if (!el) return;

    const leftPct = (typeof cfg.leftPct === 'number') ? cfg.leftPct : 0;
    const widthPct = (typeof cfg.widthPct === 'number') ? cfg.widthPct : 1;
    const topPct = (typeof cfg.topPct === 'number') ? cfg.topPct : 0;
    const heightPct = (typeof cfg.heightPct === 'number') ? cfg.heightPct : null;

    const left = Math.round(leftPct * width);
    const w = Math.max(1, Math.round(widthPct * width));
    const top = Math.round(topPct * height);
    const h = heightPct !== null
      ? Math.max(1, Math.round(heightPct * height))
      : Math.max(1, Math.round((cfg.fontSizePx ?? 48) * (cfg.lineHeight ?? 1.0)));

    const fontSize = (cfg.fontSizePx ?? 48);
    const lineHeight = cfg.lineHeight ?? 1.0;
    const textAlign = cfg.textAlign || defaultAlign || 'center';
    const verticalAlign = cfg.verticalAlign || 'center';

    Object.assign(el.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${w}px`,
      height: `${h}px`,
      display: 'flex',
      position: 'absolute',
      justifyContent: this._mapTextAlignToFlex(textAlign),
      alignItems: this._mapVerticalAlignToFlex(verticalAlign),
      textAlign,
      fontSize: `${fontSize}px`,
      lineHeight: typeof lineHeight === 'number' ? lineHeight.toString() : String(lineHeight)
    });
  }

  _mapTextAlignToFlex(alignment) {
    switch (alignment) {
      case 'left':
        return 'flex-start';
      case 'right':
        return 'flex-end';
      case 'center':
      default:
        return 'center';
    }
  }

  _mapVerticalAlignToFlex(alignment) {
    switch (alignment) {
      case 'top':
        return 'flex-start';
      case 'bottom':
        return 'flex-end';
      case 'center':
      default:
        return 'center';
    }
  }

  async loadSpeciesAssets(speciesKey, { imagePath, infoPath, displayName }) {
    if (this._speciesCache.has(speciesKey)) {
      return this._speciesCache.get(speciesKey);
    }

    const result = { imageSrc: imagePath, infoText: '', displayName };

    if (infoPath) {
      try {
        const response = await fetch(infoPath);
        if (response.ok) {
          result.infoText = await response.text();
        } else {
          result.infoText = `No se pudo cargar la información (${response.status}).`;
        }
      } catch (err) {
        console.error('[completedOverlay] info fetch failed', err);
        result.infoText = 'Información no disponible.';
      }
    }

    this._speciesCache.set(speciesKey, result);
    return result;
  }
}

class FactOverlay {
  constructor(options = {}) {
    const completedCfg = DEFAULT_PARAMS?.completedOverlay || {};
    const infoCfg = completedCfg?.speciesInfo || {};

    const {
      bgSrc = resolvePublicAsset('game-assets/sub/interfaz/caption_bg.webp'),
      fontFamily = completedCfg.fontFamily || `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`,
      textColor = infoCfg.textColor || '#E6C200',
      fontSizePx = infoCfg.fontSizePx || 18,
      lineHeight = infoCfg.lineHeight || 1.35,
      showMs = 4000,
      // Background sizing: width is viewport-relative (responsive), with a minimum.
      // Keep aspect ratio (no stretching).
      widthVw = 0.20,
      minWidthPx = 280,
      maxWidthPx = 720,
      paddingPx = 22
    } = options;

    this.options = { bgSrc, fontFamily, textColor, fontSizePx, lineHeight, showMs, widthVw, minWidthPx, maxWidthPx, paddingPx };

    this.container = document.createElement('div');
    this.container.id = 'fact-overlay';
    Object.assign(this.container.style, {
      position: 'absolute',
      bottom: '5%',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '1000',
      opacity: '0',
      transition: 'opacity 0.5s ease-in-out',
      pointerEvents: 'none',
      overflow: 'hidden',
      userSelect: 'none',
      WebkitUserSelect: 'none'
    });

    // Background image (same asset used for completed species name)
    this.bgImg = document.createElement('img');
    this.bgImg.alt = '';
    this.bgImg.decoding = 'async';
    this.bgImg.src = bgSrc;
    Object.assign(this.bgImg.style, {
      display: 'block',
      width: `min(90vw, clamp(${minWidthPx}px, ${Math.round(widthVw * 100)}vw, ${maxWidthPx}px))`,
      height: 'auto'
    });

    // Text overlay (centered; clipped; with safe padding)
    this.textEl = document.createElement('div');
    Object.assign(this.textEl.style, {
      position: 'absolute',
      inset: '0',
      display: 'grid',
      placeItems: 'center',
      textAlign: 'center',
      color: textColor,
      fontFamily,
      fontWeight: '600',
      lineHeight: String(lineHeight),
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
      overflow: 'hidden',
      padding: `clamp(${Math.max(12, Math.floor(paddingPx * 1.05))}px, 2.1vh, ${paddingPx + 12}px) clamp(${Math.round((paddingPx + 14) * 1.5)}px, ${Math.round(3.2 * 1.5 * 10) / 10}vw, ${Math.round((paddingPx + 28) * 1.5)}px)`
    });

    this.container.appendChild(this.bgImg);
    this.container.appendChild(this.textEl);
    document.body.appendChild(this.container);

    // Audio element for voiceovers
    this.audio = new Audio();
    this.audio.volume = 1.0;

    // When the image loads, we can fit text reliably.
    this.bgImg.addEventListener('load', () => {
      this._fitText();
    }, { once: true });

    this.timeout = null;

    // Keep it responsive on window resizes.
    this._onResize = () => {
      this._fitText();
    };
    window.addEventListener('resize', this._onResize, { passive: true });
  }

  _fitText() {
    if (!this.textEl || !this.container) return;
    const { fontSizePx } = this.options;

    // Start a bit smaller than the completed-species info font.
    // This keeps captions readable but prevents frequent top/bottom overflow.
    let size = Math.max(8, Math.floor((fontSizePx ?? 18) * 0.85));
    this.textEl.style.fontSize = `${size}px`;

    // Compare against the actual text box size.
    // Note: scrollWidth/scrollHeight include padding, and clientWidth/clientHeight
    // represent the visible box (also includes padding). This is the most robust
    // way to ensure we never overflow top/bottom.
    for (let i = 0; i < 120; i++) {
      const tooWide = this.textEl.scrollWidth > this.textEl.clientWidth;
      const tooTall = this.textEl.scrollHeight > this.textEl.clientHeight;
      if (!tooWide && !tooTall) break;
      size = Math.max(8, size - 1);
      this.textEl.style.fontSize = `${size}px`;
      if (size === 8) break;
    }
  }

  hide({ immediate = false } = {}) {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (!this.container) return;
    if (immediate) {
      const prev = this.container.style.transition;
      this.container.style.transition = 'none';
      this.container.style.opacity = '0';
      // Restore transition next frame so future shows fade normally.
      requestAnimationFrame(() => {
        if (this.container) this.container.style.transition = prev || 'opacity 0.5s ease-in-out';
      });
      return;
    }
    this.container.style.opacity = '0';
  }

  show(text, audioSrc) {
    if (this.timeout) clearTimeout(this.timeout);
    
    // Stop previous audio
    this.audio.pause();
    this.audio.currentTime = 0;

    this.textEl.textContent = String(text ?? '');
    this._fitText();
    // Extra passes to ensure layout settles (responsive width + font load).
    requestAnimationFrame(() => this._fitText());
    setTimeout(() => this._fitText(), 0);
    this.container.style.opacity = '1';
    
    if (audioSrc) {
      this.audio.src = audioSrc;
      this.audio.play().catch(e => console.warn("Audio play failed", e));
    }

    this.timeout = setTimeout(() => {
      this.container.style.opacity = '0';
    }, this.options.showMs);
  }

  destroy() {
    if (this.timeout) clearTimeout(this.timeout);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}

/* ========================================================================== */
/* RioScene                                                                   */
/* ========================================================================== */

export class RioScene extends BaseScene {
  constructor(app) {
    super(app);
    this.name = 'rio';

    // Deep clone DEFAULT_PARAMS so runtime edits won’t mutate the constant.
    this.params = JSON.parse(JSON.stringify(DEFAULT_PARAMS));

    // Input state (mouse axes normalized -1..+1)
    this.mouseNDC = new THREE.Vector2(0, 0);
    this.vel = new THREE.Vector2(0, 0);
    this.forward = new THREE.Vector3(0, 0, -1);

    // --- Water-crossing memory ---
    this._wasUnderwater = undefined;              // last frame's underwater state
    this._lastUnderwaterX = this.params.start.x; // last X while underwater
    
    // --- Surface transition state ---
    this._surfaceTransitionActive = false;
    this._surfaceTransitionTime = 0;
    this._wasInsideSolid = false;
    
    // Raycasting for fish clicks
    this.raycaster = new THREE.Raycaster();
    this.clickMouse = new THREE.Vector2();

    // Fact overlay system
    this.factOverlay = new FactOverlay({
      bgSrc: resolvePublicAsset('game-assets/sub/interfaz/caption_bg.webp'),
      fontFamily: this.params?.completedOverlay?.fontFamily,
      textColor: this.params?.completedOverlay?.speciesInfo?.textColor,
      fontSizePx: Math.round((this.params?.completedOverlay?.speciesInfo?.fontSizePx ?? 18) * 0.85),
      lineHeight: this.params?.completedOverlay?.speciesInfo?.lineHeight,
    });
    this.fishClickCount = 0;
    this.speciesFactIndices = {};

    // Reusables
    this.tmpRight = new THREE.Vector3();
    this.tmpUp = new THREE.Vector3(0, 1, 0);
    this.tmpDelta = new THREE.Vector3();

    // Reusables for steering & math (avoid GC)
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._tmpBox = new THREE.Box3();

    // Scene content
    this.model = null;
    this.tilesGroup = new THREE.Group();
    this.scene.add(this.tilesGroup);

    // Water
    this.waterSurface = null;
    this.waterSurfaceBottom = null;
    this.waterOccluder = null;

    // SwimBox (world-aligned, explicit bounds)
    this.swimBox = new THREE.Box3();

    // Fish containers
    this.fish = [];
    this.speciesObjs = [];
    
    // Deck UI
    this.deck = null;
    this._loadingEl = null;
    this._loadingTextEl = null;
    this._loadingBarFillEl = null;
    this._loadingProgressTotal = 0;
    this._loadingProgressCompleted = 0;

    // Deck tutorial hint (one-time): points to selected deck card until 3 fish clicks.
    this._deckTagHintEl = null;
    this._deckTagHintVisible = false;
    this._deckTagHintLastKey = '';

    // Rio tag progress bar (DOM overlay, top-left)
    this._tagProgress = {
      container: null,
      labelEl: null,
      barFillEl: null,
      completed: false
    };

  // Completed overlay state
  this.completedOverlay = null;
  this._completedOverlayState = { activeKey: null, loading: false };
  this._deckSelectionTime = 0;
  this._lastDeckIndex = null;

  // Cursor state
  this._originalCanvasCursor = null;

        /* === ADD: timer & cursor state === */
    this.timer = {
      el: null,        // wrapper
      imgEl: null,     // <img> background
      textEl: null,    // <div> numbers
      natW: 0,         // natural image width
      natH: 0,         // natural image height
      running: false,
      t0: 0            // start time (seconds, perf.now based)
    };

    /* === Inside-solid DOM overlay (relleno de volumen) === */
    this._insideOverlay = null;
    this._suppressInsideOverlay = false;
    this._appPauseListener = null;
    this._appResumeListener = null;
    this._cursorEnabled = false;
    this._cursorBlockedByDeck = false;
    this._cursorBlockedByMenu = false;
    this._deckMouseEnter = null;
    this._deckMouseLeave = null;
    this._handleAppPaused = () => {
      this._suppressInsideOverlay = true;
      this._cursorBlockedByMenu = true;
      this._applyInsideOverlayState(this.isCameraInsideSolid());
      this._updateCursorVisibility();
      this._cancelCompletedOverlay();
    };
    this._handleAppResumed = () => {
      this._suppressInsideOverlay = false;
      this._cursorBlockedByMenu = false;
      this._applyInsideOverlayState(this.isCameraInsideSolid());
      this._updateCursorVisibility();
    };

    // CSS (una sola vez)
    if (!document.getElementById('__rio_inside_overlay_css')) {
      const css = document.createElement('style');
      css.id = '__rio_inside_overlay_css';
      css.textContent = `
        #rio-inside-overlay {
          position: fixed;
          inset: 0;
          background: transparent;
          opacity: 0;                   /* oculto por defecto */
          transition: opacity 200ms ease;
          pointer-events: none;
          z-index: 100002;              /* por encima de todo lo in-escena */
          user-select: none; -webkit-user-select: none; -ms-user-select: none;
        }
      `;
      document.head.appendChild(css);
    }

    // Nodo del overlay
    const inside = document.createElement('div');
    inside.id = 'rio-inside-overlay';
    document.body.appendChild(inside);
    this._insideOverlay = inside;
    // No background for the surface transition; bubbles only.
    this._insideOverlay.style.backgroundColor = 'transparent';

  this.surfaceFX = null;
  this._insideOverlayPrevInside = false;
  this._setupSurfaceVideoFX();


    this.cursorEl = null;
    this._trackerTexture = null;
    this._trackerTextureConfig = null;
    this._isCurrentlyUnderwater = false;

    this._cursorAnim = {
      frames: [],      // Image[]
      playing: false,
      idx: 0,
      x: 0,
      y: 0
    };

    this._radarAnim = null; // resolved animation data (frame sequence or sheet)
    this._radars = [];      // active DOM instances



    // Spatial hash + throttled steering
    this._hash = new SpatialHash(3.0); // will be reset to separationRadius later
    this._sepAccum = 0;
    this._sepHz = 30;

    // (Optional) keep a non-instanced group; may stay empty now
    this.fishGroup = new THREE.Group();
    this.fishGroup.name = 'fish-group';
    this.scene.add(this.fishGroup);

    // Vegetation
    this.vegGroup = new THREE.Group();
    this.vegGroup.name = 'vegetation-group';
    this.scene.add(this.vegGroup);

    // Fog & mist state
    this._fogUnderPrev = undefined; // for hysteresis at the surface
    this.mistGroup = null;
    this._mist = null;

    // Shoreline haze
    this.shoreHazeMesh = null;
    this._shoreHazeTex = null;

    // Shore vegetation background (image card behind shore haze)
    this.shoreVegBackgroundGroup = null;
    this._shoreVegBackgroundTex = null;
    this._shoreVegBackgroundGeo = null;
    this._shoreVegBackgroundMat = null;

    // Shore vegetation background 2
    this.shoreVegBackgroundGroup2 = null;
    this._shoreVegBackgroundTex2 = null;
    this._shoreVegBackgroundGeo2 = null;
    this._shoreVegBackgroundMat2 = null;

    // Keep instances by category for updates/cleanup
    this.vegetation = {
      floor: [],   // { mesh }
      surface: [], // { mesh, center: THREE.Vector3, driftR, driftW, phase, speciesKey, yOffset }
      shore: []    // { mesh }
    };


    // --- Audio ---
    this.audioListener = null;
    this.sounds = {};
    this.lowpassFilter = null;
    this.lowpassFilterLanchas = null;
    this.audioState = {
      ambientUnder: undefined,   // estado previo para cambiar loops (arriba/abajo)
      eqUnderPrev: undefined,    // estado previo para detectar toggles del EQ (rampas rápidas)
      started: false,            // si ya hicimos bootstrap de audio
      musicGainNode: null,
      lanchasGainNode: null
    };

    // respect debug visibility
    this.tilesGroup.visible    = this.params.debug.tiles;
    this.fishGroup.visible     = this.params.debug.fish;

    // --- Intro state & control gating ---
    this.controlsEnabled = true; // will be disabled if intro.enabled
    
    // --- Zoom velocity state ---
    this.zoomVelocity = 0;    // Current velocity for smooth zoom
    this._lastWheelTime = 0;  // Time of last wheel event for friction timing
    
    this.introState = {
      active: false,
      phase: 'idle', // 'idle' | 'pre' | 'move' | 'post' | 'done'
      t0: 0,         // phase start time (seconds, perf.now based)
      startY: 0,     // camera top Y
      targetY: 0,    // camera start.y
      overlayEl: null
    };
  }

  async _preloadSheetSequence(dir) {
    if (!dir) return null;
    const base = String(dir).replace(/\/+$/, '');
    const jsonCandidates = [`${base}/sheet_1024.json`, `${base}/sheet.json`];
    let sheet;
    for (const jsonUrl of jsonCandidates) {
      try {
        const res = await fetch(jsonUrl, { cache: 'force-cache' });
        if (!res.ok) continue;
        sheet = await res.json();
        break;
      } catch (_) {
        // try next candidate
      }
    }
    if (!sheet) return null;

    const meta = sheet?.meta;
    const frames = sheet?.frames;
    if (!meta || !Array.isArray(frames) || !frames.length) return null;

    const loadAndDecode = async (src) => {
      const image = await new Promise((resolve) => {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = src;
      });
      if (!image) return null;
      try {
        if (image.decode) await image.decode();
      } catch (_) {}
      return image;
    };

    const warmupForGpu = async (pageSrcs) => {
      // decode() prepares CPU-side decode but doesn't always force GPU upload.
      // Paint tiny fully-transparent <img>s during the loading screen to avoid show-time spikes.
      if (!pageSrcs || !pageSrcs.length) return;
      if (typeof document === 'undefined') return;
      if (typeof requestAnimationFrame !== 'function') return;

      const holder = document.createElement('div');
      Object.assign(holder.style, {
        position: 'fixed',
        left: '0px',
        top: '0px',
        width: '1px',
        height: '1px',
        opacity: '0',
        pointerEvents: 'none',
        zIndex: '-1',
        overflow: 'hidden'
      });

      for (const src of pageSrcs) {
        const im = document.createElement('img');
        im.decoding = 'async';
        im.src = src;
        im.width = 1;
        im.height = 1;
        holder.appendChild(im);
      }

      document.body.appendChild(holder);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      holder.remove();
    };

    // Multi-atlas format: meta.pages = [{ image, size:{w,h} }, ...]
    // Legacy format: meta.image = 'sheet.webp' and meta.size
    const pages = [];
    const rawPages = Array.isArray(meta.pages) ? meta.pages : null;
    if (rawPages && rawPages.length) {
      const pageSrcs = [];
      for (const p of rawPages) {
        const name = p?.image;
        if (!name) continue;
        const src = `${base}/${encodeURIComponent(name)}`;
        const image = await loadAndDecode(src);
        if (!image) return null;
        pageSrcs.push(src);
        pages.push({
          src,
          image,
          size: p?.size || { w: image.naturalWidth || 1, h: image.naturalHeight || 1 }
        });
      }

      await warmupForGpu(pageSrcs);
      if (typeof window !== 'undefined' && window.__DEBUG_COMPLETED_OVERLAY_SHEETS) {
        console.info('[completedOverlay] multi-atlas pages loaded', { dir: base, pages: pageSrcs });
      }
    } else {
      const sheetImageName = meta.image || 'sheet.webp';
      const src = `${base}/${encodeURIComponent(sheetImageName)}`;
      const image = await loadAndDecode(src);
      if (!image) return null;
      pages.push({
        src,
        image,
        size: meta?.size || { w: image.naturalWidth || 1, h: image.naturalHeight || 1 }
      });

      // Normalize legacy frames to page 0.
      for (const f of frames) {
        if (typeof f.page !== 'number') f.page = 0;
      }
    }

    const totalFrames = Math.max(0, Number(meta.frame_count) || frames.length || 0);
    return {
      kind: 'sheet',
      pages,
      meta,
      frames,
      totalFrames
    };
  }

  async _preloadCompletedOverlaySequence(dir, prefix, pad, startIndex, maxProbe) {
    // Prefer spritesheets (sheet.json + sheet.webp) to avoid hundreds of PNG requests.
    const sheet = await this._preloadSheetSequence(dir);
    if (sheet) return sheet;

    const frames = await this._preloadFrameSequence(dir, prefix, pad, startIndex, maxProbe);
    return { kind: 'frames', frames };
  }

  /* --------------------------------- Lifecycle --------------------------------- */

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

    this._createLoadingOverlay();
    this._setLoadingText('Preparando escena principal...');
    if (this.app?.canvas) {
      this.app.canvas.style.visibility = 'hidden';
      this._originalCanvasCursor = this.app.canvas.style.cursor;
      this.app.canvas.style.cursor = 'none';
    }

    // Background + lights
    const hemi = new THREE.HemisphereLight(0xFFD1A6, 0x4A2F1B, 1.5);
    const dir = new THREE.DirectionalLight(0xFF9E5E, 1.2);

    // Let the dome be the background
    this.scene.background = null;

    // --- Sky Dome that fogs ---
    const skyRadius = Math.max(10, this.camera.far * 0.9); // inside frustum
    const skyGeo = new THREE.SphereGeometry(skyRadius, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      color: this.params.skyColor,   // reuse your param (e.g. 0xF6B26B)
      side: THREE.BackSide,
      fog: true,                     // <- MUST be true to receive scene.fog
      depthWrite: false              // don't pollute depth
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    // Keep it always considered (we’ll move it with the camera anyway)
    this.skyDome.frustumCulled = false;
    this.scene.add(this.skyDome);



    dir.position.set(8, 12, 6);
    dir.castShadow = false;
    this.scene.add(hemi, dir);

    
    // Load environment model (floor/walls)
    await this._trackLoadingStep('Cargando modelo environment.glb (entorno)', async () => {
      try {
        const gltf = await AssetLoader.gltf('/game-assets/sub/environment-without-background-plants.glb');
        this.model = gltf.scene || gltf.scenes?.[0];
        if (this.model) {
          // Optional: set mesh flags
          this.model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

          // Add to scene FIRST so world matrices/materials are valid
          this.scene.add(this.model);
          this.scene.updateMatrixWorld(true);

          // === Gather baked vegetation by explicit group OR name prefix 'veg_' ===
          let vegBaked = this.model.getObjectByName('VEG_BAKED');
          const detachList = [];
          if (vegBaked) {
            detachList.push(vegBaked);
          } else {
            this.model.traverse((n) => {
              if (!n || !n.name) return;
              const nm = n.name.toLowerCase();
              if (nm.startsWith('veg_')) detachList.push(n);
            });
          }
          console.log(`[env] veg nodes to detach: ${detachList.length}`);

          // Temporary holder so vegetation doesn't affect recenter bbox or tiling
          const tempVegHolder = new THREE.Group();
          tempVegHolder.name = 'VEG_BAKED_RUNTIME';
          this.model.add(tempVegHolder);

          // Move veg nodes under the holder, preserving world transform
          const _reparentKeepWorld = (parent, child) => {
            // Save child's world transform
            const mWorld = child.matrixWorld.clone();

            // Reparent
            parent.add(child);

            // Compute child's local matrix = parent^-1 * child_world
            const parentInv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
            const mLocal = new THREE.Matrix4().multiplyMatrices(parentInv, mWorld);

            // Apply local matrix
            child.matrix.copy(mLocal);
            child.matrix.decompose(child.position, child.quaternion, child.scale);
            child.updateMatrixWorld(true);
          };
          for (const node of detachList) _reparentKeepWorld(tempVegHolder, node);

          // Recenter & scale the environment (veg is detached, so it won't skew bbox)
          this.recenterToFloor(this.model);
          if (Number.isFinite(this.params.overrideScale)) {
            this.model.scale.setScalar(this.params.overrideScale);
          } else {
            this.scaleModelToLongest(this.model, this.params.modelLongestTarget);
          }
          this.scene.updateMatrixWorld(true);
        } else {
          console.error('environment.glb loaded but had no scene.');
        }
      } catch (err) {
        console.error('Error loading environment.glb', err);
      }
    });


    // Camera pose & yaw
    const { x, y, z, yawDeg } = this.params.start;
    this.camera.position.set(x, y, z);
    this.setYaw(yawDeg);
    this.params.swimBoxMaxX = this.params.start.x;
    this.camera.lookAt(this.camera.position.clone().add(this.forward));

    // --- Intro initialization ---
    if (this.params.intro?.enabled) {
      this.controlsEnabled = false;

      const yMax = this.params.surfaceLevel + this.params.cameraSurfaceMargin;
      this.introState.targetY = this.params.start.y;
      this.introState.startY  = yMax;

      // Cámara arriba del agua lista para la caída
      this.camera.position.set(this.params.start.x, yMax, this.params.start.z);
      this.camera.lookAt(this.camera.position.clone().add(this.forward));

      // Overlay de intro: oculto durante la carga
      this._createIntroOverlay();
      this._setIntroOverlayText('');
    }


    // When the camera gets very close to the water plane, a near clip of 0.1
    // can clip the surface itself, revealing the underwater scene or causing
    // the depth-only occluder to “punch a hole” (gray).
    this.camera.near = 0.0002;
    this.camera.far  = 90;   // try 80–150; lower = faster
    this.camera.updateProjectionMatrix();

    // --- Depth target for soft particles ---
    this.depthTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
    this.depthTarget.texture.minFilter = THREE.NearestFilter;
    this.depthTarget.texture.magFilter = THREE.NearestFilter;
    this.depthTarget.depthTexture = new THREE.DepthTexture();
    this.depthTarget.depthTexture.type = THREE.UnsignedShortType;

    // Build tiling & water after model is in the scene
    if (this.model) {
      this.scene.updateMatrixWorld(true);
      if (this.params.debug.tiles) this.rebuildTiles();
      if (this.params.debug.water) this.buildOrUpdateWaterSurface();
    }

    // --- Mist layer (cheap steam above water) ---
    if (this.params.mist?.enabled) {
      await this._trackLoadingStep('Generando capa de niebla y vapor', async () => {
        this.buildMistLayer();
      });
    }

    // Shoreline haze (simple PNG card)
    if (this.params.shoreVegBackground?.enabled) {
      await this._trackLoadingStep('Construyendo fondo de vegetación costera', async () => {
        await this.buildOrUpdateShoreVegBackground();
      });
    }
    if (this.params.shoreVegBackground2?.enabled) {
      await this._trackLoadingStep('Construyendo fondo de vegetación costera 2', async () => {
        await this.buildOrUpdateShoreVegBackground2();
      });
    }
    if (this.params.shoreHaze?.enabled) {
      await this._trackLoadingStep('Construyendo shore haze y detalle costero', async () => {
        await this.buildOrUpdateShoreHaze();
      });
    }

    // Initialize explicit swimBox using the world parameters directly
    this.initSwimBoxFromParams();

    // Vegetation
    if (this.params.vegetation?.enabled) {
      await this._trackLoadingStep('Inicializando vegetación dinámica', async () => {
        await this.initVegetation();    // loads GLBs & spawns instances
      });
    }

    // Prepare species objects (use explicit bias block)
    this.speciesObjs = SPECIES.map(def =>
      new FishSpecies(def, this.scene, this.params.fish, this.params.fishPositionBias)
    );
    
    // Build the Deck UI (hidden until intro ends)
    if (this.params.debug.deck) {
      this._createTagProgressOverlay();
      this.deck = new Deck(SPECIES, this.speciesObjs, this.params.deckUI, {
        onSpeciesCompleted: () => this.playSfx('completed'),
        onProgress: (snapshot) => this._updateTagProgressOverlay(snapshot)
      });
      await this._trackLoadingStep('Cargando UI del deck y sprites asociados', async () => {
        await this.deck.build();
      });

      // Ensure the bar is correct after build
      this._updateTagProgressOverlay();

      // Completed overlay atlases (decode during loading screen to avoid GPU spike later)
      await this._trackLoadingStep('Cargando overlay de especies completadas', async () => {
        this._initCompletedOverlay();
        if (this.completedOverlay) {
          await this.completedOverlay.prepare();
          await this.completedOverlay.waitForSequences();
        }
      });

      // ---- Depth Ruler Overlay (DOM) ----
      this.ruler = { el: null, naturalW: 0, naturalH: 0, img: null };
      if (this.params.rulerUI?.enabled) {
        const R = this.params.rulerUI;

        // preload natural size
        const img = new Image();
        img.onload = () => {
          this.ruler.naturalW = img.naturalWidth || 1;
          this.ruler.naturalH = img.naturalHeight || 1;
          this._updateRulerLayout();   // compute size/pos once we know aspect
          this._updateRulerPosition(); // place vertically based on current camera Y
          this.ruler.el.style.visibility = 'visible';
        };
        img.src = R.src;
        this.ruler.img = img;

        // dom element we actually display (so we can style freely)
        const el = document.createElement('img');
        el.id = 'depth-ruler';
        el.style.opacity = String(R.opacity ?? 1);
        el.src = R.src;
        Object.assign(el.style, {
          position: 'fixed',
          left: '0px', top: '0px',
          width: '0px', height: 'auto',
          pointerEvents: 'none',
          zIndex: String(R.zIndex ?? 9995),
          visibility: 'hidden'
        });
        document.body.appendChild(el);
        this.ruler.el = el;

        // keep layout in sync on resize
        this._onRulerResize = () => {
          this._updateRulerLayout();
          this._updateRulerPosition();
        };
        window.addEventListener('resize', this._onRulerResize, { passive: true });
      }

      /* === ADD: Timer Overlay (DOM) === */
      if (this.params.timerUI) {
        this._createTimerOverlay();   // builds DOM and preloads image
      }

      /* === ADD: Cursor Overlay (DOM) === */
      if (this.params.cursorUI?.enabled) {
        this._createCursorOverlay();
      }

      const C = this.params.cursorUI?.anim;
      const R = this.params.radarUI?.anim;

      if (C) {
        this._cursorAnim.frames = await this._trackLoadingStep('Cargando animación del cursor', async () => {
          return await this._preloadFrameSequence(C.dir, C.prefix, C.pad, C.startIndex, C.maxFramesProbe);
        });
      }
      if (this.params.radarUI?.enabled && R) {
        const fps = Math.max(1, Number(R.fps) || 30);
        const frameDuration = 1 / fps;
        if (R.sheetSrc) {
          this._radarAnim = await this._trackLoadingStep('Cargando animación del radar (spritesheet)', async () => {
            return await this._loadSpriteSheet({ ...R, frameDuration });
          });
        } else {
          this._radarAnim = await this._trackLoadingStep('Cargando animación del radar (frames)', async () => {
            const frames = await this._preloadFrameSequence(R.dir, R.prefix, R.pad, R.startIndex, R.maxFramesProbe);
            return frames?.length ? { kind: 'frames', frames, totalFrames: frames.length, frameDuration } : null;
          });
        }
      } else {
        this._radarAnim = null;
      }


      this._onDeckWheel = (e) => {
        e.preventDefault();                // stop page scroll
        if (this.deck) this.deck.onWheel(e.deltaY);
      };
      this.deck.container.addEventListener('wheel', this._onDeckWheel, { passive: false });
      this._deckMouseEnter = () => {
        this._cursorBlockedByDeck = true;
        this._updateCursorVisibility();
      };
      this._deckMouseLeave = () => {
        this._cursorBlockedByDeck = false;
        this._updateCursorVisibility();
      };
      this.deck.container.addEventListener('mouseenter', this._deckMouseEnter);
      this.deck.container.addEventListener('mouseleave', this._deckMouseLeave);

      // hide the deck during intro
      this.deck.container.style.opacity = 0;
      this.deck.container.style.pointerEvents = 'none';
    }
    // If deck is disabled, still init the overlay so it can be toggled later.
    this._initCompletedOverlay();
    this._deckSelectionTime = performance.now() * 0.001;
    // Spawn fish by abundance
    if (this.params.debug.fish) {
      await this.spawnFishBySpecies();
    }
    // Ensure all agents are inside the initial swimBox
    for (const a of this.fish) {
      this.projectInsideSwimBox(a.pos);
      if (!this.swimBox.containsPoint(a.target)) {
        a.target = a.species.randBiasedPoint(this.swimBox);
      }
      a.mesh.position.copy(a.pos);
    }

    // Inputs
    this._onMouseMove  = (e) => this.onMouseMove(e);
    this._onMouseLeave = () => this.mouseNDC.set(0, 0);
    this._onMouseDown = (e) => this.onMouseDown(e);
    this._onKeyDown = (e) => this.onKeyDown(e);
    
    this.app.canvas.addEventListener('mousemove', this._onMouseMove);
    this.app.canvas.addEventListener('mouseleave', this._onMouseLeave);
    this.app.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('keydown', this._onKeyDown);
    this._appPauseListener = EventBus.on('app:paused', this._handleAppPaused);
    this._appResumeListener = EventBus.on('app:resumed', this._handleAppResumed);

    this._onWheel = (e) => this.onWheel(e);
    this.app.canvas.addEventListener('wheel', this._onWheel, { passive: false });

    this.audioListener = new THREE.AudioListener();
    this.camera.add(this.audioListener);
    this.audioListener.setMasterVolume(1.0);

    // Ensure depth target and shader resolution are synced
    this.onResize(window.innerWidth, window.innerHeight);

    const soundPaths = {
      surface: '/game-assets/sub/sonido/exterior.mp3',
      underwater: '/game-assets/sub/sonido/inmersion.mp3',
      music: '/game-assets/sub/sonido/musica.mp3',
      sfxCatch: '/game-assets/sub/sonido/exito.mp3',
      sfxWrong: '/game-assets/sub/sonido/fracaso.mp3',
      lanchas: '/game-assets/sub/sonido/lanchas.mp3',
      sfxCompleted: '/game-assets/sub/sonido/completed_species.mp3'
    };

    const audioBuffers = {};
    for (const [key, path] of Object.entries(soundPaths)) {
      audioBuffers[key] = await this._trackLoadingStep(`Cargando audio ${key} (${path})`, async () => {
        return await AssetLoader.audioBuffer(path);
      });
    }

    // Ambientes (loops)
    this.sounds.surface = new THREE.Audio(this.audioListener);
    this.sounds.surface.setBuffer(audioBuffers.surface);
    this.sounds.surface.setLoop(true);
    this.sounds.surface.setVolume(this.params.audio.volumes.surface);

    this.sounds.underwater = new THREE.Audio(this.audioListener);
    this.sounds.underwater.setBuffer(audioBuffers.underwater);
    this.sounds.underwater.setLoop(true);
    this.sounds.underwater.setVolume(this.params.audio.volumes.underwater);

    // Musical continuo
    this.sounds.music = new THREE.Audio(this.audioListener);
    this.sounds.music.setBuffer(audioBuffers.music);
    this.sounds.music.setLoop(true);
    this.sounds.music.setVolume(this.params.audio.volumes.music);

  this.sounds.lanchas = new THREE.Audio(this.audioListener);
  this.sounds.lanchas.setBuffer(audioBuffers.lanchas);
  this.sounds.lanchas.setLoop(true);
  this.sounds.lanchas.setVolume(this.params.audio.volumes.lanchas);

    // Filtro lowpass para el tema continuo
    const audioContext = this.audioListener.context;
    this.lowpassFilter = audioContext.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    // arranca totalmente abierto (fuera del agua)
    this.lowpassFilter.frequency.setValueAtTime(this.params.audio.eq.aboveHz, audioContext.currentTime);
    this.sounds.music.setFilter(this.lowpassFilter);

  this.lowpassFilterLanchas = audioContext.createBiquadFilter();
  this.lowpassFilterLanchas.type = 'lowpass';
  this.lowpassFilterLanchas.frequency.setValueAtTime(this.params.audio.eq.aboveHz, audioContext.currentTime);
  this.sounds.lanchas.setFilter(this.lowpassFilterLanchas);

    // SFX (no loop)
    this.sounds.sfxCatch = new THREE.Audio(this.audioListener);
    this.sounds.sfxCatch.setBuffer(audioBuffers.sfxCatch);
    this.sounds.sfxCatch.setLoop(false);
    this.sounds.sfxCatch.setVolume(this.params.audio.volumes.sfxCatch);

    this.sounds.sfxWrong = new THREE.Audio(this.audioListener);
    this.sounds.sfxWrong.setBuffer(audioBuffers.sfxWrong);
    this.sounds.sfxWrong.setLoop(false);
    this.sounds.sfxWrong.setVolume(this.params.audio.volumes.sfxWrong);

    this.sounds.sfxCompleted = new THREE.Audio(this.audioListener);
    this.sounds.sfxCompleted.setBuffer(audioBuffers.sfxCompleted);
    this.sounds.sfxCompleted.setLoop(false);
    this.sounds.sfxCompleted.setVolume(this.params.audio.volumes.sfxCompleted);

    this.audioState.ambientUnder = undefined;
    this.audioState.eqUnderPrev  = undefined;

    // === Todo cargado: cambiar overlay a texto real y arrancar intro + audio ===
    await this._trackLoadingStep('Finalizando carga y preparando intro/audio', async () => {
      if (this.app?.canvas) this.app.canvas.style.visibility = 'visible';
    });
    this._hideLoadingOverlay();


    if (this.params.intro?.enabled) {
      // Texto final de intro
      const P = this.params.intro;
      this._setIntroOverlayText(P.text || '');

      // Activar intro (pre → move → post)
      this.introState.active = true;
      this.introState.phase = 'pre';
      this.introState.t0 = performance.now() * 0.001;
    }

    // Iniciar audio de forma automática (sin exigir click)
    // Música siempre en loop
    if (!this.sounds.music.isPlaying) this.sounds.music.play();
  if (!this.sounds.lanchas.isPlaying) this.sounds.lanchas.play();

    // Poner el filtro/vol acorde a la posición actual
    this._updateAmbient(true); // arranca el loop correcto (arriba/abajo) con offsets adecuados
    this._updateAudio(0);      // fija EQ/vol iniciales

    if (!this.params.intro?.enabled) {
      this._startTimer();
    }

  }

  async unmount() {

    for (const key in this.sounds) {
      if (this.sounds[key] && this.sounds[key].isPlaying) {
        this.sounds[key].stop();
      }
    }

    if (this.deck && this._onDeckWheel) {
      this.deck.container.removeEventListener('wheel', this._onDeckWheel);
    }
    if (this.deck && this._deckMouseEnter) {
      this.deck.container.removeEventListener('mouseenter', this._deckMouseEnter);
      this.deck.container.removeEventListener('mouseleave', this._deckMouseLeave);
    }
    this._deckMouseEnter = null;
    this._deckMouseLeave = null;

    this.app.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.app.canvas.removeEventListener('mouseleave', this._onMouseLeave);
    this.app.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('keydown', this._onKeyDown);
    this._appPauseListener?.();
    this._appResumeListener?.();
    this._appPauseListener = null;
    this._appResumeListener = null;
    this.app.canvas.removeEventListener('wheel', this._onWheel);
    if (this.deck) this.deck.destroy();
    if (this.factOverlay) this.factOverlay.destroy();
    if (this.completedOverlay) {
      this.completedOverlay.destroy();
      this.completedOverlay = null;
    }
    this._completedOverlayState = { activeKey: null, loading: false };
    this.disposeVegetation();
    this.disposeMistLayer();
    this._destroyRuler();
    this._destroyIntroOverlay();
    this._destroyTimerOverlay();
    this._destroyCursorOverlay();
    this._destroyDeckTagHint();
    this._destroyTagProgressOverlay();
  this._destroySurfaceVideoFX();

    this.disposeShoreHaze();
    this.disposeShoreVegBackground();
    this.disposeShoreVegBackground2();

    for (const agent of this.fish) {
      if (agent.tracker) {
        agent.tracker.material?.dispose?.();
        agent.mesh.remove(agent.tracker);
        agent.tracker = null;
      }
    }
    if (this._trackerTexture) {
      this._trackerTexture.dispose();
      this._trackerTexture = null;
      this._trackerTextureConfig = null;
    }


    // Inside-solid overlay cleanup
    if (this._insideOverlay && this._insideOverlay.parentNode) {
      this._insideOverlay.parentNode.removeChild(this._insideOverlay);
    }
    this._insideOverlay = null;

    // Restore original cursor
    if (this.app?.canvas && this._originalCanvasCursor !== null) {
      this.app.canvas.style.cursor = this._originalCanvasCursor;
    }
  }

  /* ------------------------------- Model helpers ------------------------------- */

  recenterToFloor(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    obj.position.y -= box.min.y - obj.position.y;
  }

  scaleModelToLongest(obj, target) {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (longest > 0) obj.scale.multiplyScalar(target / longest);
  }

  widthAlongDirectionWorld(obj, dir) {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return 0;
    const min = box.min, max = box.max;
    const corners = [
      new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z),
      new THREE.Vector3(min.x, max.y, min.z), new THREE.Vector3(max.x, max.y, min.z),
      new THREE.Vector3(min.x, min.y, max.z), new THREE.Vector3(max.x, min.y, max.z),
      new THREE.Vector3(min.x, max.y, max.z), new THREE.Vector3(max.x, max.y, max.z),
    ];
    let a = +Infinity, b = -Infinity;
    for (const c of corners) { const p = c.dot(dir); if (p < a) a = p; if (p > b) b = p; }
    return (b - a);
  }

  /* ------------------------------------ Tiling ------------------------------------ */

  rebuildTiles() {
    if (!this.model) return;
    for (let i = this.tilesGroup.children.length - 1; i >= 0; i--) {
      this.tilesGroup.remove(this.tilesGroup.children[i]);
    }
    this.scene.updateMatrixWorld(true);

    const right = this.tmpRight.copy(this.forward).cross(this.tmpUp).normalize();
    const baseWidth = this.widthAlongDirectionWorld(this.model, right);
    const gap = (this.params.tiling.gap ?? 0) * (this.params.tiling.gapMultiplier ?? 1);
    const tileStep = baseWidth + gap;

    const anchor = this.model.getWorldPosition(new THREE.Vector3());
    const n = this.params.tiling.countEachSide;
    for (let i = 1; i <= n; i++) {
      const offsetR = right.clone().multiplyScalar(+i * tileStep);
      const offsetL = right.clone().multiplyScalar(-i * tileStep);
      const r = this.model.clone(true); r.position.copy(anchor).add(offsetR); this.tilesGroup.add(r);
      const l = this.model.clone(true); l.position.copy(anchor).add(offsetL); this.tilesGroup.add(l);
    }
  }

  /* ------------------------------------- Water ------------------------------------ */

  buildOrUpdateWaterSurface() {
    const y = this.params.surfaceLevel;

    // Decide how wide the surface plane should be (cover visible area comfortably).
    // We extend across the tiled width (right-left) and forward span of the base model.
    const right = this.tmpRight.copy(this.forward).cross(this.tmpUp).normalize();
    const baseWidthRight = this.widthAlongDirectionWorld(this.model || new THREE.Object3D(), right);
    const n = this.params.tiling.countEachSide;
    const gap = (this.params.tiling.gap ?? 0) * (this.params.tiling.gapMultiplier ?? 1);
    const tileStep = baseWidthRight + gap;
    const totalRightSpan = Math.max(0.01, baseWidthRight + 2 * n * tileStep);

    const fwd = this.forward.clone().normalize();
    const baseWidthForward = Math.max(0.01, this.widthAlongDirectionWorld(this.model || new THREE.Object3D(), fwd));

    // Oclusor volumétrico (Plane instead of Box to avoid Z-fighting with its own faces)
    if (!this.waterOccluder || this.waterOccluder.geometry.type === 'BoxGeometry') {
      if (this.waterOccluder) {
        this.scene.remove(this.waterOccluder);
        this.waterOccluder.geometry?.dispose();
        this.waterOccluder.material?.dispose();
      }
      const occGeo = new THREE.PlaneGeometry(1, 1); occGeo.rotateX(Math.PI/2); // Facing down
      const occMat = new THREE.MeshBasicMaterial({
        colorWrite: false,    // <- NO escribe color
        depthWrite: true,     // <- SÍ escribe z
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
        side: THREE.FrontSide
      });
      this.waterOccluder = new THREE.Mesh(occGeo, occMat);
      this.waterOccluder.frustumCulled = false;
      this.waterOccluder.renderOrder = -10; // que se dibuje antes que todo
      this.scene.add(this.waterOccluder);
    }

    // Make the surface much larger to ensure it hits the fog far plane
    const sx = Math.max(totalRightSpan * 2.0, 1000);
    const sz = Math.max(baseWidthForward * 5.0, 1000);
    const yTop = this.params.surfaceLevel;

    // Place the depth-only occluder slightly ABOVE the surface so it is
    // always visible from below (FrontSide faces down) even when the camera
    // is just a few centimeters under the surface.
    // This avoids the “gray band” that appears when the camera is between the
    // surface and an occluder placed below it.
    this.waterOccluder.position.set(100, yTop + 0.02, 0);
    this.waterOccluder.scale.set(sx, sz, 1);

    // Superficie visible (opcional, solo cara superior, sin “segunda tapa”)
    if (!this.waterSurface) {
      const surfGeo = new THREE.PlaneGeometry(1, 1); surfGeo.rotateX(-Math.PI/2);
      const surfMat = new THREE.MeshPhysicalMaterial({
        color: this.params.waterColor,
        transparent: false,
        roughness: 0.9, metalness: 0.0,
        side: THREE.FrontSide, // solo desde arriba
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        depthWrite: true, depthTest: true,
        fog: true
      });
      this.waterSurface = new THREE.Mesh(surfGeo, surfMat);
      this.waterSurface.frustumCulled = false;
      this.scene.add(this.waterSurface);
    }
    this.waterSurface.position.set(100, yTop, 0);
    this.waterSurface.scale.set(sx, 1, sz);

    // Superficie inferior (brillante desde abajo)

    if (!this.waterSurfaceBottom) {
      const surfGeoBottom = new THREE.PlaneGeometry(1, 1); surfGeoBottom.rotateX(Math.PI/2);
      // Blend sky color with white for a less saturated, brighter look
      const blended = this.getUnderwaterSurfaceColor();
      const surfMatBottom = new THREE.MeshLambertMaterial({
        color: blended,
        emissive: blended,
        emissiveIntensity: 0.4,
        transparent: false, // Opaque to avoid seeing the occluder/void behind it
        side: THREE.FrontSide, // facing down
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        depthWrite: true,
        depthTest: true,
        fog: true
      });
      this.waterSurfaceBottom = new THREE.Mesh(surfGeoBottom, surfMatBottom);
      this.waterSurfaceBottom.frustumCulled = false;
      this.scene.add(this.waterSurfaceBottom);
    }
    // Keep the underside surface very close to the surface so that when the
    // camera is slightly below the surface it still sees a valid surface
    // instead of the clear/fogged background.
    this.waterSurfaceBottom.position.set(100, yTop - 0.01, 0);
    this.waterSurfaceBottom.scale.set(sx, 1, sz);

  }

  /**
   * Returns the color used for the water surface as seen from below.
   * Blends sky color with white for a less saturated, brighter look.
   */
  getUnderwaterSurfaceColor() {
    const skyColor = new THREE.Color(this.params.skyColor || 0xF6B26B);
    const white = new THREE.Color(0xffffff);
    // Blend 85% sky, 15% white, then dim it to 50% brightness
    return skyColor.clone().lerp(white, 0.15).multiplyScalar(0.5);
  }

  updateFog() {
    const { surfaceLevel, waterColor, fogNear, fogFar, aboveFog } = this.params;
    const y = this.camera.position.y;

    // Hysteresis to avoid flicker at the crossing:
    const eps = aboveFog?.surfaceHysteresis ?? 0.0;
    let isUnder;
    if (this._fogUnderPrev === true)  isUnder = (y < surfaceLevel + eps);
    else if (this._fogUnderPrev === false) isUnder = (y < surfaceLevel - eps);
    else isUnder = (y < surfaceLevel);

    // UNDERWATER: use your existing water-colored fog
    if (isUnder) {
      if (!this.scene.fog) this.scene.fog = new THREE.Fog(waterColor, fogNear, fogFar);
      else {
        this.scene.fog.color.set(waterColor);
        this.scene.fog.near = fogNear;
        this.scene.fog.far  = fogFar;
      }
    } else {
      // ABOVE WATER: gray-ish fog with independent params
      if (aboveFog?.enabled) {
        if (aboveFog.useExp2) {
          if (!(this.scene.fog instanceof THREE.FogExp2)) {
            this.scene.fog = new THREE.FogExp2(aboveFog.color, aboveFog.density ?? 0.01);
          } else {
            this.scene.fog.color.set(aboveFog.color);
            this.scene.fog.density = aboveFog.density ?? 0.01;
          }
        } else {
          if (!(this.scene.fog instanceof THREE.Fog)) {
            this.scene.fog = new THREE.Fog(aboveFog.color, aboveFog.near ?? 10, aboveFog.far ?? 120);
          } else {
            this.scene.fog.color.set(aboveFog.color);
            this.scene.fog.near = aboveFog.near ?? 10;
            this.scene.fog.far  = aboveFog.far ?? 120;
          }
        }
      } else {
        this.scene.fog = null;
      }
    }

    this._fogUnderPrev = isUnder;
  }


  _createIntroOverlay() {
    const P = this.params.intro;
    const el = document.createElement('div');
    el.id = 'intro-overlay';
    Object.assign(el.style, {
      position: 'fixed',
      left: 0, top: 0, right: 0, bottom: 0,
      display: 'flex',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      msUserSelect: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: 9999,
      fontFamily: '"new-science", "New Science", system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      fontWeight: '600',
      lineHeight: '1.35',
      color: 'white',
      textShadow: '0 2px 16px rgba(0,0,0,0.6)',
      background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.1))',
      opacity: '0',
      // importante: declarar explícitamente las partes de transition
      transitionProperty: 'opacity',
      transitionTimingFunction: 'ease',
      transitionDuration: `${P.fadeIn}s`,
      willChange: 'opacity'
    });
    const textEl = document.createElement('div');
    textEl.id = 'intro-overlay-text';
    Object.assign(textEl.style, {
      width: '100%',
      maxWidth: '720px',
      padding: '0 4vw',
      textAlign: 'center',
      whiteSpace: 'pre-line',
      margin: '0 auto'
    });
    textEl.textContent = P.text || 'Cargando...';
    el.appendChild(textEl);
    document.body.appendChild(el);
    this.introState.overlayEl = el;
    this.introState.overlayTextEl = textEl;

    this._updateIntroOverlayLayout();
    this._onIntroResize = () => this._updateIntroOverlayLayout();
    window.addEventListener('resize', this._onIntroResize, { passive: true });

    // ---- Disparo de fade-in a prueba de WebKit/Chrome ----
    // 1) Forzar reflow para que el estado "opacity:0" se fije realmente
    // eslint-disable-next-line no-unused-expressions
    el.getBoundingClientRect();

    // 2) Usar doble rAF para garantizar que el transition esté armado
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.opacity = '1';
      });
    });
  }

  _setIntroOverlayText(msg) {
    if (this.introState.overlayTextEl) {
      this.introState.overlayTextEl.textContent = msg;
    }
  }

  _fadeOutIntroOverlay() {
    const el = this.introState.overlayEl;
    if (!el) return;
    const P = this.params.intro;
    el.style.transition = `opacity ${P.fadeOut}s ease`;
    el.style.opacity = '0';
  }

  _destroyIntroOverlay() {
    const el = this.introState.overlayEl;
    if (this._onIntroResize) {
      window.removeEventListener('resize', this._onIntroResize);
      this._onIntroResize = null;
    }
    if (el && el.parentNode) el.parentNode.removeChild(el);
    this.introState.overlayEl = null;
    this.introState.overlayTextEl = null;
  }

  _updateIntroOverlayLayout() {
    const textEl = this.introState.overlayTextEl;
    if (!textEl) return;

    const vw = Math.max(1, window.innerWidth || 1);
    const vh = Math.max(1, window.innerHeight || 1);
    const base = Math.min(vw, vh);
    const fontPx = THREE.MathUtils.clamp(base * 0.035, 18, 46);

    textEl.style.fontSize = `${Math.round(fontPx)}px`;
    textEl.style.maxWidth = `${Math.round(Math.min(vw * 0.8, 720))}px`;
  }

  /** Compute ruler width from vw margins and set horizontal placement. */
  _updateRulerLayout() {
    if (!this.ruler?.el || !this.params.rulerUI?.enabled) return;
    const R = this.params.rulerUI;

    const vw = Math.max(1, window.innerWidth || 1);
    const vh = Math.max(1, window.innerHeight || 1);

    const leftPx  = Math.round((R.leftMarginVw ?? 0.02) * vw);

    const natW = Math.max(1, this.ruler.naturalW || 1);
    const natH = Math.max(1, this.ruler.naturalH || 1);
    const aspect = natW / natH;
    const visiblePortion = THREE.MathUtils.clamp(R.visiblePortionAtBottom ?? 0.5, 0.05, 1);
    const displayH = Math.round(vh / visiblePortion);
    const displayW = Math.round(displayH * aspect);

    // pin horizontally
    Object.assign(this.ruler.el.style, {
      left: `${leftPx}px`,
      width: `${displayW}px`,
      height: `${displayH}px`
    });

    // cache current computed height for vertical mapping
    this.ruler.displayH = displayH;
    this.ruler.visiblePortion = visiblePortion;
    this.ruler.el.style.opacity = String(this.params.rulerUI.opacity ?? 1);
  }

  /** Map camera Y to the vertical 'top' of the ruler element. */
  _updateRulerPosition() {
    if (!this.ruler?.el || !this.params.rulerUI?.enabled) return;

    const vh = Math.max(1, window.innerHeight || 1);
    const imgH = Math.max(1, this.ruler.displayH || this.ruler.el.getBoundingClientRect().height || 1);

    // camera Y normalization (0 = highest, 1 = lowest)
    const yMax = this.params.surfaceLevel + this.params.cameraSurfaceMargin;
    const yMin = this.params.floorLevel   + this.params.cameraFloorMargin;
    const cy   = this.camera.position.y;
    const t = THREE.MathUtils.clamp((yMax - cy) / Math.max(1e-6, (yMax - yMin)), 0, 1);

    const topAnchorVh = THREE.MathUtils.clamp(this.params.rulerUI.topAnchorVh ?? 0.4, 0, 1.2);
    const topAtTop = Math.round(vh * topAnchorVh);
    const topAtBottom = Math.round(vh - imgH);

    const topPx = Math.round(THREE.MathUtils.lerp(topAtTop, topAtBottom, t));

    this.ruler.el.style.top = `${topPx}px`;
  }

  /** Remove the ruler element safely. */
  _destroyRuler() {
    if (this._onRulerResize) {
      window.removeEventListener('resize', this._onRulerResize);
      this._onRulerResize = null;
    }
    if (this.ruler?.el && this.ruler.el.parentNode) {
      this.ruler.el.parentNode.removeChild(this.ruler.el);
    }
    this.ruler = null;
  }

  /* ========================= Tag Progress Bar (DOM) ========================= */

  _createTagProgressOverlay() {
    if (this._tagProgress?.container) return;

    const container = document.createElement('div');
    container.id = 'rio-tag-progress';
    Object.assign(container.style, {
      position: 'fixed',
      left: '40px',
      top: '40px',
      width: '20vw',
      padding: '10px 14px',
      background: 'rgba(10, 34, 61, 0.6)',
      borderRadius: '12px',
      backdropFilter: 'blur(4px)',
      display: 'none',
      flexDirection: 'column',
      gap: '0px',
      pointerEvents: 'none',
      zIndex: '9996',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      msUserSelect: 'none'
    });

    const barContainer = document.createElement('div');
    Object.assign(barContainer.style, {
      width: '100%',
      height: 'clamp(18px, 1.6vw, 26px)',
      background: 'rgba(0, 0, 0, 0.4)',
      borderRadius: '6px',
      overflow: 'hidden',
      position: 'relative'
    });
    container.appendChild(barContainer);

    const barFill = document.createElement('div');
    Object.assign(barFill.style, {
      width: '0%',
      height: '100%',
      background: (this.params?.deckUI?.colors?.silhouetteSelected || '#FFD400'),
      transition: 'width 0.3s ease-out, background-color 0.25s ease-out'
    });
    barContainer.appendChild(barFill);

    const barText = document.createElement('div');
    barText.textContent = 'Progreso 0%';
    Object.assign(barText.style, {
      position: 'absolute',
      inset: '0',
      display: 'grid',
      placeItems: 'center',
      color: '#f8fafc',
      fontSize: 'clamp(11px, 1.0vw, 16px)',
      fontWeight: '700',
      lineHeight: '1',
      textShadow: '0 2px 8px rgba(0,0,0,0.55)',
      pointerEvents: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      msUserSelect: 'none'
    });
    const fontFamily = this.params?.deckUI?.fonts?.family;
    if (fontFamily) {
      barText.style.fontFamily = fontFamily;
    }
    barContainer.appendChild(barText);

    document.body.appendChild(container);

    this._tagProgress.container = container;
    this._tagProgress.labelEl = barText;
    this._tagProgress.barFillEl = barFill;
    this._tagProgress.completed = false;
  }

  _updateTagProgressOverlay(snapshot = null) {
    if (!this._tagProgress?.barFillEl || !this._tagProgress?.labelEl) return;

    const s = snapshot || (this.deck?.getProgressSnapshot ? this.deck.getProgressSnapshot() : null);
    const pct = Math.max(0, Math.min(100, Math.round((s?.progress ?? 0) * 100)));
    this._tagProgress.barFillEl.style.width = `${pct}%`;
    this._tagProgress.labelEl.textContent = `Progreso ${pct}%`;

    const isComplete = pct >= 100;
    if (isComplete !== this._tagProgress.completed) {
      this._tagProgress.completed = isComplete;
      this._tagProgress.barFillEl.style.background = isComplete ? '#00FF6A' : (this.params?.deckUI?.colors?.silhouetteSelected || '#FFD400');
    }
  }

  _destroyTagProgressOverlay() {
    if (this._tagProgress?.container && this._tagProgress.container.parentNode) {
      this._tagProgress.container.parentNode.removeChild(this._tagProgress.container);
    }
    if (this._tagProgress) {
      this._tagProgress.container = null;
      this._tagProgress.labelEl = null;
      this._tagProgress.barFillEl = null;
      this._tagProgress.completed = false;
    }
  }

    /* ========================= Timer Overlay (DOM) ========================= */

  _createTimerOverlay() {
    if (this.timer?.el) return;
    const T = this.params.timerUI;

    // Wrapper
    const wrap = document.createElement('div');
    wrap.id = 'rio-timer-wrap';
    Object.assign(wrap.style, {
      position: 'fixed',
      right: '0px',
      bottom: '0px',
      width: '0px',
      height: 'auto',
      pointerEvents: 'none',
      zIndex: String(T.zIndex ?? 9996),
      visibility: 'hidden'
    });

    // Background image
    const img = document.createElement('img');
    img.id = 'rio-timer-img';
    img.src = T.src;
    Object.assign(img.style, {
      display: 'block',
      width: '100%',
      height: 'auto',
      pointerEvents: 'none'
    });
    wrap.appendChild(img);

    // Numbers overlay
    const txt = document.createElement('div');
    txt.id = 'rio-timer-text';
    Object.assign(txt.style, {
      position: 'absolute',
      left: '0', top: '0', right: '0', bottom: '0',
      display: 'grid',
      placeItems: 'center',
      color: T.textColor || '#FFD400',
      fontFamily: T.fontFamily || this.params.deckUI?.fonts?.family || 'monospace',
      fontWeight: '800',
      lineHeight: '1',
      letterSpacing: '0',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      msUserSelect: 'none',
      pointerEvents: 'none',
      textShadow: '0 2px 8px rgba(0,0,0,0.55)'
    });
    txt.textContent = '00:00:00:00';
    wrap.appendChild(txt);

    document.body.appendChild(wrap);
    this.timer.el = wrap;
    this.timer.imgEl = img;
    this.timer.textEl = txt;

    // Preload natural size then layout
    const probe = new Image();
    probe.onload = () => {
      this.timer.natW = probe.naturalWidth || 1;
      this.timer.natH = probe.naturalHeight || 1;
      this._updateTimerLayout();
      wrap.style.visibility = 'visible';
    };
    probe.src = T.src;

    // Resize binding
    this._onTimerResize = () => this._updateTimerLayout();
    window.addEventListener('resize', this._onTimerResize, { passive: true });
  }

  _destroyTimerOverlay() {
    if (this._onTimerResize) {
      window.removeEventListener('resize', this._onTimerResize);
      this._onTimerResize = null;
    }
    if (this.timer?.el && this.timer.el.parentNode) {
      this.timer.el.parentNode.removeChild(this.timer.el);
    }
    this.timer.el = this.timer.imgEl = this.timer.textEl = null;
  }

  _updateTimerLayout() {
    if (!this.timer?.el || !this.params.timerUI) return;
    const T = this.params.timerUI;

    const vh = Math.max(1, window.innerHeight || 1);
    const deckRect = this.deck?.container?.getBoundingClientRect?.();
    const heightBasis = Math.max(1, deckRect?.height || vh);

    const dispW = Number.isFinite(T.widthPx)
      ? Math.max(1, T.widthPx)
      : Math.max(1, Math.round((Number.isFinite(T.widthVh) ? T.widthVh : 0.215) * heightBasis));

    const aspect = (this.timer.natW > 0 && this.timer.natH > 0)
      ? (this.timer.natW / this.timer.natH)
      : (3 / 2);
    const dispH = Math.max(1, Math.round(dispW / aspect));

    const rightPx = Number.isFinite(T.xMarginPx)
      ? Math.max(0, T.xMarginPx)
      : Math.max(0, Math.round((Number.isFinite(T.xMarginVh) ? T.xMarginVh : 0) * heightBasis));

    const bottomPx = (() => {
      if (Number.isFinite(T.yMarginPx)) return Math.max(0, T.yMarginPx);
      return Math.max(0, Math.round((T.yMarginVh ?? 0.04) * vh));
    })();
    Object.assign(this.timer.el.style, {
      right: `${rightPx}px`,
      bottom: `${bottomPx}px`,
      width: `${dispW}px`,
      height: `${dispH}px`,
      boxSizing: 'border-box'
    });

    // Texto: ocupar TODO el ancho/alto y luego aplicar escala multiplicativa
    const targetW = dispW;
    const targetH = dispH;
    const el = this.timer.textEl;

    el.style.whiteSpace = 'nowrap';
    el.style.lineHeight = '1';
    el.style.transform = 'none';
    el.style.width = 'auto';
    el.style.height = 'auto';

    const sample = '00:00:00:00';
    el.textContent = sample;

    // Búsqueda binaria del font-size máximo que entra en targetW x targetH
    let lo = 4;
    let hi = targetH; // no puede exceder el alto de la caja
    let best = lo;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      el.style.fontSize = `${mid}px`;

      // Medición del contenido real
      const w = el.scrollWidth;
      const h = el.scrollHeight;

      if (w <= targetW && h <= targetH) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // Aplicar escala multiplicativa sobre el máximo encontrado
    const scale = Number.isFinite(T.textScale) ? T.textScale : 1.0;
    // Si scale > 1 podría pasarse; clamp al máximo que entra
    const finalSize = Math.floor(Math.min(best, best * Math.max(0.01, scale)));
    el.style.fontSize = `${finalSize}px`;
    // Centrado ya lo hace el grid del contenedor; no necesitamos transforms extra
  }



  _startTimer() {
    this.timer.t0 = performance.now() * 0.001;
    this.timer.running = true;
    this._updateTimerText(); // immediate paint
    this._cursorEnabled = true;
    this._updateCursorVisibility();

    // Show tag progress only when gameplay starts (after intro)
    if (this.deck && this._tagProgress?.container) {
      this._tagProgress.container.style.display = 'flex';
    }
  }

  _stopTimer() {
    this.timer.running = false;
    this._cursorEnabled = false;
    this._updateCursorVisibility();
  }

  _updateTimerText() {
    if (!this.timer?.running || !this.timer?.textEl) return;
    const t = Math.max(0, performance.now() * 0.001 - (this.timer.t0 || 0));

    const hours = Math.floor(t / 3600);
    const mins  = Math.floor((t % 3600) / 60);
    const secs  = Math.floor(t % 60);
    const cs    = Math.floor((t * 100) % 100); // centiseconds

    const pad2 = (n) => String(n).padStart(2, '0');

    // Format HH:MM:SS:CC
    const text = `${pad2(hours)}:${pad2(mins)}:${pad2(secs)}:${pad2(cs)}`;
    this.timer.textEl.textContent = text;
  }

  /* ========================= Cursor Overlay (DOM) ========================= */

  _createCursorOverlay() {
    if (this.cursorEl) return;
    const C = this.params.cursorUI;

    const img = document.createElement('img');
    img.id = 'rio-cursor';
    img.src = C.src; // static cursor when idle
    Object.assign(img.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      transform: `translate(-50%, -50%) scale(${C.scale ?? 1.0})`,
      transformOrigin: '50% 50%',
      pointerEvents: 'none',
      zIndex: String(C.zIndex ?? 100000),
      userSelect: 'none',
      WebkitUserSelect: 'none',
      msUserSelect: 'none'
    });
    img.style.visibility = 'hidden';
    document.body.appendChild(img);
    this.cursorEl = img;
    this._updateCursorVisibility();
  }

    // --- NEW: Generic frame-sequence preloader ---
  // Tries sequential filenames prefix + zeroPad(i, pad) until first failure AFTER at least one success.
  // Stops early if exceeds maxProbe to avoid infinite loops.
  async _preloadFrameSequence(dir, prefix, pad, startIndex, maxProbe = 1200) {
    const frames = [];
    const zeroPad = (n, w = 0) => String(n).padStart(Math.max(0, w), '0');
    const batchSize = 8;
    const firstIndex = Number.isFinite(startIndex) ? startIndex : 0;
    const maxAttempts = Math.max(0, maxProbe | 0);

    let nextIndex = firstIndex;
    let attempts = 0;
    let keepLoading = true;

    const loadSingle = (idx) => new Promise((resolve) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => resolve({ ok: true, img: im, index: idx });
      im.onerror = () => resolve({ ok: false, index: idx });

      // Encode ONLY the filename portion so spaces and '+' are safe on all servers/CDNs.
      const filename = `${prefix}${zeroPad(idx, pad)}.png`;
      im.src = `${dir}/${encodeURIComponent(filename)}`;
    });

    while (keepLoading && attempts < maxAttempts) {
      const batch = [];
      for (let b = 0; b < batchSize && attempts < maxAttempts; b++, attempts++) {
        batch.push(nextIndex++);
      }
      if (!batch.length) break;

      const results = await Promise.all(batch.map(loadSingle));
      for (const res of results) {
        if (res.ok) {
          frames.push(res.img);
        } else {
          keepLoading = false;
          if (frames.length === 0) {
            // Ensure we return [] if we never loaded a frame successfully
            frames.length = 0;
          }
          break;
        }
      }

      // Stop early if the last batch had a failure
      if (!keepLoading) break;
    }

    return frames;
  }

  async _loadSpriteSheet(config = {}) {
    const {
      sheetSrc,
      columns = 1,
      rows = 1,
      frameCount,
      frameDuration,
      fps
    } = config;

    if (!sheetSrc) return null;

    const image = await new Promise((resolve, reject) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => resolve(im);
      im.onerror = (err) => reject(err);
      im.src = sheetSrc;
    }).catch((err) => {
      console.warn('Failed to load radar spritesheet', sheetSrc, err);
      return null;
    });

    if (!image) return null;

    const cols = Math.max(1, Number(columns) || 1);
    const rowsSafe = Math.max(1, Number(rows) || 1);
    const frameW = Math.round(image.naturalWidth / cols);
    const frameH = Math.round(image.naturalHeight / rowsSafe);
    const maxFrames = cols * rowsSafe;
    const totalFrames = Math.min(
      Math.max(1, Number(frameCount) || maxFrames),
      maxFrames
    );
    const fpsSafe = Math.max(1, Number(fps) || 30);
    const duration = (Number(frameDuration) > 0) ? frameDuration : (1 / fpsSafe);

    return {
      kind: 'sheet',
      sheetSrc,
      image,
      columns: cols,
      rows: rowsSafe,
      frameWidth: frameW,
      frameHeight: frameH,
      sheetWidth: image.naturalWidth,
      sheetHeight: image.naturalHeight,
      totalFrames,
      frameDuration: duration
    };
  }

  // --- NEW: start cursor click anim at a given screen position (clientX, clientY) ---
  _startCursorClick(clientX, clientY) {
    if (!this.cursorEl || !this._cursorAnim.frames?.length) return;

    // “snap” inicial al punto de click (después seguirá al mouse en onMouseMove)
    this.cursorEl.style.left = `${clientX}px`;
    this.cursorEl.style.top  = `${clientY}px`;

    this._cursorAnim.playing = true;
    this._cursorAnim.idx = 0;

    // primer frame inmediato
    const frame0 = this._cursorAnim.frames[0];
    this.cursorEl.src = frame0.src;
  }


  // --- NEW: advance one frame per update; when finished, restore static cursor ---
  _updateCursorAnim(dt = 0) {
    const C = this.params.cursorUI;
    if (!this.cursorEl || !this._cursorAnim.playing) return;

    const frames = this._cursorAnim.frames;
    if (!frames?.length) { this._cursorAnim.playing = false; return; }

    // Use dt for frame-rate independent animation (target ~30fps)
    this._cursorAnim.timeAccum = (this._cursorAnim.timeAccum || 0) + dt;
    const frameDuration = 1 / 30;

    if (this._cursorAnim.timeAccum < frameDuration) return;

    let changed = false;
    while (this._cursorAnim.timeAccum >= frameDuration) {
      this._cursorAnim.timeAccum -= frameDuration;
      this._cursorAnim.idx += 1;
      changed = true;

      if (this._cursorAnim.idx >= frames.length) {
        // terminó: volvemos al cursor estático
        this._cursorAnim.playing = false;
        this._cursorAnim.timeAccum = 0;
        this.cursorEl.src = C.src;
        return;
      }
    }

    if (changed) {
      const im = frames[this._cursorAnim.idx];
      if (im) {
        this.cursorEl.src = im.src;
      }
    }
  }



  _destroyCursorOverlay() {
    if (this.cursorEl && this.cursorEl.parentNode) {
      this.cursorEl.parentNode.removeChild(this.cursorEl);
    }
    this.cursorEl = null;
  }


  // --- NEW: create a DOM <img> for one radar animation instance ---
  _createRadarElement(x, y) {
    const R = this.params.radarUI;
    const anim = this._radarAnim;
    if (!anim) return null;

    const el = document.createElement(anim.kind === 'sheet' ? 'div' : 'img');
    Object.assign(el.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      transform: `translate(-50%, -50%) scale(${R.scale ?? 1.0})`,
      transformOrigin: '50% 50%',
      pointerEvents: 'none',
      zIndex: String(R.zIndex ?? 100001),
      userSelect: 'none',
      display: 'block'
    });

    if (anim.kind === 'sheet') {
      Object.assign(el.style, {
        width: `${anim.frameWidth}px`,
        height: `${anim.frameHeight}px`,
        backgroundImage: `url(${anim.sheetSrc})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: '0px 0px',
        backgroundSize: `${anim.sheetWidth}px ${anim.sheetHeight}px`
      });
    } else {
      el.src = (anim.frames && anim.frames[0]) ? anim.frames[0].src : '';
    }

    document.body.appendChild(el);
    return el;
  }

  // --- NEW: public trigger ---
  _playRadarAtScreen(clientX, clientY) {
    if (!this.params.radarUI?.enabled) return;
    if (!this._radarAnim?.totalFrames) return;

    const el = this._createRadarElement(clientX, clientY);
    if (!el) return;

    const instance = {
      idx: 0,
      x: clientX,
      y: clientY,
      el,
      totalFrames: this._radarAnim.totalFrames,
      timeAccum: 0
    };
    this._radars.push(instance);

    this._applyRadarFrame(instance, 0);
  }

  _applyRadarFrame(radarInstance, frameIndex) {
    const anim = this._radarAnim;
    if (!anim || !radarInstance?.el) return;

    if (anim.kind === 'sheet') {
      const idx = Math.min(frameIndex, anim.totalFrames - 1);
      const col = idx % anim.columns;
      const row = Math.floor(idx / anim.columns);
      const offsetX = -col * anim.frameWidth;
      const offsetY = -row * anim.frameHeight;
      radarInstance.el.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
    } else if (anim.kind === 'frames') {
      const frame = anim.frames?.[frameIndex];
      if (frame) {
        radarInstance.el.src = frame.src;
      }
    }
  }

  // --- NEW: step all active radars one frame per update; remove when done ---
  _updateRadars(dt = 0) {
    if (!this._radars?.length || !this._radarAnim) return;
    const frameDuration = this._radarAnim.frameDuration || (1 / 30);
    for (let i = this._radars.length - 1; i >= 0; i--) {
      const r = this._radars[i];
      r.timeAccum = (r.timeAccum ?? 0) + (dt || 0);

      if (r.timeAccum < frameDuration) continue;

      let changed = false;
      while (r.timeAccum >= frameDuration) {
        r.timeAccum -= frameDuration;
        r.idx += 1;
        changed = true;
        if (r.idx >= r.totalFrames) {
          r.el?.parentNode?.removeChild(r.el);
          this._radars.splice(i, 1);
          changed = false;
          break;
        }
      }
      if (changed) {
        this._applyRadarFrame(r, r.idx);
      }
    }
  }



  /* -------------------------------- Vegetation -------------------------------- */

  _initCompletedOverlay() {
    if (!this.params.completedOverlay?.enabled) return;
    if (this.completedOverlay) return;

    const overlayParams = this.params.completedOverlay;
    this.completedOverlay = new CompletedOverlay(overlayParams, {
      preloadSequence: (dir, prefix, pad, startIndex, maxProbe) =>
        this._preloadCompletedOverlaySequence(dir, prefix, pad, startIndex, maxProbe),
      fontFallback: this.params.deckUI?.fonts?.family || 'system-ui, sans-serif'
    });
    const prep = this.completedOverlay.prepare();
    if (prep && typeof prep.then === 'function') {
      prep
        .then(() => {
          if (this.completedOverlay) this.completedOverlay.updateLayout();
        })
        .catch(err => console.error('[RioScene] completed overlay preload failed', err));
    }
    this.completedOverlay.updateLayout();
  }

  _cancelCompletedOverlay() {
    if (this.completedOverlay) {
      this.completedOverlay.hide();
    }
    this._completedOverlayState.activeKey = null;
    this._completedOverlayState.loading = false;
  }

  _maybeTriggerCompletedOverlay(nowSec) {
    if (!this.params.completedOverlay?.enabled) return;
    if (!this.deck || !this.completedOverlay) return;

    const cards = this.deck.cards || [];
    const idx = this.deck.currentIndex ?? 0;
    const card = cards[idx];

    if (!card || !card.completed) {
      if (this._completedOverlayState.activeKey) this._cancelCompletedOverlay();
      return;
    }

    const delay = this.params.completedOverlay.delayAfterSelectSec ?? 1.0;
    if ((nowSec - this._deckSelectionTime) < delay) {
      if (this._completedOverlayState.activeKey) {
        // keep showing current overlay but do not trigger new one
        if (this._completedOverlayState.activeKey !== card.key) {
          this._cancelCompletedOverlay();
        }
      }
      return;
    }

    if (this._completedOverlayState.activeKey === card.key) return;
    if (this._completedOverlayState.loading) return;

  const speciesDef = SPECIES.find(s => s.key === card.key) || null;
  const displayName = card.fullDisplayName || speciesDef?.displayName || card.baseName || card.key;
    const imagePath = `/game-assets/sub/completed_fish_data/${card.key}.png`;
    const infoPath = `/game-assets/sub/completed_fish_data/${card.key}.txt`;

    this._completedOverlayState.loading = true;
    this.completedOverlay
      .loadSpeciesAssets(card.key, { imagePath, infoPath, displayName })
      .then(async (assets) => {
        if (this.deck?.cards[this.deck.currentIndex]?.key !== card.key) {
          return; // selection changed while loading
        }

        // Hide any caption immediately so it never overlaps the completed overlay UI.
        this.factOverlay?.hide?.({ immediate: false });

        await this.completedOverlay.activate({
          speciesKey: card.key,
          displayName: assets.displayName,
          imageSrc: assets.imageSrc,
          infoText: assets.infoText
        });
        this._completedOverlayState.activeKey = card.key;
      })
      .catch(err => {
        console.error('[RioScene] completed overlay activation failed', err);
      })
      .finally(() => {
        if (this._completedOverlayState.activeKey !== card.key) {
          this._completedOverlayState.activeKey = null;
        }
        this._completedOverlayState.loading = false;
      });
  }

  async initVegetation() {
    const V = this.params.vegetation;
    const defsFloor   = V?.floor   || {};
    const defsSurface = V?.surface || {};
    const defsShore   = V?.shore   || {};
    const yawRand     = !!V?.defaults?.yawRandom;
    const [sj0, sj1]  = V?.defaults?.scaleJitter || [1, 1];

    // -------- Floor plants (inside swimBox XZ, y = floorLevel + offset) --------
    for (const key of Object.keys(defsFloor)) {
      const def = defsFloor[key];
      const template = await this._loadTemplate(def.glb);
      const count = def.count|0;
      for (let i = 0; i < count; i++) {
        const pos = this._randomXZInBox(this.swimBox);
        const yOffset = Number.isFinite(def.yOffset) ? def.yOffset : (V.defaults.floorYOffset || 0);
        const mesh = template.clone(true);
        mesh.position.set(pos.x, this.params.floorLevel + yOffset, pos.z);
        if (yawRand) mesh.rotation.y = Math.random() * Math.PI * 2;
        this._applyVegetationScale(mesh, def, [sj0, sj1]);
        mesh.userData.vegType = 'floor';
        mesh.userData.speciesKey = key;

        this.vegGroup.add(mesh);
        this.vegetation.floor.push({ mesh });
      }
    }

    // -------- Surface plants (inside swimBox XZ, y = surfaceLevel + offset, DRIFT) --------
    for (const key of Object.keys(defsSurface)) {
      const def = defsSurface[key];
      const template = await this._loadTemplate(def.glb);
      const count = def.count|0;
      for (let i = 0; i < count; i++) {
        const center = this._randomXZInBox(this.swimBox);
        const yOffset = Number.isFinite(def.yOffset) ? def.yOffset : 0.0;

        const mesh = template.clone(true);
        // initial placement (center + tiny random angle)
        mesh.position.set(center.x, this.params.surfaceLevel + yOffset, center.z);
        if (yawRand) mesh.rotation.y = Math.random() * Math.PI * 2;
        this._applyVegetationScale(mesh, def, [sj0, sj1]);
        mesh.userData.vegType = 'surface';
        mesh.userData.speciesKey = key;

        // drift params
        const drift = def.drift || V.defaults.surfaceDrift || { radius: 0.8, speed: 0.12 };
        const radius = Math.max(0, drift.radius || 0);
        const speed  = Math.max(0, drift.speed  || 0.1);
        const phase  = Math.random() * Math.PI * 2;
        // angular speed in rad/sec = 2π * cycles/sec
        const w = speed * Math.PI * 2;

        this.vegGroup.add(mesh);
        this.vegetation.surface.push({
          mesh,
          center: new THREE.Vector3(center.x, 0, center.z), // center.y not needed; we recompute Y each frame
          driftR: radius,
          driftW: w,
          phase,
          yOffset
        });
      }
    }

    // -------- Shore plants (Z within swimBox; X near shoreLevel using +/- offsets, or absolute X if provided) --------
    for (const key of Object.keys(defsShore)) {
      const def = defsShore[key];
      const template = await this._loadTemplate(def.glb);
      const count = def.count|0;

      const minZ = this.params.leftLimit;
      const maxZ = this.params.rightLimit;
      const zSpan = maxZ - minZ;

      // Offsets can be negative; also allow swapped min/max
      let xMinOff = Number(def.xOffsetMin ?? 0);
      let xMaxOff = Number(def.xOffsetMax ?? xMinOff);
      if (xMaxOff < xMinOff) [xMinOff, xMaxOff] = [xMaxOff, xMinOff];

      const yOffset = Number.isFinite(def.yOffset) ? def.yOffset : 0;

      // Direction relative to shoreLevel
      const shoreSide = (this.params.vegetation?.shoreSide === 'positive') ? +1 : -1;

      // Optional absolute X range per species (overrides offsets if both present)
      const hasAbsRange = Number.isFinite(def.xAbsoluteMin) && Number.isFinite(def.xAbsoluteMax);
      let xAbsMin, xAbsMax;
      if (hasAbsRange) {
        xAbsMin = Math.min(def.xAbsoluteMin, def.xAbsoluteMax);
        xAbsMax = Math.max(def.xAbsoluteMin, def.xAbsoluteMax);
      }

      for (let i = 0; i < count; i++) {
        const z = minZ + Math.random() * zSpan;

        let x;
        if (hasAbsRange) {
          x = THREE.MathUtils.lerp(xAbsMin, xAbsMax, Math.random());
        } else {
          const off = THREE.MathUtils.lerp(xMinOff, xMaxOff, Math.random());
          x = this.params.shoreLevel + shoreSide * off;
        }

        const mesh = template.clone(true);
        mesh.position.set(x, this.params.surfaceLevel + yOffset, z);
        if (yawRand) mesh.rotation.y = Math.random() * Math.PI * 2;
        this._applyVegetationScale(mesh, def, [sj0, sj1]);
        mesh.userData.vegType = 'shore';
        mesh.userData.speciesKey = key;

        this.vegGroup.add(mesh);
        this.vegetation.shore.push({ mesh });
      }
    }

  }

  updateVegetation(dt) {
    // Surface plants drift around their centers and stay right above the current surface
    const surfY = this.params.surfaceLevel;
    const minX = this.swimBox.min.x, maxX = this.swimBox.max.x;
    const minZ = this.swimBox.min.z, maxZ = this.swimBox.max.z;

    for (const v of this.vegetation.surface) {
      v.phase += v.driftW * dt;
      const dx = Math.cos(v.phase) * v.driftR;
      const dz = Math.sin(v.phase * 0.85) * (v.driftR * 0.75); // slight ellipse for variety

      let x = v.center.x + dx;
      let z = v.center.z + dz;
      // clamp inside swimBox XZ
      x = clamp(x, minX, maxX);
      z = clamp(z, minZ, maxZ);

      v.mesh.position.set(x, surfY + v.yOffset, z);
    }
  }

  disposeVegetation() {
    if (!this.vegGroup) return;

    const all = [
      ...this.vegetation.floor,
      ...this.vegetation.surface,
      ...this.vegetation.shore
    ];
    for (const inst of all) {
      const root = inst.mesh;
      if (root?.parent) root.parent.remove(root);
      root?.traverse?.(node => {
        if (node.isMesh) {
          node.geometry?.dispose?.();
          const m = node.material;
          if (Array.isArray(m)) m.forEach(mm => mm?.dispose?.());
          else m?.dispose?.();
        }
      });
    }

    this.vegetation.floor.length = 0;
    this.vegetation.surface.length = 0;
    this.vegetation.shore.length = 0;
  }

  async _loadTemplate(glbPath) {
    try {
      const gltf = await AssetLoader.gltf(glbPath);
      return (gltf.scene || gltf.scenes?.[0] || new THREE.Group());
    } catch (e) {
      console.warn('Vegetation GLB failed to load:', glbPath, e);
      // simple fallback
      const mat = new THREE.MeshStandardMaterial({ color: 0x2a7b2a, roughness: 0.8, metalness: 0.05 });
      const geo = new THREE.ConeGeometry(0.25, 0.5, 6);
      return new THREE.Mesh(geo, mat);
    }
  }

  _applyVegetationScale(root, def, jitterRange) {
    const [j0, j1] = jitterRange || [1, 1];
    const jitter = THREE.MathUtils.lerp(j0, j1, Math.random());

    // If we have fitLongest/fitHeight, compute bbox-based uniform scale.
    const wantsFitLongest = Number.isFinite(def?.fitLongest);
    const wantsFitHeight  = Number.isFinite(def?.fitHeight);

    if (wantsFitLongest || wantsFitHeight) {
      try {
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());

        let base = 1;
        if (wantsFitLongest) {
          const longest = Math.max(size.x, size.y, size.z);
          if (longest > 1e-6) base = def.fitLongest / longest;
        } else if (wantsFitHeight) {
          if (size.y > 1e-6) base = def.fitHeight / size.y;
        }
        root.scale.multiplyScalar(base * jitter);
        return;
      } catch (e) {
        // fall through to simple scale if bbox fails for any reason
      }
    }

    // Fallback/simple: uniform base scale * jitter
    const baseScale = Number.isFinite(def?.scale) ? def.scale : 1;
    root.scale.multiplyScalar(baseScale * jitter);
  }


  _randomXZInBox(box) {
    const x = THREE.MathUtils.lerp(box.min.x, box.max.x, Math.random());
    const z = THREE.MathUtils.lerp(box.min.z, box.max.z, Math.random());
    return new THREE.Vector3(x, 0, z);
  }

  async buildOrUpdateShoreHaze() {
    const H = this.params.shoreHaze;
    if (!H?.enabled) { this.disposeShoreHaze(); return; }

    // Load / reuse texture
    if (!this._shoreHazeTex) {
      const tex = await AssetLoader.texture(H.src);
      const THREERef = THREE; // resolve string filters to actual constants
      tex.wrapS = THREE.ClampToEdgeWrapping; // clamp horizontally (Z)
      tex.wrapT = THREE.ClampToEdgeWrapping; // clamp vertically (Y)
      tex.anisotropy = H.anisotropy ?? 4;
      tex.minFilter = THREERef[H.minFilter] ?? THREE.LinearMipMapLinearFilter;
      tex.magFilter = THREERef[H.magFilter] ?? THREE.LinearFilter;
      this._shoreHazeTex = tex;
    }

    // Create material
    const mat = new THREE.MeshBasicMaterial({
      map: this._shoreHazeTex,
      color: new THREE.Color(H.color ?? 0xffffff),
      opacity: THREE.MathUtils.clamp(H.opacity ?? 1.0, 0, 1),
      transparent: true,
      depthWrite: !!H.depthWrite,
      depthTest: !!H.depthTest,
      side: (H.doubleSide ? THREE.DoubleSide : THREE.FrontSide),
      blending: THREE.NormalBlending
    });

    // Geometry: Plane spanning Z (width) by Y (height)
    const zSpan = (this.params.rightLimit - this.params.leftLimit) + 2 * (H.zPad ?? 0);
    const height = Math.max(0.05, H.height ?? 8.0);
    const geo = new THREE.PlaneGeometry(zSpan, height, 1, 1);
    // PlaneGeometry is XY facing +Z; rotate so width -> Z, normal -> +X (toward water)
    geo.rotateY(Math.PI / 2);

    // Mesh (replace if already exists)
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'shore-haze';
    mesh.renderOrder = 10; // draw after occluder/water; tweak if needed
    mesh.frustumCulled = true;

    // Store & add
    this.disposeShoreHaze();             // remove previous one if any
    this.shoreHazeMesh = mesh;
    this.scene.add(mesh);

    // Initial placement
    this.updateShoreHazeLayout();
  }

  updateShoreHazeLayout() {
    if (!this.shoreHazeMesh) return;
    const H = this.params.shoreHaze;

    // Span Z across swim corridor with padding
    const zMin = this.params.leftLimit  - (H.zPad ?? 0);
    const zMax = this.params.rightLimit + (H.zPad ?? 0);
    const zMid = 0.5 * (zMin + zMax);
    const zSpan = Math.max(0.001, zMax - zMin);

    // Span Y from surfaceLevel to surfaceLevel + height
    const yBottom = this.params.surfaceLevel;
    const yTop    = yBottom + Math.max(0.05, H.height ?? 8.0);
    const yMid    = 0.5 * (yBottom + yTop);
    const ySpan   = Math.max(0.05, yTop - yBottom);

    // Place at x = shoreLevel, facing +X (towards water)
    const tinyEps = 0.001;  // avoid z-fighting with shoreline geometry if any
    const x = this.params.shoreLevel + tinyEps;

    // Update transform
    this.shoreHazeMesh.position.set(x, yMid, zMid);

    // Update geometry size if params changed live
    const g = this.shoreHazeMesh.geometry;
    const wantW = zSpan;
    const wantH = ySpan;
    // If size differs, rebuild (geometry is cheap)
    const curW = g.parameters.width;
    const curH = g.parameters.height;
    if (Math.abs(curW - wantW) > 1e-4 || Math.abs(curH - wantH) > 1e-4) {
      const geo = new THREE.PlaneGeometry(wantW, wantH, 1, 1);
      geo.rotateY(Math.PI / 2); // keep it facing +X
      this.shoreHazeMesh.geometry.dispose();
      this.shoreHazeMesh.geometry = geo;
    }

    // Live color/opacity tweaks
    const m = this.shoreHazeMesh.material;
    m.color.set(H.color ?? 0xffffff);
    m.opacity = THREE.MathUtils.clamp(H.opacity ?? 1.0, 0, 1);
    m.side = (H.doubleSide ? THREE.DoubleSide : THREE.FrontSide);
    m.needsUpdate = true;
  }

  disposeShoreHaze() {
    if (!this.shoreHazeMesh) return;
    const mesh = this.shoreHazeMesh;
    mesh.parent?.remove(mesh);
    mesh.geometry?.dispose?.();
    if (mesh.material) {
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m?.dispose?.());
      else mat.dispose?.();
    }
    this.shoreHazeMesh = null;
    // Keep texture cached so re-build is instant; if you prefer, also dispose:
    // this._shoreHazeTex?.dispose?.(); this._shoreHazeTex = null;
  }


  async buildOrUpdateShoreVegBackground() {
    const V = this.params.shoreVegBackground;
    if (!V?.enabled) { this.disposeShoreVegBackground(); return; }

    // Load / reuse texture
    if (!this._shoreVegBackgroundTex) {
      const tex = await AssetLoader.texture(V.src);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = 4;
      tex.minFilter = THREE.LinearMipMapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this._shoreVegBackgroundTex = tex;
    }

    this.disposeShoreVegBackground();

    // Shared material/geometry (geometry is resized in updateShoreVegBackgroundLayout())
    this._shoreVegBackgroundMat = new THREE.MeshBasicMaterial({
      map: this._shoreVegBackgroundTex,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending
    });

    this._shoreVegBackgroundGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
    this._shoreVegBackgroundGeo.rotateY(Math.PI / 2); // match shore haze orientation (normal -> +X)

    const group = new THREE.Group();
    group.name = 'shore-veg-background-group';

    // 3 rows (X), each row is 5 tiles (Z): centered at camera start Z
    for (let row = 0; row < 3; row++) {
      for (let col = -2; col <= 2; col++) {
        const mesh = new THREE.Mesh(this._shoreVegBackgroundGeo, this._shoreVegBackgroundMat);
        mesh.name = `shore-veg-background-r${row}-c${col}`;
        mesh.renderOrder = 9; // behind shore haze (which is 10)
        mesh.frustumCulled = true;
        group.add(mesh);
      }
    }

    this.shoreVegBackgroundGroup = group;
    this.scene.add(group);

    this.updateShoreVegBackgroundLayout();
  }

  updateShoreVegBackgroundLayout() {
    if (!this.shoreVegBackgroundGroup) return;
    const V = this.params.shoreVegBackground;
    if (!V?.enabled) return;

    // Height in world meters; width preserves image aspect ratio.
    const wantH = Math.max(0.05, Number.isFinite(V.height) ? V.height : 10.0);

    const img = this._shoreVegBackgroundTex?.image;
    const imgW = (img?.naturalWidth ?? img?.width ?? 0);
    const imgH = (img?.naturalHeight ?? img?.height ?? 0);
    const aspect = (imgW > 0 && imgH > 0) ? (imgW / imgH) : 1.0;
    const wantW = Math.max(0.05, wantH * aspect);

    // Bottom edge aligned to the haze bottom edge (surfaceLevel) + offset.
    const hazeBottomY = this.params.surfaceLevel;
    const bottomOffset = Number.isFinite(V.bottomOffset) ? V.bottomOffset : 0.0;
    const yBottom = hazeBottomY + bottomOffset;
    const yMid = yBottom + wantH * 0.5;

    // X placement: behind the haze by an explicit offset, then rows further behind.
    // (Haze x uses the same tiny epsilon as updateShoreHazeLayout.)
    const hazeX = this.params.shoreLevel + 0.001;
    const xOffsetFromHaze = Number.isFinite(V.xOffsetFromHaze) ? V.xOffsetFromHaze : 0.03;
    const rowSpacingX = Number.isFinite(V.rowSpacingX) ? V.rowSpacingX : 3.0;
    const rowSpacingY = Number.isFinite(V.rowSpacingY) ? V.rowSpacingY : 3.0;
    const xRow0 = hazeX - xOffsetFromHaze;

    // Z tiling: keep one tile centered at initial camera Z.
    const zBase = this.params.start?.z ?? 0;

    // Resize shared geometry if needed (width is along Z after rotateY).
    const g = this._shoreVegBackgroundGeo;
    const curW = g?.parameters?.width ?? 0;
    const curH = g?.parameters?.height ?? 0;
    if (!g || Math.abs(curW - wantW) > 1e-4 || Math.abs(curH - wantH) > 1e-4) {
      const geo = new THREE.PlaneGeometry(wantW, wantH, 1, 1);
      geo.rotateY(Math.PI / 2);
      this._shoreVegBackgroundGeo?.dispose?.();
      this._shoreVegBackgroundGeo = geo;
      for (const child of this.shoreVegBackgroundGroup.children) {
        if (child?.isMesh) child.geometry = geo;
      }
    }

    // Position tiles: 3 rows in X, each row staggered by +W/3 in Z.
    let idx = 0;
    for (let row = 0; row < 3; row++) {
      const x = xRow0 - row * rowSpacingX;
      const y = yMid + row * rowSpacingY;
      const rowShiftZ = row * (wantW / 3);
      for (let col = -2; col <= 2; col++) {
        const z = zBase + rowShiftZ + col * wantW;
        const child = this.shoreVegBackgroundGroup.children[idx++];
        if (child?.isMesh) child.position.set(x, y, z);
      }
    }
  }

  disposeShoreVegBackground() {
    if (!this.shoreVegBackgroundGroup) return;
    const group = this.shoreVegBackgroundGroup;
    group.parent?.remove(group);

    this._shoreVegBackgroundGeo?.dispose?.();
    this._shoreVegBackgroundGeo = null;
    this._shoreVegBackgroundMat?.dispose?.();
    this._shoreVegBackgroundMat = null;

    this.shoreVegBackgroundGroup = null;
    // Keep texture cached for quick rebuilds; if you prefer, also dispose it:
    // this._shoreVegBackgroundTex?.dispose?.(); this._shoreVegBackgroundTex = null;
  }


  async buildOrUpdateShoreVegBackground2() {
    const V = this.params.shoreVegBackground2;
    if (!V?.enabled) { this.disposeShoreVegBackground2(); return; }

    this.disposeShoreVegBackground2();

    // Load / reuse texture
    if (!this._shoreVegBackgroundTex2) {
      const tex = await AssetLoader.texture(V.src);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = 4;
      tex.minFilter = THREE.LinearMipMapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this._shoreVegBackgroundTex2 = tex;
    }

    // Shared material/geometry
    this._shoreVegBackgroundMat2 = new THREE.MeshBasicMaterial({
      map: this._shoreVegBackgroundTex2,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending
    });

    this._shoreVegBackgroundGeo2 = new THREE.PlaneGeometry(1, 1, 1, 1);
    this._shoreVegBackgroundGeo2.rotateY(Math.PI / 2);

    const group = new THREE.Group();
    group.name = 'shore-veg-background-group-2';

    // 3 rows (X), each row is 5 tiles (Z)
    for (let row = 0; row < 3; row++) {
      for (let col = -2; col <= 2; col++) {
        const mesh = new THREE.Mesh(this._shoreVegBackgroundGeo2, this._shoreVegBackgroundMat2);
        mesh.name = `shore-veg-background2-r${row}-c${col}`;
        mesh.renderOrder = 8; // behind the first veg layer (which is 9)
        mesh.frustumCulled = true;
        group.add(mesh);
      }
    }

    this.shoreVegBackgroundGroup2 = group;
    this.scene.add(group);

    this.updateShoreVegBackgroundLayout2();
  }

  updateShoreVegBackgroundLayout2() {
    if (!this.shoreVegBackgroundGroup2) return;
    const V = this.params.shoreVegBackground2;
    if (!V?.enabled) return;

    const wantH = Math.max(0.05, Number.isFinite(V.height) ? V.height : 10.0);

    const img = this._shoreVegBackgroundTex2?.image;
    const imgW = (img?.naturalWidth ?? img?.width ?? 0);
    const imgH = (img?.naturalHeight ?? img?.height ?? 0);
    const aspect = (imgW > 0 && imgH > 0) ? (imgW / imgH) : 1.0;
    const wantW = Math.max(0.05, wantH * aspect);

    const hazeBottomY = this.params.surfaceLevel;
    const bottomOffset = Number.isFinite(V.bottomOffset) ? V.bottomOffset : 0.0;
    const yBottom = hazeBottomY + bottomOffset;
    const yMid = yBottom + wantH * 0.5;

    const hazeX = this.params.shoreLevel + 0.001;
    const xOffsetFromHaze = Number.isFinite(V.xOffsetFromHaze) ? V.xOffsetFromHaze : 17.0;
    const rowSpacingX = Number.isFinite(V.rowSpacingX) ? V.rowSpacingX : 3.0;
    const rowSpacingY = Number.isFinite(V.rowSpacingY) ? V.rowSpacingY : 3.0;
    const xRow0 = hazeX - xOffsetFromHaze;

    const zBase = this.params.start?.z ?? 0;

    // Resize shared geometry
    const g = this._shoreVegBackgroundGeo2;
    const curW = g?.parameters?.width ?? 0;
    const curH = g?.parameters?.height ?? 0;
    if (!g || Math.abs(curW - wantW) > 1e-4 || Math.abs(curH - wantH) > 1e-4) {
      const geo = new THREE.PlaneGeometry(wantW, wantH, 1, 1);
      geo.rotateY(Math.PI / 2);
      this._shoreVegBackgroundGeo2?.dispose?.();
      this._shoreVegBackgroundGeo2 = geo;
      for (const child of this.shoreVegBackgroundGroup2.children) {
        if (child?.isMesh) child.geometry = geo;
      }
    }

    // Position tiles
    let idx = 0;
    for (let row = 0; row < 3; row++) {
      const x = xRow0 - row * rowSpacingX;
      const y = yMid + row * rowSpacingY;
      const rowShiftZ = row * (wantW / 3);
      for (let col = -2; col <= 2; col++) {
        const z = zBase + rowShiftZ + col * wantW;
        const child = this.shoreVegBackgroundGroup2.children[idx++];
        if (child?.isMesh) child.position.set(x, y, z);
      }
    }
  }

  disposeShoreVegBackground2() {
    if (!this.shoreVegBackgroundGroup2) return;
    const group = this.shoreVegBackgroundGroup2;
    group.parent?.remove(group);

    this._shoreVegBackgroundGeo2?.dispose?.();
    this._shoreVegBackgroundGeo2 = null;
    this._shoreVegBackgroundMat2?.dispose?.();
    this._shoreVegBackgroundMat2 = null;

    this.shoreVegBackgroundGroup2 = null;
  }


  // --- Loading overlay (black screen with spinning logo) ---
  _createLoadingOverlay() {
    // Already created?
    if (this._loadingEl) return;

    // Remove any legacy loading spinners/overlays so only the new photo+video+bar shows
    const legacySelectors = [
      '#preloader', '.preloader-container', '#loading-logo', '#loading-spinner', '#loading-screen', '#loading', '#rio-loading-logo'
    ];
    legacySelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.parentNode?.removeChild(el));
    });

    this._loadingProgressTotal = 0;
    this._loadingProgressCompleted = 0;
    this._loadingTextEl = null;
    this._loadingBarFillEl = null;

    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position: fixed;
      inset: 0;
      background: black;
      overflow: hidden;
      z-index: 13000;
      opacity: 1;
      pointer-events: none;
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
    loader.loop = true;

    // Progress Bar Container
    const barContainer = document.createElement('div');
    barContainer.style.cssText = `
      position: absolute;
      bottom: clamp(16px, 3vw, 64px);
      left: clamp(16px, 3vw, 64px);
      transform: none;
      width: min(70vmin, 440px);
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      z-index: 2;
    `;

    const bar = document.createElement('div');
    bar.style.cssText = `
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.2);
        overflow: hidden;
        position: relative;
        margin-bottom: 8px;
    `;

    const fill = document.createElement('div');
    fill.style.cssText = `
        width: 0%;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #ffd360, #ff9c5d, #ffd360);
        transition: width 0.3s ease;
    `;
    bar.appendChild(fill);
    this._loadingBarFillEl = fill;

    const txt = document.createElement('div');
    txt.style.cssText = `
      font-family: "new-science", 'New Science', system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif;
      font-weight: 600;
      font-size: 14px;
      letter-spacing: 0.06em;
      color: rgba(255, 255, 255, 0.92);
      text-align: center;
      text-shadow: 0 1px 2px rgba(0,0,0,0.55);
      text-transform: uppercase;
    `;
    this._loadingTextEl = txt;
    this._setLoadingText('');

    barContainer.appendChild(bar);
    barContainer.appendChild(txt);

    wrap.appendChild(exterior);
    wrap.appendChild(loader);
    wrap.appendChild(barContainer);
    document.body.appendChild(wrap);

    this._loadingEl = wrap;

    // Start video playback
    if (loader.readyState >= 1) {
      loader.play().catch(() => {});
    } else {
      loader.addEventListener('loadedmetadata', () => {
        loader.play().catch(() => {});
      }, { once: true });
    }
  }

  _setLoadingText(message) {
    if (!this._loadingTextEl) return;
    this._loadingTextEl.textContent = message || 'Cargando...';
  }

  _updateLoadingBar() {
    if (!this._loadingBarFillEl) return;
    const total = this._loadingProgressTotal;
    const completed = this._loadingProgressCompleted;
    const ratio = total > 0 ? Math.min(1, completed / total) : 0;
    this._loadingBarFillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
  }

  async _trackLoadingStep(message, fn) {
    if (typeof fn !== 'function') fn = () => undefined;
    this._loadingProgressTotal++;
    this._updateLoadingBar();
    this._setLoadingText(message);
    try {
      const result = await fn();
      return result;
    } finally {
      this._loadingProgressCompleted++;
      this._updateLoadingBar();
    }
  }

  _hideLoadingOverlay() {
    if (!this._loadingEl) return;
    // Fade out and remove
    this._loadingEl.style.transition = 'opacity 0.8s ease';
    this._loadingEl.style.opacity = '0';
    setTimeout(() => {
      if (this._loadingEl?.parentNode) {
        this._loadingEl.parentNode.removeChild(this._loadingEl);
      }
      this._loadingEl = null;
    }, 800);
  }



  buildMistLayer() {
    const M = this.params.mist;
    const group = new THREE.Group();
    group.name = 'mist-group';
    this.scene.add(group);
    this.mistGroup = group;

    // Simple soft-circle alpha texture (procedural)
    const tex = this._makeSoftCircleTexture(256);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

    // Shared material (Soft Particles Shader)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: tex },
        tDepth: { value: null },
        cameraNear: { value: this.camera.near },
        cameraFar: { value: this.camera.far },
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        opacity: { value: M.opacity ?? 0.55 },
        color: { value: new THREE.Color(M.color ?? 0xC9CED6) },
        softness: { value: M.softness ?? 0.5 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec4 vProjPos;
        void main() {
          vUv = uv;
          vProjPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = vProjPos;
        }
      `,
      fragmentShader: `
        #include <packing>
        varying vec2 vUv;
        varying vec4 vProjPos;

        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform vec2 resolution;
        uniform float opacity;
        uniform vec3 color;
        uniform float softness;

        float getLinearDepth(vec2 coord) {
          float fragCoordZ = texture2D(tDepth, coord).x;
          // This converts the non-linear 0-1 depth from the buffer to world units
          float viewZ = perspectiveDepthToViewZ(fragCoordZ, cameraNear, cameraFar);
          return viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
        }

        void main() {
          vec2 screenUv = gl_FragCoord.xy / resolution;
          
          // 1. Get Scene Depth (Depth of objects behind the mist)
          float sceneDepth = getLinearDepth(screenUv);
          
          // 2. Get Current Depth (Depth of the mist pixel itself)
          // Normalized 0.0 to 1.0
          float currentDepth = vProjPos.z / vProjPos.w * 0.5 + 0.5;

          // A. Intersection Softness (Fade against water/objects)
          // If sceneDepth is 1.0 (sky), we ignore softness so mist doesn't vanish against the sky
          float diff = (sceneDepth >= 1.0) ? 1.0 : (sceneDepth - currentDepth);
          float softAlpha = clamp(diff * cameraFar / softness, 0.0, 1.0);

          // B. Near Camera Fade (Fade out as it gets close to the lens)
          // We use viewZ to find the actual distance in meters from the camera
          float viewZ = vProjPos.z / vProjPos.w * (cameraFar - cameraNear) - cameraFar;
          float distToCam = abs(viewZ); 
          float nearFade = clamp((distToCam - cameraNear) / 1.5, 0.0, 1.0); // 1.5 meters fade range

          // 3. Final Color Assembly
          vec4 texColor = texture2D(tDiffuse, vUv);
          
          // Multiply: Texture Alpha * Uniform Opacity * Intersection Fade * Near Camera Fade
          float finalAlpha = texColor.a * opacity * softAlpha * nearFade;
          
          gl_FragColor = vec4(color, finalAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    // Geometry: flat, horizontal quads (face upward)
    const geo = new THREE.PlaneGeometry(1, 1);

    // Make patches
    const puffs = [];
    const [minS, maxS] = M.sizeRange ?? [8, 18];

    // Align to current swim area
    const maxX = this.swimBox.max.x;
    const minX = (this.params.shoreLevel + maxX) * 0.5; // <-- halfway from shore to max X
    const minZ = this.swimBox.min.z, maxZ = this.swimBox.max.z;

    for (let i = 0; i < (M.count ?? 60); i++) {
      const s = THREE.MathUtils.lerp(minS, maxS, Math.random());
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.rotation.x = -Math.PI / 2; // horizontal “sheet”
      m.scale.set(s, s, 1);

      // random position in current swim box
      const x = THREE.MathUtils.lerp(minX, maxX, Math.random());
      const z = THREE.MathUtils.lerp(minZ, maxZ, Math.random());
      const y = this.params.surfaceLevel + (M.height ?? 0.25);
      m.position.set(x, y, z);

      // per-puff jitter phase/frequency
      const f0 = (M.jitterFreqRange?.[0] ?? 0.05);
      const f1 = (M.jitterFreqRange?.[1] ?? 0.12);
      puffs.push({
        mesh: m,
        phase: Math.random() * Math.PI * 2,
        freq: THREE.MathUtils.lerp(f0, f1, Math.random()),
        baseY: y
      });

      group.add(m);
    }

    // Cache anim data
    const dirRad = THREE.MathUtils.degToRad(M.windDirDeg ?? 0);
    this._mist = {
      mat, geo, tex,
      puffs,
      dir: new THREE.Vector3(Math.cos(dirRad), 0, Math.sin(dirRad)),
      speed: M.windSpeed ?? 0.35
    };

    // Initial visibility: only when camera is above the surface
    group.visible = true;
  }

  updateMistLayer(dt) {
    if (!this._mist) return;

    const mist = this.params.mist; // <-- single binding, no redeclare
    const eps  = this.params.aboveFog?.surfaceHysteresis ?? 0.0;
    const y    = this.camera.position.y;

    // Determine above/below with hysteresis consistent with fog
    const isAbove = (this._fogUnderPrev === true)
      ? (y >= this.params.surfaceLevel + eps)
      : (this._fogUnderPrev === false)
        ? (y >= this.params.surfaceLevel - eps)
        : (y >= this.params.surfaceLevel);

    // Target opacity depending on side of surface
    const targetOpacity = isAbove ? (mist.opacity ?? 0.55)
                                  : (mist.underwaterOpacity ?? 0.0);

    // Smoothly approach target (exponential ease)
    const fade = Math.max(0.001, mist.fadeSec ?? 0.25);
    const k    = 1 - Math.exp(-dt / fade);
    this._mist.mat.uniforms.opacity.value = THREE.MathUtils.lerp(this._mist.mat.uniforms.opacity.value, targetOpacity, k);

    // Keep color live-updatable
    this._mist.mat.uniforms.color.value.set(mist.color ?? 0xC9CED6);
    this._mist.mat.uniforms.softness.value = mist.softness ?? 0.5;

    // Drift / bob
    const speed = (mist.windSpeed ?? this._mist.speed); // live-updatable
    const dir   = this._mist.dir;

    // Camera-relative torus wrap to avoid visible edge pops
    const cam   = this.camera.position;
    const xMax = this.swimBox.max.x;
    const xMin = (this.params.shoreLevel + xMax) * 0.5;
    const spanX = Math.max(0.001, xMax - xMin);
    const spanZ = Math.max(0.001, this.swimBox.max.z - this.swimBox.min.z);

    for (const p of this._mist.puffs) {
      // Drift with wind
      p.mesh.position.addScaledVector(dir, speed * dt);

      // Wrap X around camera
      if (p.mesh.position.x > xMax) p.mesh.position.x -= spanX;
      else if (p.mesh.position.x < xMin) p.mesh.position.x += spanX;

      // Wrap Z around camera
      let dz = p.mesh.position.z - cam.z;
      while (dz >  spanZ * 0.5) { p.mesh.position.z -= spanZ; dz -= spanZ; }
      while (dz < -spanZ * 0.5) { p.mesh.position.z += spanZ; dz += spanZ; }

      // Hover near the (possibly changing) surface with gentle bobbing
      p.phase += p.freq * dt * Math.PI * 2;
      const baseY = this.params.surfaceLevel + (mist.height ?? 0.25);
      const bob   = (mist.jitterAmp ?? 0.5) * Math.sin(p.phase);
      p.mesh.position.y = baseY + bob;
    }
  }


  resizeMistLayer() {
    // nothing special is required; we keep wrapping inside swimBox each frame.
    // this hook is here in case you later want to rebuild counts on resize.
  }

  disposeMistLayer() {
    if (!this.mistGroup) return;
    this.scene.remove(this.mistGroup);
    this.mistGroup.traverse(n => {
      if (n.isMesh) {
        n.geometry?.dispose?.();
        if (Array.isArray(n.material)) n.material.forEach(m => m?.map?.dispose?.(), m?.dispose?.());
        else {
          n.material?.map?.dispose?.();
          n.material?.dispose?.();
        }
      }
    });
    this.mistGroup = null;
    this._mist = null;
  }

  // Simple procedural soft-disc texture (alpha falloff)
  _makeSoftCircleTexture(size = 256) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');

    // radial gradient from center -> edges
    const grad = g.createRadialGradient(size/2, size/2, 0, size/2, size/2, size*0.5);
    grad.addColorStop(0.0, 'rgba(255,255,255,0.8)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');

    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearMipMapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    return tex;
  }


  /* ========================================================================== */
  /* Surface transition Bubble FX                                               */
  /* ========================================================================== */

  _setupSurfaceVideoFX() {
    const cfg = this.params.surfaceFX || {};
    this.surfaceFX = {
      enabled: !!cfg.enabled,
      playing: false,
      bubbleSystem: null,
      overlayEl: null
    };

    if (!this.surfaceFX.enabled) return;

    // Dedicated transparent overlay: bubbles only.
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '100003',
      background: 'transparent'
    });
    document.body.appendChild(overlay);
    this.surfaceFX.overlayEl = overlay;

    const tint = this.getUnderwaterSurfaceColor();
    this.surfaceFX.bubbleSystem = new BubbleSystem(overlay, tint);
    this.surfaceFX.bubbleSystem.setIntensity(0);
  }

  _handleSurfaceVideoInsideToggle(isInside) {
    const fx = this.surfaceFX;
    if (!fx || !fx.enabled) return;
    
    if (isInside) {
      if (!fx.playing) {
        fx.playing = true;
        fx.bubbleSystem?.start();
      }
    } else {
      if (fx.playing) {
        fx.playing = false;
        fx.bubbleSystem?.stop();
      }
    }
  }

  _applyInsideOverlayState(inside) {
    if (!this._insideOverlay) return;
    const visible = !!inside && !this._suppressInsideOverlay;
    this._insideOverlay.style.opacity = visible ? '1' : '0';
  }

  _updateCursorVisibility() {
    if (!this.cursorEl) return;
    const shouldShow = this._cursorEnabled && !this._cursorBlockedByDeck && !this._cursorBlockedByMenu;
    this.cursorEl.style.visibility = shouldShow ? 'visible' : 'hidden';
  }

  _destroySurfaceVideoFX() {
    const fx = this.surfaceFX;
    if (!fx) return;
    fx.bubbleSystem?.destroy();
    if (fx.overlayEl && fx.overlayEl.parentNode) fx.overlayEl.parentNode.removeChild(fx.overlayEl);
    this.surfaceFX = null;
  }

  _computeSurfaceBubbleIntensity() {
    // Bubbles appear as you approach the surface from either side.
    // Above surface: fade out to 0 after +0.1m
    // Below surface: fade out to 0 after -1.0m
    const y = this.camera?.position?.y ?? 0;
    const s = this.params?.surfaceLevel ?? 0;
    const aboveMargin = 0.1;
    const belowMargin = 1.0;

    if (y > s + aboveMargin) return 0;
    if (y < s - belowMargin) return 0;

    if (y >= s) {
      const d = y - s; // 0..aboveMargin
      return clamp(1 - (d / Math.max(0.0001, aboveMargin)), 0, 1);
    }

    const d = s - y; // 0..belowMargin
    return clamp(1 - (d / Math.max(0.0001, belowMargin)), 0, 1);
  }



  /* ----------------------------------- SwimBox ----------------------------------- */

  /**
   * Initialize the swimBox using the explicit world parameters — no offsets:
   *   X: [shoreLevel, cameraLevel]  (cameraLevel = current camera x)
   *   Y: [floorLevel, surfaceLevel]
   *   Z: [leftLimit, rightLimit]
   */
  initSwimBoxFromParams() {
    const maxX = (this.params.swimBoxMaxX ?? this.params.start.x);
    this.swimBox.min.set(
      this.params.shoreLevel,
      this.params.floorLevel,
      this.params.leftLimit
    );
    this.swimBox.max.set(
      Math.max(this.params.shoreLevel + 0.001, maxX),
      Math.max(this.params.floorLevel + 0.001, this.params.surfaceLevel),
      this.params.rightLimit
    );
  }

  /**
   * Keep swimBox aligned as the camera moves:
   * maxX must follow the current cameraLevel (camera.position.x).
   */
  updateSwimBoxDynamic() {
    const maxX = (this.params.swimBoxMaxX ?? this.params.start.x);

    // X stays frozen
    this.swimBox.min.x = this.params.shoreLevel;
    this.swimBox.max.x = Math.max(this.params.shoreLevel + 0.001, maxX);

    // Y, Z reflect explicit params (in case you tweak them live)
    this.swimBox.min.y = this.params.floorLevel;
    this.swimBox.max.y = Math.max(this.params.floorLevel + 0.001, this.params.surfaceLevel);

    this.swimBox.min.z = this.params.leftLimit;
    this.swimBox.max.z = this.params.rightLimit;
  }

  /** Project a point inside current swimBox (simple clamping). */
  projectInsideSwimBox(p) {
    p.x = clamp(p.x, this.swimBox.min.x, this.swimBox.max.x);
    p.y = clamp(p.y, this.swimBox.min.y, this.swimBox.max.y);
    p.z = clamp(p.z, this.swimBox.min.z, this.swimBox.max.z);
  }

  /* ----------------------------------- Fish ----------------------------------- */

  async spawnFishBySpecies() {
    this.fish.length = 0;

    for (const sp of this.speciesObjs) {
      await sp.ensureTemplate();

      for (let i = 0; i < sp.count; i++) {
        const agent = await sp.createAgent(this.swimBox);
        this.fish.push(agent);
        this.fishGroup.add(agent.mesh);
      }
    }
  }

  /* --------------------------------- Input & UX --------------------------------- */
  onKeyDown(e) {
    if (!this.controlsEnabled) return;
    if (!this.deck) return;
    if (e.key === 'ArrowDown') {
      this.deck.cycle(1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      this.deck.cycle(-1);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      this.deck.cycle(1);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      this.deck.cycle(-1);
      e.preventDefault();
    }
  }


  onWheel(e) {
    // If deck is hovered, scroll the deck column instead of camera X
    if (this.deck && this.deck.isPointerInside) {
      e.preventDefault();
      this.deck.onWheel(e.deltaY);
      return;
    }

    if (!this.controlsEnabled) { e.preventDefault(); return; }

    // NEW: Block camera zoom when ABOVE water
    const isUnder = this.isUnderwaterStable
      ? this.isUnderwaterStable()
      : (this.camera.position.y < this.params.surfaceLevel);

    if (!isUnder) {
      // Above water → allow nothing but deck scrolling (already handled above)
      e.preventDefault();
      return;
    }

    // BELOW water → smooth zoom with velocity-based movement
    e.preventDefault();
    
    const wheelConfig = this.params.wheelZoom;
    const direction = Math.sign(e.deltaY); // +1 when scrolling down (zoom in), -1 up (zoom out)
    
    // Add velocity based on wheel direction
    this.zoomVelocity += direction * wheelConfig.acceleration;
    
    // Clamp velocity to max speed
    this.zoomVelocity = clamp(this.zoomVelocity, -wheelConfig.maxVelocity, wheelConfig.maxVelocity);
    
    // Record wheel input time for friction control
    this._lastWheelTime = performance.now();

    this.updateSwimBoxDynamic();
    this.camera.lookAt(this.camera.position.clone().add(this.forward));
  }




  onMouseDown(e) {
    if (!this.controlsEnabled) return;

    // 1) Always play cursor click animation at mouse position (outside deck constraint is implicit: canvas receives the event)
    this._startCursorClick(e.clientX, e.clientY);

    // 2) Fat raycast for fish logic + fire radar if it's a correct catch
    const rect = this.app.canvas.getBoundingClientRect();
    this.clickMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.clickMouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    const raycastTargets = [
      ...this.fishGroup.children // Only non-instanced meshes
    ];
    
    // Use fat raycast for better detection area matching cursor size
    const intersects = this._performFatRaycast(this.clickMouse, this.camera, raycastTargets);

    for (const intersect of intersects) {
      let obj = intersect.object;
      // Walk up to find a mesh tagged with speciesKey
      while (obj) {
        if (obj.userData && obj.userData.speciesKey) {
          this._recordDeckTagAttempt();
          this._handleFishClickForFacts();
          const agent = this._findAgentByObject(obj);
          const skipIncrement = !!agent?.tracked;
          const isMatch = this.deck.checkMatch(obj.userData.speciesKey, { skipIncrement });

          if (isMatch) {
            if (!skipIncrement) {
              this.playSfx('catch');
              const worldPos = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
              const ndc = worldPos.clone().project(this.camera);
              const cx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
              const cy = rect.top  + (-ndc.y * 0.5 + 0.5) * rect.height;
              this._playRadarAtScreen(cx, cy);
            }
            this.catchFish(obj);
          } else {
            this.playSfx('wrong');
          }
          return;

        }
        obj = obj.parent;
      }
    }
  }

  _handleFishClickForFacts() {
    if (!this.deck) return;
    // Don't show facts if the completed species overlay is active
    if (this._completedOverlayState?.loading || this._completedOverlayState?.activeKey) return;
    if (this.completedOverlay && this.completedOverlay._activeKey) return;

    this.fishClickCount++;
    if (this.fishClickCount % 2 === 0) {
      const currentSpecies = this.deck.speciesList[this.deck.currentIndex];
      if (!currentSpecies) return;
      const speciesKey = currentSpecies.key;
      const facts = SPECIES_FACTS[speciesKey];
      if (facts && facts.length > 0) {
        if (this.speciesFactIndices[speciesKey] === undefined) {
          this.speciesFactIndices[speciesKey] = 0;
        }
        const index = this.speciesFactIndices[speciesKey];
        const fact = facts[index];
        
        const audioSrc = resolvePublicAsset(`game-assets/rio/voiceovers/${speciesKey}_${index}.mp3`);
        this.factOverlay.show(fact, audioSrc);
        
        this.speciesFactIndices[speciesKey] = (index + 1) % facts.length;
      }
    }
  }

  _createDeckTagHint() {
    if (this._deckTagHintEl) return this._deckTagHintEl;

    const accent = this.params?.deckUI?.colors?.silhouetteSelected || '#FFD400';
    const fontFamily = this.params?.deckUI?.fonts?.family || 'system-ui, sans-serif';

    const el = document.createElement('div');
    el.id = 'rio-deck-tag-hint';
    Object.assign(el.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      pointerEvents: 'none',
      zIndex: '10002',
      opacity: '0',
      transition: 'opacity 200ms ease',
      willChange: 'transform, opacity, left, top'
    });

    const text = document.createElement('div');
    text.textContent = 'Encontrá y marcá peces de esta especie.';
    Object.assign(text.style, {
      fontFamily,
      fontWeight: '800',
      fontSize: '1.7vh',
      lineHeight: '1.1',
      color: '#ffffff',
      background: 'rgba(0,0,0,0.35)',
      padding: '0.7vh 1.0vh',
      borderRadius: '999px',
      whiteSpace: 'nowrap',
      textShadow: '0 1px 2px rgba(0,0,0,0.65)'
    });

    const arrow = document.createElement('div');
    arrow.setAttribute('aria-hidden', 'true');
    Object.assign(arrow.style, {
      width: '0',
      height: '0',
      borderTop: '10px solid transparent',
      borderBottom: '10px solid transparent',
      borderLeft: `16px solid ${accent}`,
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.65))'
    });

    el.appendChild(text);
    el.appendChild(arrow);
    document.body.appendChild(el);

    this._deckTagHintEl = el;
    return el;
  }

  _showDeckTagHint() {
    const el = this._createDeckTagHint();
    this._deckTagHintVisible = true;
    el.style.opacity = '1';
    this._updateDeckTagHintPosition();
  }

  _hideDeckTagHint(remove = false) {
    this._deckTagHintVisible = false;
    if (!this._deckTagHintEl) return;
    this._deckTagHintEl.style.opacity = '0';
    if (remove) {
      const el = this._deckTagHintEl;
      this._deckTagHintEl = null;
      this._deckTagHintLastKey = '';
      setTimeout(() => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }, 220);
    }
  }

  _destroyDeckTagHint() {
    this._deckTagHintVisible = false;
    this._deckTagHintLastKey = '';
    if (this._deckTagHintEl && this._deckTagHintEl.parentNode) {
      this._deckTagHintEl.parentNode.removeChild(this._deckTagHintEl);
    }
    this._deckTagHintEl = null;
  }

  _maybeShowDeckTagHint() {
    if (!this.deck || !this.deck.container) return;
    if (State.hasRioDeckTagHintDismissed()) return;
    if (State.getRioDeckTagHintAttempts() >= 3) return;
    this._showDeckTagHint();
  }

  _recordDeckTagAttempt() {
    if (State.hasRioDeckTagHintDismissed()) return;
    const attempts = State.getRioDeckTagHintAttempts();
    if (attempts >= 3) return;
    State.incrementRioDeckTagHintAttempts(3);
    if (State.getRioDeckTagHintAttempts() >= 3 || State.hasRioDeckTagHintDismissed()) {
      this._hideDeckTagHint(true);
    }
  }

  _updateDeckTagHintPosition() {
    if (!this._deckTagHintVisible || !this._deckTagHintEl || !this.deck?.container) return;

    const selected = this.deck.container.querySelector('.deck-card-vert.selected');
    if (!selected) return;

    const r = selected.getBoundingClientRect();
    const el = this._deckTagHintEl;

    const key = `${Math.round(r.left)}|${Math.round(r.top)}|${Math.round(r.width)}|${Math.round(r.height)}`;
    if (key === this._deckTagHintLastKey) return;
    this._deckTagHintLastKey = key;

    const hintRect = el.getBoundingClientRect();
    const gap = 10;

    let left = Math.round(r.left - hintRect.width - gap);
    let top = Math.round(r.top + r.height * 0.5 - hintRect.height * 0.5);

    left = clamp(left, 8, Math.max(8, window.innerWidth - hintRect.width - 8));
    top = clamp(top, 8, Math.max(8, window.innerHeight - hintRect.height - 8));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }



  _areTrackersVisible() {
    if (!this.params.fishTracker?.hideAboveWater) return true;
    return this._isCurrentlyUnderwater;
  }

  _updateTrackersVisibility() {
    const visible = this._areTrackersVisible();
    const targetColor = new THREE.Color(this.params.fishTracker?.strokeColor ?? '#ffffff');
    const texture = this._getTrackerTexture();
    
    // Fixed screen-space size configuration
    const fixedSize = 0.08; // 8% of screen height

    for (const agent of this.fish) {
      if (!agent.tracker) continue;
      agent.tracker.visible = visible;

      const mat = agent.tracker.material;
      if (mat) {
        if (!mat.color.equals(targetColor)) mat.color.copy(targetColor);
        if (mat.map !== texture) {
          mat.map = texture;
          mat.needsUpdate = true;
        }
        
        // Ensure sizeAttenuation is disabled
        if (mat.sizeAttenuation !== false) {
          mat.sizeAttenuation = false;
          mat.needsUpdate = true;
        }
      }
      
      // Update scale to maintain fixed screen size
      agent.tracker.scale.set(fixedSize, fixedSize, 1);
    }
  }

  /**
   * Performs a "fat" raycast for better fish detection.
   * Either uses multiple rays in a pattern or single ray with distance-based detection.
   * @param {THREE.Vector2} normalizedScreenPos - Mouse position in normalized device coordinates (-1 to 1)
   * @param {THREE.Camera} camera - The camera to cast rays from
   * @param {Array} targets - Array of objects to intersect with
   * @returns {Array} Array of intersection results with enhanced detection area
   */
  _performFatRaycast(normalizedScreenPos, camera, targets) {
    const config = this.params.raycastUI;
    const intersects = [];

    if (config.useFatRaycast) {
      // Multi-ray approach: create a pattern of rays around the center point
      const radiusScale = config.radiusScale || 0.15;
      const numRays = 4; // Reduced from 8 for performance
      const centerRadius = radiusScale * 0.5; // Scale down for raycast offset
      
      // Center ray
      this.raycaster.setFromCamera(normalizedScreenPos, camera);
      intersects.push(...this.raycaster.intersectObjects(targets, true));
      
      // Circle of rays around center
      for (let i = 0; i < numRays; i++) {
        const angle = (i / numRays) * Math.PI * 2;
        const offsetX = Math.cos(angle) * centerRadius;
        const offsetY = Math.sin(angle) * centerRadius;
        
        const offsetPos = new THREE.Vector2(
          normalizedScreenPos.x + offsetX,
          normalizedScreenPos.y + offsetY
        );
        
        this.raycaster.setFromCamera(offsetPos, camera);
        intersects.push(...this.raycaster.intersectObjects(targets, true));
      }
    } else {
      // Single ray with distance-based detection
      this.raycaster.setFromCamera(normalizedScreenPos, camera);
      const allIntersects = this.raycaster.intersectObjects(targets, true);
      
      // For each intersection, check if there are nearby fish within cursor radius
      const radiusScale = config.radiusScale || 0.15;
      const screenRadius = radiusScale * Math.min(window.innerWidth, window.innerHeight) * 0.5;
      
      // Convert click position to world space at intersection depth
      if (allIntersects.length > 0) {
        intersects.push(...allIntersects);
      }
      
      // Also check for fish near the ray but not directly intersected
      const ray = this.raycaster.ray;
      for (const target of targets) {
        if (allIntersects.find(hit => hit.object === target)) continue; // Already found
        
        const worldPos = new THREE.Vector3().setFromMatrixPosition(target.matrixWorld);
        const screenPos = worldPos.clone().project(camera);
        
        // Convert to screen pixels
        const rect = this.app.canvas.getBoundingClientRect();
        const screenX = (screenPos.x * 0.5 + 0.5) * rect.width;
        const screenY = (-screenPos.y * 0.5 + 0.5) * rect.height;
        
        // Get click position in screen pixels
        const clickScreenX = (normalizedScreenPos.x * 0.5 + 0.5) * rect.width;
        const clickScreenY = (-normalizedScreenPos.y * 0.5 + 0.5) * rect.height;
        
        // Check distance in screen space
        const distance = Math.sqrt(
          (screenX - clickScreenX) ** 2 + (screenY - clickScreenY) ** 2
        );
        
        if (distance <= screenRadius) {
          // Create a fake intersection result
          intersects.push({
            object: target,
            distance: worldPos.distanceTo(camera.position),
            point: worldPos.clone(),
            screenDistance: distance
          });
        }
      }
    }
    
    // Remove duplicates and sort by distance
    const uniqueIntersects = [];
    const seenObjects = new Set();
    
    for (const intersect of intersects) {
      if (!seenObjects.has(intersect.object)) {
        seenObjects.add(intersect.object);
        uniqueIntersects.push(intersect);
      }
    }
    
    // Sort by distance (closest first)
    uniqueIntersects.sort((a, b) => a.distance - b.distance);
    
    return uniqueIntersects;
  }


  _findAgentByObject(target) {
    if (!target) return null;
    const isDescendant = (root, node) => {
      let cur = node;
      while (cur) {
        if (cur === root) return true;
        cur = cur.parent;
      }
      return false;
    };
    for (const agent of this.fish) {
      if (agent.mesh === target || isDescendant(agent.mesh, target)) return agent;
    }
    return null;
  }

  _getTrackerTexture() {
    const cfg = this.params.fishTracker || {};
    const ratio = THREE.MathUtils.clamp(cfg.strokeWeightRatio ?? 0.04, 0.002, 0.25);

    if (!this._trackerTexture || !this._trackerTextureConfig || this._trackerTextureConfig.ratio !== ratio) {
      this._trackerTexture?.dispose?.();

      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');

      ctx.clearRect(0, 0, size, size);
      const line = Math.max(1, Math.floor(size * ratio));
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = line;
      const inset = line / 2;
      ctx.strokeRect(inset, inset, size - line, size - line);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 4;
      texture.needsUpdate = true;

      this._trackerTexture = texture;
      this._trackerTextureConfig = { ratio };
    }

    return this._trackerTexture;
  }


  _ensureAgentTracker(agent) {
    if (!agent) return;
    if (agent.tracker && agent.tracker.parent === agent.mesh) {
      agent.tracked = true;
      return;
    }

    agent.mesh.updateWorldMatrix(true, true);

    const texture = this._getTrackerTexture();
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: new THREE.Color(this.params.fishTracker?.strokeColor ?? '#ffffff'),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false  // KEY: disable distance scaling
    });

    const sprite = new THREE.Sprite(material);
    
    // Fixed screen-space size (will be updated each frame in update loop)
    const fixedSize = 0.08; // normalized screen space size (0.08 = 8% of screen height)
    sprite.scale.set(fixedSize, fixedSize, 1);

    const box = new THREE.Box3().setFromObject(agent.mesh);
    const center = box.getCenter(new THREE.Vector3());
    agent.mesh.worldToLocal(center);
    sprite.position.copy(center);
    sprite.renderOrder = 999;

    sprite.visible = this._areTrackersVisible();

    agent.mesh.add(sprite);
    agent.tracker = sprite;
    agent.tracked = true;
  }



  catchFish(target) {
    const agent = this._findAgentByObject(target);
    if (!agent) return;

    if (agent.tracked && agent.tracker) return;
    this._ensureAgentTracker(agent);
  }






  onMouseMove(e) {
    if (!this.controlsEnabled) return;
    const rect = this.app.canvas.getBoundingClientRect();
    this.mouseNDC.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    this.mouseNDC.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    if (this.cursorEl) {
      // clientX/Y are viewport-based; we fix-position the image, so it's 1:1
      this.cursorEl.style.left = `${e.clientX}px`;
      this.cursorEl.style.top  = `${e.clientY}px`;
    }
  }

  axis(a, deadzone, expo = 1) {
    if (Math.abs(a) <= deadzone) return 0;
    const t = (Math.abs(a) - deadzone) / (1 - deadzone);
    const s = Math.min(Math.max(t, 0), 1);
    const curved = Math.pow(s, expo);
    return Math.sign(a) * (curved * curved * (3 - 2 * curved));
  }

  setYaw(deg) {
    const yaw = THREE.MathUtils.degToRad(deg);
    this.forward.set(Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
  }


  /** Devuelve true si la cámara está dentro del volumen “sólido” del agua. */
  isCameraInsideSolid() {
    // Increased thickness to ensure the camera doesn't skip the transition zone
    // even when moving fast (e.g. 10m/s at 60fps is ~0.16m per frame).
    const yTop = this.params.surfaceLevel;
    const y = this.camera.position.y;
    const halfT = 0.15; // 15cm above/below surface (30cm total zone)
    return (y >= yTop - halfT && y <= yTop + halfT);
  }

  /* ----------------------------------- Update ----------------------------------- */

  update(dt) {
    const { deadzone, damping, speeds, responseCurve } = this.params;
    const nowSec = performance.now() * 0.001;

        // --- Intro phases (pre -> move -> post -> done) ---
    let didIntroCameraStep = false;
    if (this.introState.active) {
      const now = nowSec;
      const t   = now - this.introState.t0;
      const P   = this.params.intro;

      if (this.introState.phase === 'pre') {
        if (t >= P.preHold) {
          this.introState.phase = 'move';
          this.introState.t0 = now;
        }
      } else if (this.introState.phase === 'move') {
        const u = Math.min(1, t / Math.max(0.0001, P.moveDuration));
        const s = u * u * (3 - 2 * u); // smoothstep
        const y = THREE.MathUtils.lerp(this.introState.startY, this.introState.targetY, s);

        // Maintain x,z from start; glide y
        this.camera.position.set(this.params.start.x, y, this.params.start.z);
        this.camera.lookAt(this.camera.position.clone().add(this.forward));
        didIntroCameraStep = true;

        if (u >= 1) {
          this.introState.phase = 'post';
          this.introState.t0 = now;
          this._fadeOutIntroOverlay();
        }
      } else if (this.introState.phase === 'post') {
        if (t >= P.postHold) {
          this.introState.phase = 'done';
          this.introState.active = false;

          // Finalize camera & enable controls
          this.camera.position.set(this.params.start.x, this.params.start.y, this.params.start.z);
          this.camera.lookAt(this.camera.position.clone().add(this.forward));

          if (this.deck) {
            this.deck.container.style.opacity = 1;
            this.deck.container.style.pointerEvents = 'auto';
          }
          this.controlsEnabled = true;
          this._destroyIntroOverlay();
          this._startTimer();

          // One-time instruction: point to the selected deck card until 3 fish clicks.
          this._maybeShowDeckTagHint();
        }
      }

      // Keep deck mini-canvases spinning during intro (optional)
      if (this.deck && this.params.debug.deckRender) this.deck.update(dt);
    }


    if (this.controlsEnabled && !didIntroCameraStep) {
      // Mouse-driven camera velocity in local right/up axes
      const ax = this.axis(this.mouseNDC.x, deadzone, responseCurve.x);
      const ay = this.axis(this.mouseNDC.y, deadzone, responseCurve.y);
      const targetVx = ax * speeds.x;
      const targetVy = ay * speeds.y;
      this.vel.x += (targetVx - this.vel.x) * damping;
      this.vel.y += (targetVy - this.vel.y) * damping;

      // Move camera along right (x) and up (y)
      this.tmpRight.copy(this.forward).cross(this.tmpUp).normalize();
      const deltaX = this.tmpDelta.copy(this.tmpRight).multiplyScalar(this.vel.x * dt);
      const deltaY = this.tmpUp.clone().multiplyScalar(this.vel.y * dt);

      const p = this.camera.position.clone().add(deltaX);
      const xMinSoft = this.params.cameraXBounds[0];
      const xMaxSoft = this.params.cameraXBounds[1];

      // Hard alignment to shoreLevel for min X (shore can never be crossed)
      const xMinHard = this.params.shoreLevel;

      // Apply X clamps: first soft bounds, then ensure ≥ shoreLevel
      p.x = clamp(p.x, xMinSoft, xMaxSoft);
      p.x = Math.max(p.x, xMinHard);

      // --- Smooth zoom velocity system ---
      if (Math.abs(this.zoomVelocity) > 0.01) {
        const wheelConfig = this.params.wheelZoom;
        const timeSinceLastWheel = performance.now() - this._lastWheelTime;
        
        // Apply different damping based on whether we recently had wheel input
        let dampingFactor;
        if (timeSinceLastWheel < 100) {
          // Recent wheel input - use normal damping
          dampingFactor = wheelConfig.damping;
        } else {
          // No recent wheel input - apply stronger friction
          dampingFactor = wheelConfig.friction;
        }
        
        // Apply damping to velocity
        this.zoomVelocity *= dampingFactor;
        
        // Move camera based on current velocity
        const zoomMovement = this.zoomVelocity * dt;
        const newXWithZoom = p.x + zoomMovement;
        
        // Apply the same X bounds for zoom movement
        const minX = (this.swimBox?.min?.x ?? this.params.shoreLevel);
        const maxX = this.params.start.x;
        
        p.x = clamp(newXWithZoom, minX, maxX);
      }

      // Z clamp with camera margins (does NOT affect swimBox limits)
      {
        const zMin = this.params.leftLimit  + this.params.cameraLeftMargin;
        const zMax = this.params.rightLimit - this.params.cameraRightMargin;
        const safeMin = Math.min(zMin, zMax - 0.001);
        const safeMax = Math.max(zMax, zMin + 0.001);
        p.z = clamp(p.z, safeMin, safeMax);
      }

      // Y limits: (floorLevel + cameraFloorMargin) ≤ Y ≤ (surfaceLevel + cameraSurfaceMargin)
      const yMin = this.params.floorLevel + this.params.cameraFloorMargin;
      const yMax = this.params.surfaceLevel + this.params.cameraSurfaceMargin;
      const newY = clamp(this.camera.position.y + deltaY.y, yMin, yMax);

      // --- Surface Transition Lock ---
      const currentInside = this.isCameraInsideSolid();
      if (currentInside && !this._surfaceTransitionActive && !this._wasInsideSolid) {
        this._surfaceTransitionActive = true;
        this._surfaceTransitionTime = 0;
      }
      this._wasInsideSolid = currentInside;

      let allowMovement = true;
      /* if (this._surfaceTransitionActive) {
        this._surfaceTransitionTime += dt;
        if (this._surfaceTransitionTime >= 0.2) {
          this._surfaceTransitionActive = false;
        } else {
          allowMovement = false;
        }
      } */

      if (allowMovement) {
        // Apply camera transform
        this.camera.position.set(p.x, newY, p.z);
        this.camera.lookAt(this.camera.position.clone().add(this.forward));
      }
    }

    // --- Snap X on surface crossing; restore when diving back ---
    {
      // Decide current underwater/above (use the same rule you prefer elsewhere)
      const isUnder = this.isUnderwaterStable
        ? this.isUnderwaterStable()
        : (this.camera.position.y < this.params.surfaceLevel);

      if (this._wasUnderwater === undefined) {
        this._wasUnderwater = isUnder; // initialize on first frame
      }

      // Crossing: UNDER -> ABOVE  (surfacing)
      if (this._wasUnderwater === true && isUnder === false) {
        // remember where we were underwater
        this._lastUnderwaterX = this.camera.position.x;
        // snap X to starting X, keep Y/Z untouched
        this.camera.position.x = this.params.start.x;

        // keep X inside hard/soft limits
        const xMinSoft = this.params.cameraXBounds[0];
        const xMaxSoft = this.params.cameraXBounds[1];
        const xMinHard = this.params.shoreLevel;
        this.camera.position.x = Math.max(xMinHard, clamp(this.camera.position.x, xMinSoft, xMaxSoft));

        // reflect in swim box and camera look
        this.updateSwimBoxDynamic?.();
        this.camera.lookAt(this.camera.position.clone().add(this.forward));
      }

      // Crossing: ABOVE -> UNDER  (diving)
      if (this._wasUnderwater === false && isUnder === true) {
        // restore last underwater X (if we have one)
        if (Number.isFinite(this._lastUnderwaterX)) {
          this.camera.position.x = this._lastUnderwaterX;

          // keep X inside limits
          const xMinSoft = this.params.cameraXBounds[0];
          const xMaxSoft = this.params.cameraXBounds[1];
          const xMinHard = this.params.shoreLevel;
          this.camera.position.x = Math.max(xMinHard, clamp(this.camera.position.x, xMinSoft, xMaxSoft));

          this.updateSwimBoxDynamic?.();
          this.camera.lookAt(this.camera.position.clone().add(this.forward));
        }
      }

      this._wasUnderwater = isUnder; // update state for next frame
    }



    // Update swimBox to follow the cameraLevel in X
    this.updateSwimBoxDynamic();

    // Update fish
    if (this.params.debug.fishUpdate && this.fish.length) this.updateFish(dt);

    // Update vegetation (surface drift follows surface level)
    if (this.params.vegetation?.enabled) this.updateVegetation(dt);

    // Update fog with explicit rules
    if (this.params.debug.fog) this.updateFog(); else this.scene.fog = null;

    if (this.mistGroup && this.params.mist?.enabled) {
      this.updateMistLayer(dt);
    }

    const isUnderInitial = this.isUnderwaterStable ? this.isUnderwaterStable() : (this.camera.position.y < this.params.surfaceLevel);
    this._isCurrentlyUnderwater = isUnderInitial;
    // … existing crossing logic uses `isUnder`
    this._updateTrackersVisibility();


    // === Inside-solid overlay toggle ===
    if (this._insideOverlay) {
      const inside = this.isCameraInsideSolid();
      if (inside !== this._insideOverlayPrevInside) {
        this._insideOverlayPrevInside = inside;
      }
      if (this.mistGroup) this.mistGroup.visible = !inside;  // <-- re-enable when not inside
      this._applyInsideOverlayState(inside);
    }

    // Surface bubbles: intensity by distance to surface (no background).
    if (this.surfaceFX?.bubbleSystem) {
      const intensity = this._computeSurfaceBubbleIntensity();
      this.surfaceFX.bubbleSystem.setIntensity(intensity);
    }

    if (this.skyDome) this.skyDome.position.copy(this.camera.position);
    
    // Update the deck UI
    if (this.deck && this.params.debug.deckRender) this.deck.update(dt);

    // Keep the deck tutorial hint anchored to the selected card.
    this._updateDeckTagHintPosition();

    if (this.deck) {
      const idx = this.deck.currentIndex ?? 0;
      if (this._lastDeckIndex === null) {
        this._lastDeckIndex = idx;
      } else if (idx !== this._lastDeckIndex) {
        this._lastDeckIndex = idx;
        this._deckSelectionTime = nowSec;
        this._cancelCompletedOverlay();
      }
      this._maybeTriggerCompletedOverlay(nowSec);
    } else {
      if (this._completedOverlayState.activeKey) this._cancelCompletedOverlay();
    }

    if (this.completedOverlay) {
      this.completedOverlay.update(dt, nowSec);
    }

    this._updateTimerText();

    this._updateAudio(dt);

    if (this.params.rulerUI?.enabled) this._updateRulerPosition();

    this._updateCursorAnim(dt);
    this._updateRadars(dt);

    // Keep haze aligned if params change, or if surfaceLevel moves
    if (this.shoreHazeMesh && this.params.shoreHaze?.enabled) {
      this.updateShoreHazeLayout();
    }

    if (this.shoreVegBackgroundGroup && this.params.shoreVegBackground?.enabled) {
      this.updateShoreVegBackgroundLayout();
    }

    if (this.shoreVegBackgroundGroup2 && this.params.shoreVegBackground2?.enabled) {
      this.updateShoreVegBackgroundLayout2();
    }

    // Update bubble system
    if (this.surfaceFX?.bubbleSystem) {
      this.surfaceFX.bubbleSystem.update(dt);
    }

    // --- Soft Particles Depth Pass ---
    if (this.params.mist?.enabled && this.depthTarget && this.app.renderer) {
      const renderer = this.app.renderer;
      
      // 1. Hide mist and render everything else to a texture
      this.mistGroup.visible = false;
      renderer.setRenderTarget(this.depthTarget);
      renderer.clear();
      renderer.render(this.scene, this.camera);

      // 2. Prepare uniforms for the next pass
      if (this._mist && this._mist.mat && this._mist.mat.uniforms.tDepth) {
        this._mist.mat.uniforms.tDepth.value = this.depthTarget.depthTexture;
        this._mist.mat.uniforms.cameraNear.value = this.camera.near;
        this._mist.mat.uniforms.cameraFar.value = this.camera.far;
        this._mist.mat.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
      }
      
      // 3. Show mist again so the main app renderer will draw it
      this.mistGroup.visible = true;
      renderer.setRenderTarget(null);
    }
  }

  updateFish(dt) {
    const pf = this.params.fish;
    const now = performance.now() * 0.001;

    this._sepAccum += dt;
    const doSeparationTick = (this._sepAccum >= (1 / this._sepHz));
    if (doSeparationTick) {
      this._hash.s = Math.max(1e-3, pf.separationRadius); // cell ~= radius
      this._hash.rebuild(this.fish);
      this._sepAccum = 0;
    }

    const renderDistSq = pf.renderDistance * pf.renderDistance;

    for (const a of this.fish) {
      // Retarget if reached, timed out, or target left the box (due to camera X change)
      this._v1.copy(a.target).sub(a.pos);
      if (this._v1.length() < pf.targetReachDist || now >= a.nextRetargetAt || !this.swimBox.containsPoint(a.target)) {
        a.target = a.species.randBiasedPoint(this.swimBox);
        const ret = pf.retargetTime; a.nextRetargetAt = now + lerp(ret[0], ret[1], Math.random());
      }

      // Steering forces
      if (!a._sepForce) a._sepForce = new THREE.Vector3();
      if (doSeparationTick) {
        const local = this._hash.neighbors(a.pos); // nearby fish only
        this.steerSeparation(a, local, pf.separationRadius, pf.separationStrength, a._sepForce);
      }

      // Sum forces into _v1 (avoiding new Vector3)
      const force = this._v1;
      force.set(0, 0, 0);

      this.steerSeek(a, a.target, this._v2, 1.0);
      force.add(this._v2);

      force.add(a._sepForce);

      this.steerContain(a, this._v2);
      force.add(this._v2.multiplyScalar(6.0));

      if (force.length() > pf.accel) force.setLength(pf.accel);

      // Integrate velocity and clamp speed per species
      a.vel.addScaledVector(force, dt);
      const spd = a.vel.length();
      const max = a.speedMax, min = Math.min(a.speedMin, max * 0.9);
      if (spd > max) a.vel.setLength(max);
      else if (spd < min) a.vel.setLength(min);

      // Integrate position and clamp to swimBox
      a.pos.addScaledVector(a.vel, dt);
      this.projectInsideSwimBox(a.pos);

      // Visibility + transform
      const distSq = this.camera.position.distanceToSquared(a.pos);
      const isVisible = distSq <= renderDistSq;

      a.mesh.visible = isVisible;
      if (isVisible) {
        // Advance animation
        if (a.mixer) a.mixer.update(dt);

        // --- Procedural wiggle (robust + self-healing), supports head or tail ---
        if (a.wiggle?.enabled) {
          const needsRecover =
            !a.wiggleBone ||
            !a.wiggleBone.rotation ||
            typeof a.wiggleBone.rotation.set !== 'function';

          if (needsRecover && !a._wiggleFailed) {
            // Try to reacquire from the clone's skeleton, honoring 'moving'
            let sk = null;
            a.mesh.traverse(o => { if (!sk && o.isSkinnedMesh) sk = o; });

            if (sk) {
              // Recompute local forward from current mesh bbox + flips
              this._tmpBox.setFromObject(a.mesh);
              const size = this._v2; // reuse _v2
              this._tmpBox.getSize(size);
              const axes = [
                { v: new THREE.Vector3(1,0,0), len: size.x },
                { v: new THREE.Vector3(0,1,0), len: size.y },
                { v: new THREE.Vector3(0,0,1), len: size.z },
              ].sort((aa,bb)=>bb.len-aa.len);
              let forwardLocal = axes[0].v.clone().normalize();

              const flips = (a.species?.def?.flips) || {x:false,y:false,z:false};
              if (flips.x) forwardLocal.x *= -1;
              if (flips.y) forwardLocal.y *= -1;
              if (flips.z) forwardLocal.z *= -1;

              if ((a.wiggle.moving || 'tail') === 'head') {
                a.wiggleBone = findHeadBoneDirectional(sk, { ownerMesh: a.mesh, forwardLocal }) ||
                                findTailBoneFromSkeleton(sk);
              } else {
                a.wiggleBone = findTailBoneDirectional(sk, { ownerMesh: a.mesh, forwardLocal }) ||
                                findTailBoneFromSkeleton(sk);
              }
              
              if (!a.wiggleBone) a._wiggleFailed = true;
            } else {
              a._wiggleFailed = true;
            }
          }

          if (a.wiggleBone && a.wiggleBone.rotation && typeof a.wiggleBone.rotation.set === 'function') {
            const T   = a.wiggle.periodSec || 0.8;
            const Amp = THREE.MathUtils.degToRad(a.wiggle.amplitudeDeg || 16);
            const speedFactor = THREE.MathUtils.clamp(a.vel.length() / Math.max(1e-4, a.speedMax), 0.4, 1.2);
            a.wigglePhase += (dt / Math.max(0.05, T)) * 2 * Math.PI * speedFactor;

            const ang = Amp * Math.sin(a.wigglePhase);
            a.wiggleBone.rotation.set(0, 0, 0);
            if ((a.wiggle.mode || 'lr') === 'ud') {
              a.wiggleBone.rotation.x = ang;
            } else {
              a.wiggleBone.rotation.y = ang; // default left/right
            }
          }
        }


        // Orient and place
        a.applyOrientation();
        a.mesh.position.copy(a.pos);


      }
    }
  }

  _updateAmbient(force = false) {
    if (!this.sounds.surface || !this.sounds.underwater) return;

    const isUnderwater = this.isUnderwaterStable();
    const prev = this.audioState.ambientUnder;

    // Sin cambio y sin force → nada
    if (!force && prev === isUnderwater) return;

    const { offsets } = this.params.audio;

    if (isUnderwater) {
      // Vamos a loop submarino
      this._stopAudioSafely(this.sounds.surface);

      // Motivo: transición (arriba→abajo) si prev === false
      const offset = (prev === false) ? offsets.underwater.onTransitionEnterSec
                                      : offsets.underwater.defaultStartSec;
      const loopStart = offsets.underwater.loopStartSec;

      this._playLoopWithOffset(this.sounds.underwater, offset, loopStart);
      this.sounds.underwater.setVolume(this.params.audio.volumes.underwater);
    } else {
      // Vamos a loop de superficie
      this._stopAudioSafely(this.sounds.underwater);

      // Motivo: transición (abajo→arriba) si prev === true
      const offset = (prev === true) ? offsets.surface.onTransitionEnterSec
                                     : offsets.surface.defaultStartSec;
      const loopStart = offsets.surface.loopStartSec;

      this._playLoopWithOffset(this.sounds.surface, offset, loopStart);
      this.sounds.surface.setVolume(this.params.audio.volumes.surface);
    }

    // Guardar estado
    this.audioState.ambientUnder = isUnderwater;
  }


  _playLoopWithOffset(audio, offsetSec = 0, loopStartSec = 0) {
    if (!audio || !audio.buffer) return;

    // Si estaba sonando, paramos
    if (audio.isPlaying) {
      try { audio.stop(); } catch (_) {}
    }

    const ctx = this.audioListener.context;
    const source = ctx.createBufferSource();
    source.buffer = audio.buffer;
    source.loop = true;
    source.loopStart = Math.max(0, loopStartSec);  // desde dónde relupa
    // loopEnd opcional; si querés el final del buffer entero, no lo toques

    // Conectar la nueva source a la salida del THREE.Audio
    source.connect(audio.getOutput());
    // Guardar la source en el THREE.Audio para que .stop() funcione
    audio.source = source;
    audio.isPlaying = true;

    // Arrancar con offset (segundo parámetro es offset en el buffer)
    const now = ctx.currentTime;
    source.start(now, Math.max(0, offsetSec));
  }

  _stopAudioSafely(audio) {
    if (!audio) return;
    try { if (audio.isPlaying) audio.stop(); } catch (_) {}
  }


  isUnderwaterStable() {
    const eps = this.params.audio.surfaceHysteresis || 0;
    // Cuando ya estábamos bajo agua, pedimos un poco más por encima para salir (histeresis)
    const y = this.camera.position.y;
    const s = this.params.surfaceLevel;
    const prevUnder = this.audioState.ambientUnder; // puede ser undefined al inicio
    if (prevUnder === true) {
      return y < (s + eps); // exigimos pasar un poquito por encima para “salir”
    } else if (prevUnder === false) {
      return y < (s - eps); // exigimos bajar un poquito para “entrar”
    }
    // sin estado previo, decisión directa sin margen
    return y < s;
  }


  playSfx(kind) {
    if (kind === 'catch' && this.sounds.sfxCatch) {
      this.sounds.sfxCatch.stop(); // reinicia si se pisa
      this.sounds.sfxCatch.play();
    } else if (kind === 'wrong' && this.sounds.sfxWrong) {
      this.sounds.sfxWrong.stop();
      this.sounds.sfxWrong.play();
    } else if (kind === 'completed' && this.sounds.sfxCompleted) {
      this.sounds.sfxCompleted.stop();
      this.sounds.sfxCompleted.play();
    }
  }


  /* ------------------------------- Steering helpers ------------------------------ */

  steerSeek(agent, target, out, intensity = 1) {
    out.copy(target).sub(agent.pos);
    const d = out.length();
    if (d < 1e-5) {
      out.set(0, 0, 0);
      return out;
    }
    out.normalize().multiplyScalar(agent.speedMax);
    out.sub(agent.vel).multiplyScalar(intensity);
    return out;
  }

  steerSeparation(agent, neighbors, radius, strength, out) {
    out.set(0, 0, 0);
    let count = 0;
    const r2 = radius * radius;
    for (const other of neighbors) {
      if (other === agent) continue;
      // Use _v3 as a temporary for diff
      this._v3.copy(agent.pos).sub(other.pos);
      const d2 = this._v3.lengthSq();
      if (d2 > 0 && d2 < r2) {
        this._v3.normalize().multiplyScalar(1.0 / d2);
        out.add(this._v3);
        count++;
      }
    }
    if (count > 0) out.multiplyScalar(strength);
    return out;
  }

  steerContain(agent, out) {
    // Simple inward push when at/near the box faces (zero margin => only when outside)
    out.set(0, 0, 0);
    const p = agent.pos;
    const b = this.swimBox;

    let d = p.x - b.min.x; if (d < 0) out.x += -d;
    d = b.max.x - p.x;     if (d < 0) out.x -= -d;

    d = p.y - b.min.y;     if (d < 0) out.y += -d;
    d = b.max.y - p.y;     if (d < 0) out.y -= -d;

    d = p.z - b.min.z;     if (d < 0) out.z += -d;
    d = b.max.z - p.z;     if (d < 0) out.z -= -d;

    return out;
  }

  /* ---------------------------------- Resize ---------------------------------- */

  onResize(w, h) {
    super.onResize(w, h);
    if (this.depthTarget) {
      this.depthTarget.setSize(w, h);
    }
    if (this._mist && this._mist.mat && this._mist.mat.uniforms.resolution) {
      this._mist.mat.uniforms.resolution.value.set(w, h);
    }
    this.camera.lookAt(this.camera.position.clone().add(this.forward));
    if (this.model) {
      this.scene.updateMatrixWorld(true);
      if (this.params.debug.tiles) this.rebuildTiles();
      if (this.params.debug.water) this.buildOrUpdateWaterSurface();
      // Keep swimBox aligned to explicit params and current cameraLevel
      this.updateSwimBoxDynamic();
    }
    if (this.deck) this.deck.updateLayout(); // keep card sizes/aspect on resize

    if (this.mistGroup && this.params.mist?.enabled) {
      this.resizeMistLayer();
    }

    if (this.params.rulerUI?.enabled) {
      this._updateRulerLayout();
      this._updateRulerPosition();
    }

    if (this.shoreHazeMesh && this.params.shoreHaze?.enabled) {
      this.updateShoreHazeLayout();
    }

    if (this.shoreVegBackgroundGroup && this.params.shoreVegBackground?.enabled) {
      this.updateShoreVegBackgroundLayout();
    }

    if (this.shoreVegBackgroundGroup2 && this.params.shoreVegBackground2?.enabled) {
      this.updateShoreVegBackgroundLayout2();
    }

    this._updateTimerLayout?.();

    if (this.completedOverlay) {
      this.completedOverlay.updateLayout();
    }

    if (this.skyDome) {
      const newR = Math.max(10, this.camera.far * 0.9);
      // Rebuild geometry to match new radius
      const old = this.skyDome.geometry;
      this.skyDome.geometry = new THREE.SphereGeometry(newR, 32, 16);
      old?.dispose?.();
    }

  }

  _updateAudio(dt) {
    let hasMusic = !!(this.lowpassFilter && this.sounds.music);
    let hasLanchas = !!(this.lowpassFilterLanchas && this.sounds.lanchas);
    if (!hasMusic && !hasLanchas) return;

    if (hasMusic && !this.audioState.musicGainNode) {
      const gain = this.sounds.music.getOutput();
      if (gain && gain.gain) {
        this.audioState.musicGainNode = gain.gain;
      } else {
        hasMusic = false;
      }
    }

    if (hasLanchas && !this.audioState.lanchasGainNode) {
      const gain = this.sounds.lanchas.getOutput();
      if (gain && gain.gain) {
        this.audioState.lanchasGainNode = gain.gain;
      } else {
        hasLanchas = false;
      }
    }

    if (!hasMusic && !hasLanchas) return;

    const { surfaceLevel, floorLevel, audio } = this.params;
    const { aboveHz, surfaceUnderHz, bottomHz, rampEnterSec, rampExitSec, rampWhileSec, depthCurve } = audio.eq;

    const camY = this.camera.position.y;
    const isUnderwater = this.isUnderwaterStable();

    // 1) Detectar toggle de EQ (antes de tocar loops)
    const prevEq = this.audioState.eqUnderPrev;
    const justToggled = (prevEq !== undefined && isUnderwater !== prevEq);

    // 2) Luego sí, actualizar loops (arriba/abajo)
    this._updateAmbient(false);

    // 3) Automatización del EQ + volumen del tema continuo
    const audioContext = this.audioListener.context;
    const now = audioContext.currentTime;

    // Normalizamos profundidad sólo si está bajo la superficie
    const totalDepth = Math.max(1e-6, surfaceLevel - floorLevel);
    const depth = isUnderwater ? (surfaceLevel - camY) : 0;
    let depthT = THREE.MathUtils.clamp(depth / totalDepth, 0, 1);

    // Curva de profundidad
    if (depthCurve === 'exp') {
      const k = 2.2; // ajustable
      depthT = Math.pow(depthT, k);
    }

    // Frecuencia objetivo
    let targetHz;
    if (isUnderwater) {
      targetHz = THREE.MathUtils.lerp(surfaceUnderHz, bottomHz, depthT);
    } else {
      targetHz = aboveHz;
    }

    // Tiempo de rampa
    const rampSec = justToggled
      ? (isUnderwater ? rampEnterSec : rampExitSec)
      : rampWhileSec;

    const rampTargetTime = now + Math.max(0.01, rampSec);

    if (hasMusic) {
      try {
        this.lowpassFilter.frequency.cancelScheduledValues(now);
      } catch (_) {}
      this.lowpassFilter.frequency.setValueAtTime(this.lowpassFilter.frequency.value, now);
      this.lowpassFilter.frequency.linearRampToValueAtTime(targetHz, rampTargetTime);
    }

    if (hasLanchas) {
      try {
        this.lowpassFilterLanchas.frequency.cancelScheduledValues(now);
      } catch (_) {}
      this.lowpassFilterLanchas.frequency.setValueAtTime(this.lowpassFilterLanchas.frequency.value, now);
      this.lowpassFilterLanchas.frequency.linearRampToValueAtTime(targetHz, rampTargetTime);
    }

    // --- Volumen del tema continuo vs. profundidad (con rampas) ---
    const { maxVolAbove, maxVolUnder, minVolBottom } = audio.musicDepth;

    // 1. Determinar el volumen objetivo
    let targetVol;
    if (isUnderwater) {
      // Interpolar entre el nuevo volumen máximo submarino y el mínimo del fondo
      targetVol = maxVolUnder - (maxVolUnder - minVolBottom) * depthT;
    } else {
      // Usar el volumen estándar de la superficie
      targetVol = maxVolAbove;
    }

    const gainNodes = [];
    if (hasMusic && this.audioState.musicGainNode) gainNodes.push(this.audioState.musicGainNode);
    if (hasLanchas && this.audioState.lanchasGainNode) gainNodes.push(this.audioState.lanchasGainNode);

    for (const node of gainNodes) {
      try {
        node.cancelScheduledValues(now);
      } catch (_) {}
      node.setValueAtTime(node.value, now);
      node.linearRampToValueAtTime(targetVol, rampTargetTime);
    }

    // 4) Guardar estado del EQ para el próximo frame
    this.audioState.eqUnderPrev = isUnderwater;
  }


}