import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import { AssetLoader } from '../core/AssetLoader.js';

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
 * Param scales and species configuration
 * ------------------------------------------------------------- */
const SizeScale       = { small: 1.0,  medium: 1.5,  large: 2.0 };
const SpeedScale      = { slow: 0.3,   medium: 1.0,  fast: 2.0 };
const AbundanceCount  = { scarce: 5,   usual: 20,    veryCommon: 50 };

/**
 * Species water-column / shore mapping keys:
 *   - water: 'surface' | 'midwater' | 'bottom'
 *   - shore: 'near'    | 'mid'      | 'deep'
 *
 * If a GLB fails to load, a colored prism is used as fallback.
 * `flips` may invert local axes so the auto-detected long axis
 * points “forward” correctly per model.
 */
const SPECIES = [
  {
    key: 'dorado',
    displayName: 'Dorado (Salminus brasiliensis)',
    glb: '/game-assets/sub/fish/dorado.glb',
    fallbackColor: 0xF3C623,
    flips: { x: false, y: false, z: false },
    size: 'large', abundance: 'usual', speed: 'fast', water: 'midwater', shore: 'mid'
  },
  {
    key: 'sabalo',
    displayName: 'Sábalo (Prochilodus lineatus)',
    glb: '/game-assets/sub/fish/sabalo.glb',
    fallbackColor: 0x9FB2BF,
    flips: { x: false, y: false, z: true },
    size: 'medium', abundance: 'veryCommon', speed: 'medium', water: 'bottom', shore: 'near'
  },
  {
    key: 'pacu',
    displayName: 'Pacú (Piaractus mesopotamicus)',
    glb: '/game-assets/sub/fish/pacu.glb',
    fallbackColor: 0xA14A2E,
    flips: { x: false, y: false, z: true },
    size: 'medium', abundance: 'usual', speed: 'medium', water: 'surface', shore: 'mid'
  },
  {
    key: 'armado_chancho',
    displayName: 'Armado chancho (Pterodoras granulosus)',
    glb: '/game-assets/sub/fish/armado_chancho.glb',
    fallbackColor: 0x6D5D4B,
    flips: { x: false, y: false, z: false },
    size: 'medium', abundance: 'usual', speed: 'slow', water: 'bottom', shore: 'deep'
  },
  {
    key: 'palometa_brava',
    displayName: 'Palometa brava (Serrasalmus maculatus)',
    glb: '/game-assets/sub/fish/palometa_brava.glb',
    fallbackColor: 0xD04F4F,
    flips: { x: false, y: false, z: false },
    size: 'small', abundance: 'veryCommon', speed: 'fast', water: 'surface', shore: 'near'
  },
  {
    key: 'vieja_del_agua',
    displayName: 'Vieja del agua (Hypostomus commersoni)',
    glb: '/game-assets/sub/fish/vieja_del_agua.glb',
    fallbackColor: 0x556B2F,
    flips: { x: false, y: false, z: false },
    size: 'medium', abundance: 'veryCommon', speed: 'slow', water: 'bottom', shore: 'mid'
  },
  {
    key: 'surubi_pintado',
    displayName: 'Surubí pintado (Pseudoplatystoma corruscans)',
    glb: '/game-assets/sub/fish/surubi_pintado.glb',
    fallbackColor: 0xC0C0C0,
    flips: { x: false, y: false, z: true },
    size: 'large', abundance: 'scarce', speed: 'medium', water: 'midwater', shore: 'deep'
  },
  {
    key: 'raya_negra',
    displayName: 'Raya negra (Potamotrygon spp.)',
    glb: '/game-assets/sub/fish/raya_negra.glb',
    fallbackColor: 0x222222,
    flips: { x: false, y: true, z: false }, // many ray models are flat with Y up
    size: 'medium', abundance: 'usual', speed: 'slow', water: 'bottom', shore: 'near'
  }
];

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
  shoreLevel:  40.0,     // x of shoreline (swimbox min X)
  leftLimit:   -60.0,    // z min for both camera and swimbox
  rightLimit:   60.0,    // z max for both camera and swimbox

  /** Camera constraints aligned to world limits */
  cameraSurfaceMargin: 0.5,   // how much camera may go above surfaceLevel
  cameraFloorMargin:  4.0,    // how much camera must stay above floorLevel
  cameraLeftMargin:   40.0,    // how far from leftLimit (Z min) the camera is kept
  cameraRightMargin:  40.0,    // how far from rightLimit (Z max) the camera is kept
  cameraXBounds: [-300, 300], // x soft bounds; shoreLevel still acts as hard min

  /** Mouse-driven camera motion (x = shore↔deep, y = up↔down) */
  speeds: { x: 8.0, y: 10.0 },
  wheelStepX: 2.0,
  responseCurve: { x: 1.0, y: 1.35 },
  deadzone: 0.08,
  damping: 0.15,

  /** Visuals */
  skyColor: 0x87ceeb,
  waterColor: 0x0a1a3a,
  waterSurfaceOpacity: 0.8,

  /** Fog (enabled when camera is UNDER the surfaceLevel) */
  fogNear: 5.0,   // distance where fog starts (no hidden derivation)
  fogFar:  60.0,  // distance where fog fully obscures

  /** Base model scale and tiling (floor/walls GLB) */
  overrideScale: 129.36780721031408, // explicit scale; if null, scale to modelLongestTarget
  modelLongestTarget: 129.368,
  tiling: { countEachSide: 5, gap: -20.0 },

  /** Fish baseline behavior (species modify around these) */
  fish: {
    speedMin: 2.0,
    speedMax: 4.0,
    accel: 8.0,
    separationRadius: 2.0,
    separationStrength: 1.2,
    targetReachDist: 1.5,
    retargetTime: [4.0, 8.0], // [min, max] seconds
    fallbackDims: { x: 1.6, y: 0.4, z: 0.5 },
  },

  /**
   * Fish position biasing inside the swimBox:
   * Means are fractional positions along the respective axis of the swimBox.
   *   X means refer to shore→camera span (minX→maxX).
   *   Y means refer to floor→surface span (minY→maxY).
   * Standard deviations are *fractions* of the corresponding span.
   *
   * Defaults: σ = 0 for X and Y to remove randomness for debugging.
   */
  fishPositionBias: {
    meansX: { near: 0.15,  mid: 0.50, deep: 0.85 },
    sigmaX: { near: 0.20,  mid: 0.20, deep: 0.20 }, // set >0 later (e.g., 0.10)
    meansY: { surface: 0.92, midwater: 0.50, bottom: 0.05 },
    sigmaY: { surface: 0.20, midwater: 0.20, bottom: 0.20 }, // set >0 later (e.g., 0.12)
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
  }

  async ensureTemplate() {
    if (this.template) return this.template;
    try {
      const gltf = await AssetLoader.gltf(this.def.glb);
      const root = (gltf.scene || gltf.scenes?.[0])?.clone(true);
      if (root) {
        this.template = root;
        this.usesFallback = false;
        return this.template;
      }
    } catch(_) { /* fallthrough to fallback */ }

    // Fallback: colored prism
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
    const mesh = this.template.clone(true);
    
    // Assign a unique name for raycasting
    mesh.name = `fish_${this.def.key}_${Math.random().toString(36).substr(2, 9)}`;
    mesh.userData.speciesKey = this.def.key;


    // Scale by species size
    mesh.scale.multiplyScalar(this.sizeScale);

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

    const agent = new FishAgent({
      mesh, pos, vel, target, nextRetargetAt,
      speedMin, speedMax, species: this
    });
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

  applyOrientation() {
    const v = this.vel.clone();
    if (v.lengthSq() < 1e-10) return;
    v.normalize();

    const localFwd = this._detectLocalForward();
    const q = new THREE.Quaternion().setFromUnitVectors(localFwd, v);
    this.mesh.quaternion.copy(q);
  }
}

