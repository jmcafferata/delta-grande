import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import { AssetLoader } from '../core/AssetLoader.js';

export class RioScene extends BaseScene {
  constructor(app){
    super(app);
    this.name = 'rio';

    this.params = {
      // Escala y pose exactas (tus valores)
      overrideScale: 129.36780721031408,
      modelLongestTarget: 129.368, // ignorado si overrideScale está definido
      start: { x: 80.0, y: -6.542, z: 4.291, yawDeg: -90 },

      // Movimiento con mouse (único control)
      speeds: { x: 8.0, y: 10.0 },
      responseCurve: { x: 1.0, y: 1.35 },
      deadzone: 0.08,
      damping: 0.15,

      // Límites
      boundsXZ: { x: [-300, 300], z: [0, 500] },
      boundsY: { min: -11.05, max: 5.722 },

      // Tiling lateral (cadena de modelos)
      tiling: { countEachSide: 5, gap: -20.0 },

      // Agua/fog
      skyColor: 0x87ceeb,
      waterColor: 0x0a1a3a,
      waterSurfaceOffset: 0.25, // cuánto por debajo del Y máximo va la superficie
      fogDensityHint: 0.7      // multiplicador de la distancia de fog basada en escala del modelo
    };

    // Estado de input
    this.mouseNDC = new THREE.Vector2(0, 0);
    this.vel = new THREE.Vector2(0, 0); // vx (strafe), vy (elevación)

    // Cámara plana (sin pitch)
    this.forward = new THREE.Vector3(0, 0, -1);

    // Reutilizables
    this.tmpRight = new THREE.Vector3();
    this.tmpUp = new THREE.Vector3(0, 1, 0);
    this.tmpDelta = new THREE.Vector3();

    // Escena
    this.model = null;                   // modelo central
    this.tilesGroup = new THREE.Group(); // clones laterales
    this.scene.add(this.tilesGroup);

    // Agua: superficie (plano) y nivel
    this.waterSurface = null;
    this.waterLevelY = 0;

    // Internos
    this._lastTileStep = 0;
  }

  async mount(){
    // Fondo + luces
    this.scene.background = new THREE.Color(this.params.skyColor);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a4a5a, 1.0);
    const dir  = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(8, 12, 6);
    dir.castShadow = true;
    this.scene.add(hemi, dir);

    // Cargar modelo
    try{
      const gltf = await AssetLoader.gltf('/game-assets/sub/sub_floor.glb');
      this.model = gltf.scene || gltf.scenes?.[0];
      if (this.model){
        this.model.traverse(o=>{ if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(this.model);

        // Recentrar al piso y escalar
        this.recenterToFloor(this.model);
        if (typeof this.params.overrideScale === 'number' && isFinite(this.params.overrideScale)){
          this.model.scale.setScalar(this.params.overrideScale);
        } else {
          this.scaleModelToLongest(this.model, this.params.modelLongestTarget);
        }

        // Ajustar bounds X/Z base por tamaño
        const L = this.getModelLongestNow(this.model);
        if (isFinite(L) && L > 0){
          const k = 3.0;
          this.params.boundsXZ = { x: [-L*k, L*k], z: [-L*k, L*k] };
        }
      }
    }catch(err){
      console.error('Error cargando sub_floor.glb', err);
    }

    // Pose inicial cámara (tus números) y yaw
    const { x, y, z, yawDeg } = this.params.start;
    this.camera.position.set(x, y, z);
    this.setYaw(yawDeg);
    this.camera.lookAt(this.camera.position.clone().add(this.forward));

    // Tiling y agua
    if (this.model){
      this.scene.updateMatrixWorld(true);
      this.rebuildTiles();
      this.buildOrUpdateWaterSurface(); // crea plano y fija fog base
      this.updateFog();                 // enciende/apaga según nivel
    }

    // Mouse listeners (único input)
    this._onMouseMove  = (e)=> this.onMouseMove(e);
    this._onMouseLeave = ()=> this.mouseNDC.set(0,0);
    this.app.canvas.addEventListener('mousemove', this._onMouseMove);
    this.app.canvas.addEventListener('mouseleave', this._onMouseLeave);
  }

  async unmount(){
    this.app.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.app.canvas.removeEventListener('mouseleave', this._onMouseLeave);
  }

  /* ==================== RE-CENTRADO Y ESCALA ==================== */

  recenterToFloor(obj){
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);                 // centro al origen
    obj.position.y -= box.min.y - obj.position.y; // apoyar base en y=0
  }

