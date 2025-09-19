import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import { AssetLoader } from '../core/AssetLoader.js';

export class RioScene extends BaseScene {
  constructor(app){
    super(app);
    this.name = 'rio';

    this.params = {
      // Pose & escala (tus valores “horneados”)
      overrideScale: 129.36780721031408,
      modelLongestTarget: 129.368, // ignorado si overrideScale está definido
      start: { x: 80.0, y: -6.542, z: 4.291, yawDeg: -90 },

      // Movimiento con mouse (único control)
      speeds: { x: 8.0, y: 10.0 },
      responseCurve: { x: 1.0, y: 1.35 },
      deadzone: 0.08,
      damping: 0.15,

      // Límites globales de cámara
      boundsXZ: { x: [-300, 300], z: [0, 500] },
      boundsY: { min: -11.05, max: 5.722 },

      // Tiling lateral (cadena de modelos)
      tiling: { countEachSide: 5, gap: -20.0 },

      // Agua / fog / superficie
      skyColor: 0x87ceeb,
      waterColor: 0x0a1a3a,
      waterSurfaceOffset: 0.25,
      fogDensityHint: 0.45,
      waterSurfaceOpacity: 0.8,

      // Peces (200)
      fish: {
        count: 200,
        modelPath: '/game-assets/sub/golden_fish.glb',
        fallbackDims: { x: 1.6, y: 0.4, z: 0.5 }, // prisma si no está el glb
        forwardAxis: 'x',     // eje largo del mesh
        flipForward: false,   // si la cabeza es al revés, poné true
        speedMin: 2.0,
        speedMax: 4.0,
        accel: 8.0,
        separationRadius: 2.0,
        separationStrength: 1.2,
        targetReachDist: 1.5,
        retargetTime: [4.0, 8.0],
      },

      // SwimBox: reglas
      swimMinXHard: 5.152, // ← hardcodeado como pediste
      swimMarginY: 0.4,    // clearance vs piso/superficie
      swimSpanZFactor: 1.2 // múltiplo del ancho forward del modelo
    };

    // Input continuo (mouse)
    this.mouseNDC = new THREE.Vector2(0, 0);
    this.vel = new THREE.Vector2(0, 0);
    this.forward = new THREE.Vector3(0, 0, -1);

    // Reutilizables
    this.tmpRight = new THREE.Vector3();
    this.tmpUp = new THREE.Vector3(0, 1, 0);
    this.tmpDelta = new THREE.Vector3();

    // Escena base
    this.model = null;
    this.tilesGroup = new THREE.Group();
    this.scene.add(this.tilesGroup);

    // Agua
    this.waterSurface = null;
    this.waterLevelY = 0;
    this._fogNear = 5;
    this._fogFar = 60;

    // Caja de nado (no visible, sin UI)
    this.swimBox = new THREE.Box3(); // min/max en mundo

    // Peces
    this.fish = [];
  }

  async mount(){
    // Fondo + luces
    this.scene.background = new THREE.Color(this.params.skyColor);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a4a5a, 1.0);
    const dir  = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(8, 12, 6);
    dir.castShadow = true;
    this.scene.add(hemi, dir);