/* ========================================================================== */
/* Deck UI for fish catching gameplay                                         */
/* ========================================================================== */
class Deck {
  constructor(speciesList, speciesObjs) {
    this.cardSeparation = 220;
    this.modelScaleMultiplier = 2.5;
    this.startIndex = 3;
    this.speciesList = speciesList;
    this.speciesObjs = speciesObjs;
    this.cards = [];
    this.currentIndex = Math.max(0, Math.min(this.startIndex, this.speciesList.length - 1));
    this.isAnimating = false;

    this.container = document.createElement('div');
    this.container.id = 'deck-container';
    document.body.appendChild(this.container);

    this.silhouetteMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  }

  async build() {
    for (let i = 0; i < this.speciesList.length; i++) {
      const speciesDef = this.speciesList[i];
      const speciesObj = this.speciesObjs.find(s => s.def.key === speciesDef.key);

      const cardEl = document.createElement('div');
      cardEl.className = 'deck-card';
      cardEl.dataset.speciesKey = speciesDef.key;

      const canvasEl = document.createElement('canvas');
      cardEl.appendChild(canvasEl);

      const nameEl = document.createElement('div');
      nameEl.className = 'species-name';
      nameEl.textContent = speciesDef.displayName;
      cardEl.appendChild(nameEl);

      const counterEl = document.createElement('div');
      counterEl.className = 'catch-counter';
      counterEl.textContent = 'Encontrados: 0';
      cardEl.appendChild(counterEl);

      this.container.appendChild(cardEl);

      const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, alpha: true });
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
      const model = speciesObj.template.clone(true);
      
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      model.scale.multiplyScalar(this.modelScaleMultiplier / maxDim);