  scaleModelToLongest(obj, target){
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (longest <= 0) return;
    obj.scale.multiplyScalar(target / longest);
  }

  getModelLongestNow(obj){
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return 0;
    const s = box.getSize(new THREE.Vector3());
    return Math.max(s.x, s.y, s.z);
  }

  /* ==================== TILING (cadena lateral) ==================== */

  widthAlongDirectionWorld(obj, dir){
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return 0;

    const min = box.min, max = box.max;
    const corners = [
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(max.x, min.y, min.z),
      new THREE.Vector3(min.x, max.y, min.z),
      new THREE.Vector3(max.x, max.y, min.z),
      new THREE.Vector3(min.x, min.y, max.z),
      new THREE.Vector3(max.x, min.y, max.z),
      new THREE.Vector3(min.x, max.y, max.z),
      new THREE.Vector3(max.x, max.y, max.z),
    ];
    let minProj = +Infinity, maxProj = -Infinity;
    for (const c of corners){
      const p = c.dot(dir);
      if (p < minProj) minProj = p;
      if (p > maxProj) maxProj = p;
    }
    return (maxProj - minProj);
  }

  rebuildTiles(){
    if (!this.model) return;

    // Limpiar anteriores
    for (let i = this.tilesGroup.children.length - 1; i >= 0; i--){
      this.tilesGroup.remove(this.tilesGroup.children[i]);
    }

    this.scene.updateMatrixWorld(true);

    // Ejes en mundo
    const right = this.tmpRight.copy(this.forward).cross(this.tmpUp).normalize();

    // Paso lateral
    const baseWidth = this.widthAlongDirectionWorld(this.model, right);
    const tileStep = baseWidth + this.params.tiling.gap;
    this._lastTileStep = tileStep;

    // Ancla central
    const anchor = this.model.getWorldPosition(new THREE.Vector3());

    // Clones a cada lado
    const n = this.params.tiling.countEachSide;
    for (let i = 1; i <= n; i++){
      const offsetR = right.clone().multiplyScalar(+i * tileStep);
      const offsetL = right.clone().multiplyScalar(-i * tileStep);

      const r = this.model.clone(true);
      r.position.copy(anchor).add(offsetR);
      this.tilesGroup.add(r);

      const l = this.model.clone(true);
      l.position.copy(anchor).add(offsetL);
      this.tilesGroup.add(l);
    }

    // Expandir bounds XZ para cubrir la cadena
    const totalRightSpan = Math.max(0.01, baseWidth + 2 * n * tileStep);
    const B = Math.max(
      Math.abs(this.params.boundsXZ.x[0]), Math.abs(this.params.boundsXZ.x[1]),
      Math.abs(this.params.boundsXZ.z[0]), Math.abs(this.params.boundsXZ.z[1])
    );
    const extra = Math.max(B, totalRightSpan * 0.7);
    this.params.boundsXZ = { x: [-extra, extra], z: [-extra, extra] };
  }

  /* ==================== AGUA: superficie + fog ==================== */