    // Modelo del río
    try{
      const gltf = await AssetLoader.gltf('/game-assets/sub/sub_floor.glb');
      this.model = gltf.scene || gltf.scenes?.[0];
      if (this.model){
        this.model.traverse(o=>{ if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(this.model);
        this.recenterToFloor(this.model);
        if (Number.isFinite(this.params.overrideScale)){
          this.model.scale.setScalar(this.params.overrideScale);
        } else {
          this.scaleModelToLongest(this.model, this.params.modelLongestTarget);
        }
        // bounds base
        const L = this.getModelLongestNow(this.model);
        if (L > 0){
          const k = 3.0;
          this.params.boundsXZ = { x: [-L*k, L*k], z: [-L*k, L*k] };
        }
      }
    }catch(err){ console.error('Error cargando sub_floor.glb', err); }

    // Cámara + yaw
    const { x, y, z, yawDeg } = this.params.start;
    this.camera.position.set(x, y, z);
    this.setYaw(yawDeg);
    this.camera.lookAt(this.camera.position.clone().add(this.forward));

    // Tiling + agua + swimbox inicial
    if (this.model){
      this.scene.updateMatrixWorld(true);
      this.rebuildTiles();
      this.buildOrUpdateWaterSurface();
      this.updateFog();
      this.initSwimBoxFromScene();   // setea minY/maxY/minZ/maxZ y minX; maxX se ata a la cámara
      this.updateSwimBoxDynamic();   // asegura maxX = camera.x
    }

    // Peces
    await this.spawnFish();
    // Asegurar que todos queden dentro de la caja inicial
    for (const a of this.fish){
      this.projectInsideSwimBox(a.pos);
      if (!this.swimBox.containsPoint(a.target)){
        a.target = this.randPointInSwimBox();
      }
      a.mesh.position.copy(a.pos);
    }

    // Inputs
    this._onMouseMove  = (e)=> this.onMouseMove(e);
    this._onMouseLeave = ()=> this.mouseNDC.set(0,0);
    this.app.canvas.addEventListener('mousemove', this._onMouseMove);
    this.app.canvas.addEventListener('mouseleave', this._onMouseLeave);
  }

  async unmount(){
    this.app.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.app.canvas.removeEventListener('mouseleave', this._onMouseLeave);
  }

  /* ---------- helpers de modelo ---------- */

  recenterToFloor(obj){
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    obj.position.y -= box.min.y - obj.position.y;
  }

  scaleModelToLongest(obj, target){
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (longest > 0) obj.scale.multiplyScalar(target / longest);
  }

  getModelLongestNow(obj){
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return 0;
    const s = box.getSize(new THREE.Vector3());
    return Math.max(s.x, s.y, s.z);
  }

  /* ---------- tiling ---------- */

  widthAlongDirectionWorld(obj, dir){
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
    for (const c of corners){ const p = c.dot(dir); if (p<a) a=p; if (p>b) b=p; }
    return (b - a);
  }

  rebuildTiles(){
    if (!this.model) return;
    for (let i = this.tilesGroup.children.length - 1; i >= 0; i--){
      this.tilesGroup.remove(this.tilesGroup.children[i]);
    }
    this.scene.updateMatrixWorld(true);

    const right = this.tmpRight.copy(this.forward).cross(this.tmpUp).normalize();
    const baseWidth = this.widthAlongDirectionWorld(this.model, right);
    const tileStep = baseWidth + this.params.tiling.gap;
    this._lastTileStep = tileStep;

    const anchor = this.model.getWorldPosition(new THREE.Vector3());
    const n = this.params.tiling.countEachSide;
    for (let i = 1; i <= n; i++){
      const offsetR = right.clone().multiplyScalar(+i * tileStep);
      const offsetL = right.clone().multiplyScalar(-i * tileStep);
      const r = this.model.clone(true); r.position.copy(anchor).add(offsetR); this.tilesGroup.add(r);
      const l = this.model.clone(true); l.position.copy(anchor).add(offsetL); this.tilesGroup.add(l);
    }

    const totalRightSpan = Math.max(0.01, baseWidth + 2 * n * tileStep);
    const B = Math.max(
      Math.abs(this.params.boundsXZ.x[0]), Math.abs(this.params.boundsXZ.x[1]),
      Math.abs(this.params.boundsXZ.z[0]), Math.abs(this.params.boundsXZ.z[1])
    );
    const extra = Math.max(B, totalRightSpan * 0.7);
    this.params.boundsXZ = { x: [-extra, extra], z: [-extra, extra] };
  }

  /* ---------- agua ---------- */

  buildOrUpdateWaterSurface(){
    this.waterLevelY = this.params.boundsY.max - this.params.waterSurfaceOffset;

    const right = this.tmpRight.copy(this.forward).cross(this.tmpUp).normalize();
    const baseWidthRight = this.widthAlongDirectionWorld(this.model, right);
    const n = this.params.tiling.countEachSide;
    const tileStep = baseWidthRight + this.params.tiling.gap;
    const totalRightSpan = Math.max(0.01, baseWidthRight + 2 * n * tileStep);

    const fwd = this.forward.clone().normalize();
    const baseWidthForward = Math.max(0.01, this.widthAlongDirectionWorld(this.model, fwd));

    const sx = totalRightSpan * 1.1;
    const sz = baseWidthForward * 2.0;

    if (!this.waterSurface){
      const geo = new THREE.PlaneGeometry(1,1,1,1);
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
      this.waterSurface.rotation.x = -Math.PI/2;
      this.scene.add(this.waterSurface);
    }
    this.waterSurface.position.set(0, this.waterLevelY, 0);
    this.waterSurface.scale.set(sx, sz, 1);

    // Fog near/far aproximados
    const L = this.getModelLongestNow(this.model || new THREE.Object3D());
    this._fogNear = 5;
    this._fogFar  = Math.max(30, L * 1.0 * this.params.fogDensityHint);
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

  /* ---------- swimBox: inicial + update dinámico ---------- */

  initSwimBoxFromScene(){
    // minX fijo (hardcoded)
    const minX = this.params.swimMinXHard;

    // Y usando límites conocidos (con pequeño margen)
    const minY = this.params.boundsY.min + this.params.swimMarginY;
    const maxY = this.waterLevelY - this.params.swimMarginY;

    // Profundidad Z a partir del ancho "forward" del modelo
    const fwd = this.forward.clone().normalize();
    const spanZ = Math.max(10, this.widthAlongDirectionWorld(this.model, fwd) * this.params.swimSpanZFactor);
    const halfZ = spanZ * 0.5;
    const minZ = -halfZ;
    const maxZ = +halfZ;

    // maxX se setea dinámico (cámara.x), lo dejamos provisoriamente = start.x
    const maxX = this.camera.position.x;

    this.swimBox.min.set(minX, Math.min(minY, maxY), minZ);
    this.swimBox.max.set(maxX, Math.max(minY, maxY), maxZ);

    this.normalizeAndClampSwimBox();
  }

  updateSwimBoxDynamic(){
    // maxX sigue la cámara; minX permanece fijo
    const EPS = 0.001;
    this.swimBox.max.x = Math.max(this.params.swimMinXHard + EPS, this.camera.position.x);

    // Aseguramos que Y y Z sigan válidos (por si cambió la superficie)
    const minY = this.params.boundsY.min + this.params.swimMarginY;
    const maxY = this.waterLevelY - this.params.swimMarginY;
    this.swimBox.min.y = Math.max(minY, Math.min(maxY, this.swimBox.min.y));
    this.swimBox.max.y = Math.max(minY + EPS, Math.min(maxY, this.swimBox.max.y));

    // Clamps generales
    this.normalizeAndClampSwimBox();
  }

  normalizeAndClampSwimBox(){
    const b = this.swimBox;

    // Orden min <= max
    if (b.min.x > b.max.x) [b.min.x, b.max.x] = [b.max.x, b.min.x];
    if (b.min.y > b.max.y) [b.min.y, b.max.y] = [b.max.y, b.min.y];
    if (b.min.z > b.max.z) [b.min.z, b.max.z] = [b.max.z, b.min.z];

    // Clamps a límites globales
    b.min.x = Math.max(this.params.swimMinXHard, b.min.x);
    b.max.x = Math.max(b.min.x + 0.001, b.max.x); // evita degenerado
    b.min.z = Math.max(this.params.boundsXZ.z[0], b.min.z);
    b.max.z = Math.min(this.params.boundsXZ.z[1], b.max.z);
    b.min.y = Math.max(this.params.boundsY.min, b.min.y);
    b.max.y = Math.min(this.waterLevelY,      b.max.y);
  }

  /* ---------- peces ---------- */

  async spawnFish(){
    const p = this.params.fish;
    let fishTemplate = null;
    try {
      const gltf = await AssetLoader.gltf(p.modelPath);
      fishTemplate = (gltf.scene || gltf.scenes?.[0])?.clone(true);
    } catch(e){
      const g = new THREE.BoxGeometry(p.fallbackDims.x, p.fallbackDims.y, p.fallbackDims.z);
      const m = new THREE.MeshStandardMaterial({ color: 0xffd166, metalness: 0.1, roughness: 0.6 });
      fishTemplate = new THREE.Mesh(g, m);
    }

    const now = performance.now()*0.001;
    for (let i=0; i<p.count; i++){
      const mesh = fishTemplate.clone(true);
      this.scene.add(mesh);

      const pos = this.randPointInSwimBox();
      const vel = new THREE.Vector3().randomDirection().multiplyScalar(this.randRange(p.speedMin, p.speedMax));
      const target = this.randPointInSwimBox();
      const nextRetargetAt = now + this.randRange(p.retargetTime[0], p.retargetTime[1]);
      const agent = { mesh, pos, vel, target, nextRetargetAt, speedMax: this.randRange(p.speedMin, p.speedMax) };
      mesh.position.copy(pos);
      this.orientFishMesh(agent);
      this.fish.push(agent);
    }
  }

  randRange(a,b){ return a + Math.random()*(b-a); }

  randPointInSwimBox(){
    return new THREE.Vector3(
      this.randRange(this.swimBox.min.x, this.swimBox.max.x),
      this.randRange(this.swimBox.min.y, this.swimBox.max.y),
      this.randRange(this.swimBox.min.z, this.swimBox.max.z)
    );
  }

  steerSeek(agent, target, intensity=1){
    const desired = target.clone().sub(agent.pos);
    const d = desired.length();
    if (d < 1e-5) return new THREE.Vector3();
    desired.normalize().multiplyScalar(agent.speedMax);
    return desired.sub(agent.vel).multiplyScalar(intensity);
  }

  steerSeparation(agent, neighbors, radius, strength){
    const force = new THREE.Vector3(); let count = 0;
    for (const other of neighbors){
      if (other === agent) continue;
      const diff = agent.pos.clone().sub(other.pos);
      const d2 = diff.lengthSq();
      if (d2 > 0 && d2 < radius*radius){
        diff.normalize().multiplyScalar(1.0/d2);
        force.add(diff); count++;
      }
    }
    if (count>0) force.multiplyScalar(strength);
    return force;
  }

  // Empuje hacia adentro cuando el pez se acerca a las caras de la caja
  steerContain(agent){
    const f = new THREE.Vector3();
    const p = agent.pos;
    const margin = 0.8; // distancia a partir de la cual empuja

    let d = p.x - this.swimBox.min.x; if (d < margin) f.x += (margin - d);
    d = this.swimBox.max.x - p.x;     if (d < margin) f.x -= (margin - d);

    d = p.y - this.swimBox.min.y;     if (d < margin) f.y += (margin - d);
    d = this.swimBox.max.y - p.y;     if (d < margin) f.y -= (margin - d);

    d = p.z - this.swimBox.min.z;     if (d < margin) f.z += (margin - d);
    d = this.swimBox.max.z - p.z;     if (d < margin) f.z -= (margin - d);
    return f;
  }

  projectInsideSwimBox(p){
    p.x = Math.max(this.swimBox.min.x, Math.min(this.swimBox.max.x, p.x));
    p.y = Math.max(this.swimBox.min.y, Math.min(this.swimBox.max.y, p.y));
    p.z = Math.max(this.swimBox.min.z, Math.min(this.swimBox.max.z, p.z));
  }

  orientFishMesh(agent){
    const pf = this.params.fish;
    const v = agent.vel.clone();
    if (v.lengthSq() < 1e-8) return;
    v.normalize();

    const forward =
      pf.forwardAxis === 'x' ? new THREE.Vector3( 1,0,0) :
      pf.forwardAxis === 'z' ? new THREE.Vector3( 0,0,1) :
      new THREE.Vector3(1,0,0);
    if (pf.flipForward) forward.multiplyScalar(-1);

    const q = new THREE.Quaternion().setFromUnitVectors(forward, v);
    agent.mesh.quaternion.copy(q);
    agent.mesh.position.copy(agent.pos);
  }

  /* ---------- input mouse ---------- */

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
    return Math.sign(a) * (curved*curved*(3 - 2*curved));
  }
  clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

  /* ---------- ciclo ---------- */

  setYaw(deg){
    const yaw = THREE.MathUtils.degToRad(deg);
    this.forward.set(Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
  }

  update(dt){
    const { deadzone, damping, speeds, responseCurve } = this.params;

    // Cámara por mouse
    const ax = this.axis(this.mouseNDC.x, deadzone, responseCurve.x);
    const ay = this.axis(this.mouseNDC.y, deadzone, responseCurve.y);
    const targetVx = ax * speeds.x;
    const targetVy = ay * speeds.y;
    this.vel.x += (targetVx - this.vel.x) * damping;
    this.vel.y += (targetVy - this.vel.y) * damping;

    this.tmpRight.copy(this.forward).cross(this.tmpUp).normalize();
    const deltaX = this.tmpDelta.copy(this.tmpRight).multiplyScalar(this.vel.x * dt);
    const deltaY = this.tmpUp.clone().multiplyScalar(this.vel.y * dt);

    const p = this.camera.position.clone().add(deltaX);
    const { boundsXZ, boundsY } = this.params;
    p.x = this.clamp(p.x, boundsXZ.x[0], boundsXZ.x[1]);
    p.z = this.clamp(p.z, boundsXZ.z[0], boundsXZ.z[1]);
    const newY = this.camera.position.y + deltaY.y;
    this.camera.position.set(p.x, this.clamp(newY, boundsY.min, boundsY.max), p.z);
    this.camera.lookAt(this.camera.position.clone().add(this.forward));

    // SwimBox dinámica (maxX = cámara.x)
    this.updateSwimBoxDynamic();

    // Peces
    if (this.fish.length) this.updateFish(dt);

    // Fog
    this.updateFog();
  }

  updateFish(dt){
    const pf = this.params.fish;
    const now = performance.now()*0.001;

    for (const a of this.fish){
      // Retarget si llegó / timeout / target fuera de caja (por cambios en maxX)
      const toTarget = a.target.clone().sub(a.pos);
      if (toTarget.length() < pf.targetReachDist || now >= a.nextRetargetAt || !this.swimBox.containsPoint(a.target)){
        a.target = this.randPointInSwimBox();
        a.nextRetargetAt = now + this.randRange(pf.retargetTime[0], pf.retargetTime[1]);
      }

      // Steering
      const fSeek = this.steerSeek(a, a.target, 1.0);
      const fSep  = this.steerSeparation(a, this.fish, pf.separationRadius, pf.separationStrength);
      const fBox  = this.steerContain(a).multiplyScalar(6.0); // empuje hacia adentro

      // Sumar y limitar por aceleración
      const force = new THREE.Vector3().add(fSeek).add(fSep).add(fBox);
      if (force.length() > pf.accel) force.setLength(pf.accel);

      // Integrar velocidad + clamp speed
      a.vel.addScaledVector(force, dt);
      const spd = a.vel.length();
      const max = a.speedMax, min = Math.min(pf.speedMin, max*0.9);
      if (spd > max) a.vel.setLength(max);
      else if (spd < min) a.vel.setLength(min);

      // Integrar posición + proyectar dentro de caja (por si cambió maxX)
      a.pos.addScaledVector(a.vel, dt);
      this.projectInsideSwimBox(a.pos);

      // Aplicar a mesh + orientar
      this.orientFishMesh(a);
    }
  }

  onResize(w, h){
    super.onResize(w, h);
    this.camera.lookAt(this.camera.position.clone().add(this.forward));
    if (this.model) {
      this.scene.updateMatrixWorld(true);
      this.rebuildTiles();
      this.buildOrUpdateWaterSurface();
      this.updateFog();
      // swimBox: mantener reglas (minX hard, maxX = cam.x)
      this.updateSwimBoxDynamic();
    }
  }
}