      box.setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);

      scene.add(model);

      this.cards.push({
        key: speciesDef.key,
        element: cardEl,
        renderer,
        scene,
        camera,
        model,
        counterEl,
        nameEl,
        revealed: false,
        count: 0,
        originalMaterials: this.cloneMaterials(model)
      });
      
      this.setSilhouette(i);
    }
    this.updateCarousel();
    this.container.style.opacity = 1;
  }

  cloneMaterials(model) {
      const map = new Map();
      model.traverse(o => {
          if (o.isMesh) {
              map.set(o, o.material);
          }
      });
      return map;
  }

  setSilhouette(cardIndex) {
      const card = this.cards[cardIndex];
      card.model.traverse(o => {
          if (o.isMesh) {
              o.material = this.silhouetteMaterial;
          }
      });
  }

  setRevealed(cardIndex) {
      const card = this.cards[cardIndex];
      card.revealed = true;
      card.model.traverse(o => {
          if (o.isMesh) {
              o.material = card.originalMaterials.get(o);
          }
      });
  }

  cycle(direction) {
    if (this.isAnimating) return;
    this.currentIndex = (this.currentIndex + direction + this.cards.length) % this.cards.length;
    this.updateCarousel();
  }

  updateCarousel() {
    this.isAnimating = true;
    this.cards.forEach((card, i) => {
      const offset = i - this.currentIndex;
      const isCenter = (offset === 0);

      card.element.style.transform = `translateX(${offset * this.cardSeparation}px) scale(${isCenter ? 1.2 : 0.8})`;
      card.element.style.opacity = isCenter ? '1' : '0.6';
      card.element.style.zIndex = this.cards.length - Math.abs(offset);
    });
    setTimeout(() => { this.isAnimating = false }, 300); // Animation duration
  }
  
  checkMatch(speciesKey) {
    const currentCard = this.cards[this.currentIndex];
    if (currentCard.key === speciesKey) {
      if (!currentCard.revealed) {
        this.setRevealed(this.currentIndex);
      }
      currentCard.count++;
      currentCard.counterEl.textContent = `Encontrados: ${currentCard.count}`;
      this.flashBorder(currentCard.element, 'green');
      return true; // Match!
    } else {
      this.flashBorder(currentCard.element, 'red');
      return false; // No match
    }
  }

  flashBorder(element, color) {
      element.classList.add(`flash-${color}`);
      setTimeout(() => element.classList.remove(`flash-${color}`), 1000);
  }

  update(dt) {
    this.cards.forEach(card => {
      card.model.rotation.y += 0.5 * dt;
      card.renderer.render(card.scene, card.camera);
    });
  }
  
  destroy() {
      document.body.removeChild(this.container);
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
    
    // Raycasting for fish clicks
    this.raycaster = new THREE.Raycaster();
    this.clickMouse = new THREE.Vector2();

    // Reusables
    this.tmpRight = new THREE.Vector3();
    this.tmpUp = new THREE.Vector3(0, 1, 0);
    this.tmpDelta = new THREE.Vector3();

    // Scene content
    this.model = null;
    this.tilesGroup = new THREE.Group();
    this.scene.add(this.tilesGroup);

    // Water
    this.waterSurface = null;

    // SwimBox (world-aligned, explicit bounds)
    this.swimBox = new THREE.Box3();

    // Fish containers
    this.fish = [];
    this.speciesObjs = [];
    
    // Deck UI
    this.deck = null;

    // Spatial hash + throttled steering
    this._hash = new SpatialHash(3.0); // will be reset to separationRadius later
    this._sepAccum = 0;
    this._sepHz = 30;

    // ------ Instancing support (all species) ------
    this.instancedGroup = new THREE.Group();
    this.instancedGroup.name = 'instanced-fish';
    this.scene.add(this.instancedGroup);

    // Map: speciesKey -> { inst, activeCount, agents, agentIndexByInstanceId }
    this.instanced = new Map();

    // (Optional) keep a non-instanced group; may stay empty now
    this.fishGroup = new THREE.Group();
    this.fishGroup.name = 'fish-group';
    this.scene.add(this.fishGroup);
  }

  /* --------------------------------- Lifecycle --------------------------------- */

  async mount() {
    // Background + lights
    this.scene.background = new THREE.Color(this.params.skyColor);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a4a5a, 1.0);
    const dir  = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(8, 12, 6);
    dir.castShadow = false;
    this.scene.add(hemi, dir);

    // Load environment model (floor/walls)
    try {
      const gltf = await AssetLoader.gltf('/game-assets/sub/sub_floor.glb');
      this.model = gltf.scene || gltf.scenes?.[0];
      if (this.model) {
        this.model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        this.scene.add(this.model);
        this.recenterToFloor(this.model);

        if (Number.isFinite(this.params.overrideScale)) {
          this.model.scale.setScalar(this.params.overrideScale);
        } else {
          this.scaleModelToLongest(this.model, this.params.modelLongestTarget);
        }
      }
    } catch (err) {
      console.error('Error loading sub_floor.glb', err);
    }

    // Camera pose & yaw
    const { x, y, z, yawDeg } = this.params.start;
    this.camera.position.set(x, y, z);
    this.setYaw(yawDeg);
    this.params.swimBoxMaxX = this.params.start.x;
    this.camera.lookAt(this.camera.position.clone().add(this.forward));

    this.camera.near = 0.1;
    this.camera.far  = 120;   // try 80–150; lower = faster
    this.camera.updateProjectionMatrix();

    // Build tiling & water after model is in the scene
    if (this.model) {
      this.scene.updateMatrixWorld(true);
      this.rebuildTiles();
      this.buildOrUpdateWaterSurface();
    }

    // Initialize explicit swimBox using the world parameters directly
    this.initSwimBoxFromParams();

    // Prepare species objects (use explicit bias block)
    this.speciesObjs = SPECIES.map(def =>
      new FishSpecies(def, this.scene, this.params.fish, this.params.fishPositionBias)
    );
    
    // Build the Deck UI
    this.deck = new Deck(SPECIES, this.speciesObjs);
    await this.deck.build();

    // Spawn fish by abundance
    await this.spawnFishBySpecies();

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

    this._onWheel = (e) => this.onWheel(e);
    this.app.canvas.addEventListener('wheel', this._onWheel, { passive: false });
  }

  async unmount() {
    this.app.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.app.canvas.removeEventListener('mouseleave', this._onMouseLeave);
    this.app.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('keydown', this._onKeyDown);
    this.app.canvas.removeEventListener('wheel', this._onWheel);
    if (this.deck) this.deck.destroy();
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
    const tileStep = baseWidth + this.params.tiling.gap;

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
    const tileStep = baseWidthRight + this.params.tiling.gap;
    const totalRightSpan = Math.max(0.01, baseWidthRight + 2 * n * tileStep);

    const fwd = this.forward.clone().normalize();
    const baseWidthForward = Math.max(0.01, this.widthAlongDirectionWorld(this.model || new THREE.Object3D(), fwd));

    const sx = totalRightSpan * 1.1;
    const sz = baseWidthForward * 2.0;

    if (!this.waterSurface) {
      const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
      const mat = new THREE.MeshPhysicalMaterial({
        color: this.params.waterColor,
        transparent: true,
        opacity: this.params.waterSurfaceOpacity,
        roughness: 0.9,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      this.waterSurface = new THREE.Mesh(geo, mat);
      this.waterSurface.rotation.x = -Math.PI / 2;
      this.scene.add(this.waterSurface);
    }
    this.waterSurface.position.set(0, y, 0);
    this.waterSurface.scale.set(sx, sz, 1);
  }

  updateFog() {
    // Fog is enabled only when camera is below the explicit surfaceLevel.
    const isUnder = (this.camera.position.y < this.params.surfaceLevel);
    if (isUnder) {
      if (!this.scene.fog) {
        this.scene.fog = new THREE.Fog(this.params.waterColor, this.params.fogNear, this.params.fogFar);
      } else {
        this.scene.fog.color.set(this.params.waterColor);
        this.scene.fog.near = this.params.fogNear;
        this.scene.fog.far  = this.params.fogFar;
      }
    } else {
      this.scene.fog = null;
    }
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

      // Create InstancedMesh for this species (we instance ALL species)
      const bag = this._createInstancedForSpecies(sp, sp.count);

      if (!bag) {
        // Fallback: non-instanced if no mesh found in template
        for (let i = 0; i < sp.count; i++) {
          const agent = await sp.createAgent(this.swimBox);
          this.fish.push(agent);
          this.fishGroup.add(agent.mesh);
        }
        continue;
      }

      // Spawn agents; don't add their meshes to scene; we write instance matrices
      for (let i = 0; i < sp.count; i++) {
        const agent = await sp.createAgent(this.swimBox);

        // mark as instanced
        agent.instanceId = bag.activeCount;
        // hide standalone mesh (we keep it only for scale/orientation queries)
        agent.mesh.visible = false;

        // push to global agents list
        this.fish.push(agent);

        // track in per-species bag
        bag.agents.push(agent);
        bag.instances[agent.instanceId] = agent; 

        // compose initial matrix so fish appear immediately
        const v = agent.vel.clone();
        if (v.lengthSq() > 1e-10) v.normalize();
        const localFwd = agent._detectLocalForward ? agent._detectLocalForward() : new THREE.Vector3(1, 0, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(localFwd, v);
        const m = new THREE.Matrix4();
        const scl = agent.mesh?.scale || new THREE.Vector3(1, 1, 1);
        m.compose(agent.pos, q, scl);
        bag.inst.setMatrixAt(agent.instanceId, m);

        bag.activeCount++;
      }

      bag.inst.count = bag.activeCount;
      bag.inst.instanceMatrix.needsUpdate = true;
    }
  }

  /* --------------------------------- Input & UX --------------------------------- */
  onKeyDown(e) {
      if (e.key === 'ArrowRight') {
          this.deck.cycle(1);
      } else if (e.key === 'ArrowLeft') {
          this.deck.cycle(-1);
      }
  }

    onWheel(e) {
      // Scroll up (deltaY < 0) => decrease X; scroll down => increase X.
      // Limits: min = swimBox.min.x (shore), max = starting camera X.
      e.preventDefault();

      const step = this.params.wheelStepX ?? 2.0;
      const dir = Math.sign(e.deltaY); // +1 when scrolling down, -1 up

      // compute new X
      const minX = (this.swimBox?.min?.x ?? this.params.shoreLevel);
      const maxX = this.params.start.x;
      let newX = this.camera.position.x + (dir > 0 ? +step : -step);

      // clamp and apply
      newX = clamp(newX, minX, maxX);
      this.camera.position.x = newX;

      // keep systems in sync
      this.updateSwimBoxDynamic();
      this.camera.lookAt(this.camera.position.clone().add(this.forward));
    }


  onMouseDown(e) {
    const rect = this.app.canvas.getBoundingClientRect();
    this.clickMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.clickMouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    
    this.raycaster.setFromCamera(this.clickMouse, this.camera);
    //const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    const raycastTargets = [
      ...this.fishGroup.children,     // non-instanced (may be empty)
      ...this.instancedGroup.children // InstancedMesh per species
    ];
    const intersects = this.raycaster.intersectObjects(raycastTargets, true);

    for (const intersect of intersects) {
      let obj = intersect.object;

      // InstancedMesh path
      if (obj.isInstancedMesh && obj.userData.speciesKey && Number.isInteger(intersect.instanceId)) {
        const speciesKey = obj.userData.speciesKey;
        const bag = this.instanced.get(speciesKey);
        if (bag) {
          const agent = bag.instances[intersect.instanceId];
          if (agent) {
            const isMatch = this.deck.checkMatch(speciesKey);
            if (isMatch) this.catchFish(agent); // pass the Agent
            return;
          }
        }
      }

      // Non-instanced path (walk up parents to find a mesh with a speciesKey)
      while (obj) {
        if (obj.userData.speciesKey) {
          const isMatch = this.deck.checkMatch(obj.userData.speciesKey);
          if (isMatch) this.catchFish(obj); // pass the Mesh
          return;
        }
        obj = obj.parent;
      }
    }
  }

  catchFish(target) {
    // NON-INSTANCED: Mesh
    if (target && target.isMesh) {
      const agentIndex = this.fish.findIndex(a => a.mesh === target);
      if (agentIndex !== -1) {
        const agent = this.fish[agentIndex];
        this.fish.splice(agentIndex, 1);
        this.fishGroup.remove(target);

        if (target.geometry) target.geometry.dispose();
        if (target.material) {
          if (Array.isArray(target.material)) target.material.forEach(m => m.dispose());
          else target.material.dispose();
        }
      }
      return;
    }

    // INSTANCED: Agent
    const agent = target;
    if (!agent || agent.instanceId === undefined) return;

    const key = agent.species.def.key;
    const bag = this.instanced.get(key);
    if (!bag) return;

    const lastActiveId = bag.activeCount - 1;
    const id = agent.instanceId;

    if (id !== lastActiveId) {
      // 1) swap matrices (visual)
      const mA = new THREE.Matrix4();
      const mB = new THREE.Matrix4();
      bag.inst.getMatrixAt(id, mA);
      bag.inst.getMatrixAt(lastActiveId, mB);
      bag.inst.setMatrixAt(id, mB);
      bag.inst.setMatrixAt(lastActiveId, mA);

      // 2) swap agents (logic)
      const other = bag.instances[lastActiveId];
      if (other) {
        bag.instances[id] = other;
        other.instanceId = id;
      }
      // put the caught agent at the tail (about to be trimmed)
      bag.instances[lastActiveId] = agent;
      agent.instanceId = lastActiveId;
    }

    // 3) shrink the active draw range
    bag.activeCount = Math.max(0, bag.activeCount - 1);
    bag.inst.count = bag.activeCount;
    bag.inst.instanceMatrix.needsUpdate = true;

    // 4) clear the now-inactive slot so raycasts won't find a stale agent
    bag.instances[lastActiveId] = undefined;

    // 5) drop from the global list (by reference, not by index)
    const idx = this.fish.indexOf(agent);
    if (idx !== -1) this.fish.splice(idx, 1);
  }



  onMouseMove(e) {
    const rect = this.app.canvas.getBoundingClientRect();
    this.mouseNDC.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    this.mouseNDC.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
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

  /* ----------------------------------- Update ----------------------------------- */

  update(dt) {
    const { deadzone, damping, speeds, responseCurve } = this.params;

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

    // Z clamp with camera margins (does NOT affect swimBox limits)
    {
      const zMin = this.params.leftLimit  + this.params.cameraLeftMargin;
      const zMax = this.params.rightLimit - this.params.cameraRightMargin;
      // protect against inverted margins
      const safeMin = Math.min(zMin, zMax - 0.001);
      const safeMax = Math.max(zMax, zMin + 0.001);
      p.z = clamp(p.z, safeMin, safeMax);
    }

    // Y limits: (floorLevel + cameraFloorMargin) ≤ Y ≤ (surfaceLevel + cameraSurfaceMargin)
    const yMin = this.params.floorLevel + this.params.cameraFloorMargin;
    const yMax = this.params.surfaceLevel + this.params.cameraSurfaceMargin;
    const newY = clamp(this.camera.position.y + deltaY.y, yMin, yMax);

    // Apply camera transform
    this.camera.position.set(p.x, newY, p.z);
    this.camera.lookAt(this.camera.position.clone().add(this.forward));

    // Update swimBox to follow the cameraLevel in X
    this.updateSwimBoxDynamic();

    // Update fish
    if (this.fish.length) this.updateFish(dt);

    // Update fog with explicit rules
    this.updateFog();
    
    // Update the deck UI
    if (this.deck) this.deck.update(dt);
  }

  updateFish(dt) {
    const pf = this.params.fish;
    const now = performance.now() * 0.001;

    this._sepAccum += dt;
    const doSeparationTick = (this._sepAccum >= (1 / this._sepHz));
    if (doSeparationTick) {
      this._sepAccum = 0;
      this._hash.s = Math.max(1e-3, pf.separationRadius); // cell ~= radius
      this._hash.rebuild(this.fish);
    }

    for (const a of this.fish) {
      // Retarget if reached, timed out, or target left the box (due to camera X change)
      const toTarget = a.target.clone().sub(a.pos);
      if (toTarget.length() < pf.targetReachDist || now >= a.nextRetargetAt || !this.swimBox.containsPoint(a.target)) {
        a.target = a.species.randBiasedPoint(this.swimBox);
        const ret = pf.retargetTime; a.nextRetargetAt = now + lerp(ret[0], ret[1], Math.random());
      }

      // Steering forces
      const fSeek = this.steerSeek(a, a.target, 1.0);
      if (!a._sepForce) a._sepForce = new THREE.Vector3();
      if (doSeparationTick) {
        const local = this._hash.neighbors(a.pos); // << only nearby fish, not all
        const fSepNow = this.steerSeparation(a, local, pf.separationRadius, pf.separationStrength);
        a._sepForce.copy(fSepNow);
      }
      const fSep = a._sepForce;
      const fBox  = this.steerContain(a).multiplyScalar(6.0); // push back inside

      // Sum and clamp by max accel
      const force = new THREE.Vector3().add(fSeek).add(fSep).add(fBox);
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

      // Apply to renderable (instanced or non-instanced)
      if (a.instanceId !== undefined) {
        // Instanced: write transform into the instance matrix
        const v = a.vel.clone();
        if (v.lengthSq() > 1e-10) v.normalize();
        const localFwd = a._detectLocalForward ? a._detectLocalForward() : new THREE.Vector3(1, 0, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(localFwd, v);
        const m = new THREE.Matrix4();
        const scl = a.mesh?.scale || new THREE.Vector3(1, 1, 1);
        m.compose(a.pos, q, scl);

        const bag = this.instanced.get(a.species.def.key);
        if (bag) bag.inst.setMatrixAt(a.instanceId, m);
      } else {
        // Non-instanced fallback (if any species fell back)
        a.applyOrientation();
        a.mesh.position.copy(a.pos);
      }
    }
    // Flush instance matrices once per species
    for (const bag of this.instanced.values()) {
      bag.inst.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Create (or reuse) an InstancedMesh for a species. Uses the first Mesh found
   * in the species' template as the source geometry/material.
   */
  _createInstancedForSpecies(speciesObj, count) {
    const key = speciesObj.def.key;
    if (this.instanced.has(key)) return this.instanced.get(key);

    let baseMesh = null;
    speciesObj.template.traverse(o => {
      if (o.isMesh && !baseMesh) baseMesh = o;
    });
    if (!baseMesh) {
      console.warn(`Species ${key}: no mesh in template; falling back to per-mesh.`);
      return null;
    }

    const inst = new THREE.InstancedMesh(
      baseMesh.geometry,
      baseMesh.material, // shared across instances
      count
    );
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.frustumCulled = true;
    inst.userData.speciesKey = key;

    const bag = {
      inst,
      activeCount: 0,
      agents: [],          // optional list if you want it
      instances: []        // instanceId -> agent  (authoritative mapping)
    };

    this.instancedGroup.add(inst);
    this.instanced.set(key, bag);
    return bag;
  }


  /* ------------------------------- Steering helpers ------------------------------ */

  steerSeek(agent, target, intensity = 1) {
    const desired = target.clone().sub(agent.pos);
    const d = desired.length();
    if (d < 1e-5) return new THREE.Vector3();
    desired.normalize().multiplyScalar(agent.speedMax);
    return desired.sub(agent.vel).multiplyScalar(intensity);
  }

  steerSeparation(agent, neighbors, radius, strength) {
    const force = new THREE.Vector3(); let count = 0;
    const r2 = radius * radius;
    for (const other of neighbors) {
      if (other === agent) continue;
      const diff = agent.pos.clone().sub(other.pos);
      const d2 = diff.lengthSq();
      if (d2 > 0 && d2 < r2) {
        diff.normalize().multiplyScalar(1.0 / d2);
        force.add(diff); count++;
      }
    }
    if (count > 0) force.multiplyScalar(strength);
    return force;
  }

  steerContain(agent) {
    // Simple inward push when at/near the box faces (zero margin => only when outside)
    const f = new THREE.Vector3();
    const p = agent.pos;
    const b = this.swimBox;

    let d = p.x - b.min.x; if (d < 0) f.x += -d;
    d = b.max.x - p.x;     if (d < 0) f.x -= -d;

    d = p.y - b.min.y;     if (d < 0) f.y += -d;
    d = b.max.y - p.y;     if (d < 0) f.y -= -d;

    d = p.z - b.min.z;     if (d < 0) f.z += -d;
    d = b.max.z - p.z;     if (d < 0) f.z -= -d;

    return f;
  }

  /* ---------------------------------- Resize ---------------------------------- */

  onResize(w, h) {
    super.onResize(w, h);
    this.camera.lookAt(this.camera.position.clone().add(this.forward));
    if (this.model) {
      this.scene.updateMatrixWorld(true);
      this.rebuildTiles();
      this.buildOrUpdateWaterSurface();
      // Keep swimBox aligned to explicit params and current cameraLevel
      this.updateSwimBoxDynamic();
    }
  }
}