  buildOrUpdateWaterSurface(){
    // Nivel del agua: justo por debajo del límite superior permitido
    this.waterLevelY = this.params.boundsY.max - this.params.waterSurfaceOffset;

    // Dimensiones del plano (grande para cubrir el set)
    const right = this.tmpRight.copy(this.forward).cross(this.tmpUp).normalize();
    const baseWidthRight = this.widthAlongDirectionWorld(this.model, right);
    const n = this.params.tiling.countEachSide;
    const tileStep = baseWidthRight + this.params.tiling.gap;
    const totalRightSpan = Math.max(0.01, baseWidthRight + 2 * n * tileStep);

    // Profundidad (a lo largo del forward) → usamos ancho del modelo en fwd
    const fwd = this.forward.clone().normalize();
    const baseWidthForward = Math.max(0.01, this.widthAlongDirectionWorld(this.model, fwd));

    // Un margen
    const sx = totalRightSpan * 1.1;
    const sz = baseWidthForward * 2.0;

    if (!this.waterSurface){
      const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
      const mat = new THREE.MeshPhysicalMaterial({
        color: this.params.waterColor,
        transparent: true,
        opacity: 0.25,
        roughness: 0.9,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      this.waterSurface = new THREE.Mesh(geo, mat);
      this.waterSurface.rotation.x = -Math.PI/2; // horizontal (XZ)
      this.scene.add(this.waterSurface);
    }

    this.waterSurface.position.set(0, this.waterLevelY, 0);
    this.waterSurface.scale.set(sx, sz, 1);

    // Fog base (desactivado por defecto; se enciende al actualizar)
    const L = this.getModelLongestNow(this.model);
    const fogNear = 5;
    const fogFar  = Math.max(30, L * 1.0 * this.params.fogDensityHint);
    this._fogNear = fogNear; // guardar para reusar
    this._fogFar  = fogFar;
  }

  updateFog(){
    const isUnder = (this.camera.position.y < this.waterLevelY);
    if (isUnder){
      if (!this.scene.fog){
        this.scene.fog = new THREE.Fog(this.params.waterColor, this._fogNear, this._fogFar);
      } else {
        this.scene.fog.color.set(this.params.waterColor);
        this.scene.fog.near = this._fogNear;
        this.scene.fog.far  = this._fogFar;
      }
    } else {
      this.scene.fog = null;
    }
  }

  /* ==================== INPUT (mouse) ==================== */

  onMouseMove(e){
    const rect = this.app.canvas.getBoundingClientRect();
    this.mouseNDC.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    this.mouseNDC.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  }

  axis(a, deadzone, expo=1){
    if (Math.abs(a) <= deadzone) return 0;
    const t = (Math.abs(a) - deadzone) / (1 - deadzone);
    const s = Math.min(Math.max(t, 0), 1);
    const curved = Math.pow(s, expo);
    return Math.sign(a) * (curved*curved*(3 - 2*curved)); // smoothstep(curved)
  }

  clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

  /* ==================== CICLO ==================== */

  setYaw(deg){
    const yaw = THREE.MathUtils.degToRad(deg);
    this.forward.set(Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
  }

  update(dt){
    const { deadzone, damping, speeds, responseCurve } = this.params;

    // Ejes con zona muerta -> velocidades objetivo en espacio de cámara
    const ax = this.axis(this.mouseNDC.x, deadzone, responseCurve.x); // strafe L/R
    const ay = this.axis(this.mouseNDC.y, deadzone, responseCurve.y); // elevar Up/Down
    const targetVx = ax * speeds.x;
    const targetVy = ay * speeds.y;

    // Suavizado
    this.vel.x += (targetVx - this.vel.x) * damping;
    this.vel.y += (targetVy - this.vel.y) * damping;

    // Vectores locales de la cámara (der/arriba)
    this.tmpRight.copy(this.forward).cross(this.tmpUp).normalize();

    // Delta en mundo
    const deltaX = this.tmpDelta.copy(this.tmpRight).multiplyScalar(this.vel.x * dt);
    const deltaY = this.tmpUp.clone().multiplyScalar(this.vel.y * dt);

    // Aplicar: XZ con clamp, Y clamped a tus límites
    const p = this.camera.position.clone().add(deltaX);
    const { boundsXZ, boundsY } = this.params;
    p.x = this.clamp(p.x, boundsXZ.x[0], boundsXZ.x[1]);
    p.z = this.clamp(p.z, boundsXZ.z[0], boundsXZ.z[1]);
    const newY = this.camera.position.y + deltaY.y;
    this.camera.position.set(p.x, this.clamp(newY, boundsY.min, boundsY.max), p.z);

    // Mirar hacia delante (sin tilt)
    this.camera.lookAt(this.camera.position.clone().add(this.forward));

    // Fog según nivel
    this.updateFog();
  }

  onResize(w, h){
    super.onResize(w, h);
    this.camera.lookAt(this.camera.position.clone().add(this.forward));
    if (this.model) {
      this.scene.updateMatrixWorld(true);
      this.rebuildTiles();
      this.buildOrUpdateWaterSurface();
      this.updateFog();
    }
  }
}
