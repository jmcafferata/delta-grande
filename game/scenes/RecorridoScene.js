import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import { AssetLoader } from '../core/AssetLoader.js';
import { State } from '../core/State.js';

export class RecorridoScene extends BaseScene{
  constructor(app){
    super(app); this.name = 'recorrido';
    this.current = 0; this.stages = [];
    this.mouseNDC = new THREE.Vector2(0,0);
    this.raycaster = new THREE.Raycaster();
    this.velLon = 0; this.velLat = 0; this.isAutoLook = false;
    this.lon = 0; this.lat = 0; // grados

    this.config = {
      deadzone: 0.12,
      maxSpeed: { yaw: 80, pitch: 50 },
      damping: 0.12
    };
  }

  async mount(){
    // Fondo transparente; esfera 360
    this.sphere = new THREE.Mesh(
      new THREE.SphereGeometry(500,64,48).scale(-1,1,1),
      new THREE.MeshBasicMaterial()
    );
    this.scene.add(this.sphere);

    // Anchor + marker
    this.anchor = new THREE.Object3D();
    this.scene.add(this.anchor);
    const uniforms = this.uniforms = { uTexture:{value:null}, uTime:{value:0}, uGlitch:{value:1} };
    this.marker = new THREE.Mesh(
      new THREE.PlaneGeometry(300,300),
      new THREE.ShaderMaterial({
        uniforms, transparent:true, side:THREE.DoubleSide,
        vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader:`
          uniform sampler2D uTexture; uniform float uTime; uniform float uGlitch; varying vec2 vUv;
          float rand(vec2 co){ return fract(sin(dot(co.xy,vec2(12.9898,78.233)))*43758.5453); }
          void main(){
            vec2 uv=vUv; vec4 tex=texture2D(uTexture,uv);
            float line=floor(uv.y*200.0); float offset=rand(vec2(line,floor(uTime*30.0)))-0.5;
            vec2 guv=uv; guv.x+=offset*0.3; vec4 t2=texture2D(uTexture,guv);
            float gray=dot(t2.rgb,vec3(0.3,0.59,0.11)); vec3 green=vec3(0.0,gray,0.0);
            float scan=sin(uv.y*800.0+uTime*20.0)*0.1; green+=vec3(0.0,scan,0.0);
            vec4 glitchColor=vec4(green,t2.a); gl_FragColor=mix(tex,glitchColor,uGlitch);
          }`
      })
    );
    this.anchor.add(this.marker);

    // Cámara
    this.camera.fov = 75; this.camera.updateProjectionMatrix();
    this.camera.position.set(0,0,0.1);

    // Input
    this._onMouseMove = (e)=> this.onMouseMove(e);
    this._onLeave = ()=> this.mouseNDC.set(0,0);
    this._onClick = (e)=> this.onClick(e);
    this.app.canvas.addEventListener('mousemove', this._onMouseMove);
    this.app.canvas.addEventListener('mouseleave', this._onLeave);
    this.app.canvas.addEventListener('click', this._onClick);

    // Cargar config JSON
    const conf = await fetch('./data/recorrido.json', { cache:'no-store' }).then(r=>r.json());
    this.stages = conf.stages || [];
    await this.loadStage(0);
  }

  async unmount(){
    this.app.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.app.canvas.removeEventListener('mouseleave', this._onLeave);
    this.app.canvas.removeEventListener('click', this._onClick);
    if (this.audio){ this.audio.pause(); this.audio=null; }
  }

  async loadStage(i){
    this.current = i;
    const st = this.stages[i]; if (!st) return;

    // Panorama
    const tex = await AssetLoader.texture(st.photo);
    this.sphere.material.map = tex; this.sphere.material.needsUpdate = true;

    // Marker
    this.marker.scale.set(1,1,1);
    this.marker.geometry.dispose(); this.marker.geometry = new THREE.PlaneGeometry(...st.marker.scale);
    this.uniforms.uTexture.value = await AssetLoader.texture(st.marker.src);

    const theta = THREE.MathUtils.degToRad(90 - st.marker.pitch);
    const phi   = THREE.MathUtils.degToRad(st.marker.yaw);
    const r = 400;
    this.anchor.position.set(
      r * Math.sin(theta) * Math.cos(phi),
      r * Math.cos(theta),
      r * Math.sin(theta) * Math.sin(phi)
    );
    this.faceInwardNoRoll(this.anchor);

    // Glitch activo al comienzo
    this.uniforms.uGlitch.value = 1.0;

    // Orientación inicial
    if (st.forward){ this.lon = st.forward.yaw; this.lat = st.forward.pitch; }

    // Audio
    if (this.audio){ this.audio.pause(); this.audio=null; }
    if (st.audio){ this.audio = AssetLoader.audio(st.audio); this.audio.loop=true; this.audio.volume=0.5; this.audio.play().catch(()=>{}); }
  }

  faceInwardNoRoll(obj){ obj.up.set(0,1,0); obj.lookAt(0,0,0); obj.rotateY(Math.PI); }

  onMouseMove(e){
    const rect = this.app.canvas.getBoundingClientRect();
    this.mouseNDC.x = ((e.clientX - rect.left)/rect.width)*2 - 1;
    this.mouseNDC.y = -(((e.clientY - rect.top)/rect.height)*2 - 1);
  }

  onClick(e){
    const ndc = new THREE.Vector2();
    const rect = this.app.canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left)/rect.width)*2 - 1;
    ndc.y = -(((e.clientY - rect.top)/rect.height)*2 - 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.marker, true);
    if (!hits.length) return;
    this.glitchOffThenLook(() => this.playTransition(() => this.nextStage()));
  }

  glitchOffThenLook(onDone){
    const start = performance.now(); const duration = 1500; const s0 = this.uniforms.uGlitch.value;
    const anim1 = () => {
      const t = Math.min((performance.now()-start)/duration, 1);
      this.uniforms.uGlitch.value = THREE.MathUtils.lerp(s0, 0, t);
      if (t<1) requestAnimationFrame(anim1); else this.smoothLookForward(onDone);
    }; anim1();
  }

  smoothLookForward(onDone){
    const st = this.stages[this.current]; const target = st.forward || { yaw:0, pitch:0 };
    const startLon = this.lon, startLat = this.lat; const start = performance.now(); const duration = 2000; this.isAutoLook = true;
    const anim = () => {
      const t = Math.min((performance.now()-start)/duration, 1);
      this.lon = THREE.MathUtils.lerp(startLon, target.yaw, t);
      this.lat = THREE.MathUtils.lerp(startLat, target.pitch, t);
      if (t<1) requestAnimationFrame(anim); else { this.isAutoLook = false; onDone?.(); }
    }; anim();
  }

  playTransition(onEnded){
    const st = this.stages[this.current];
    if (!st || !st.transition){ onEnded?.(); return; }

    // Usamos la UI para overlay full-screen y sin controles
    import('../core/UI.js').then(({ UI })=>{
      UI.showVideo({
        src: st.transition,
        controls: false,   // sin botones
        muted: false,      // poné true si querés forzar sin sonido
        immersive: true,   // intenta fullscreen nativo cuando pueda
        onended: () => { onEnded?.(); }
      });
    });

    // Recompensa (inventario) al iniciar la transición
    if (st.reward){ State.addItem(st.reward); }
  }

  nextStage(){
    const next = (this.current + 1) % this.stages.length;
    this.loadStage(next);
  }

  update(dt){
    this.uniforms.uTime.value = performance.now()*0.001;

    if (!this.isAutoLook){
      const { deadzone, maxSpeed, damping } = this.config;
      const ax = this.axis(this.mouseNDC.x, deadzone);
      const ay = this.axis(this.mouseNDC.y, deadzone);
      const vx = ax * maxSpeed.yaw, vy = ay * maxSpeed.pitch;
      this.velLon += (vx - this.velLon) * damping;
      this.velLat += (vy - this.velLat) * damping;
      this.lon += this.velLon * dt;
      this.lat += this.velLat * dt;
      this.lat = Math.max(-85, Math.min(85, this.lat));
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
  }

  axis(a, deadzone){
    if (Math.abs(a) <= deadzone) return 0;
    const t = (Math.abs(a) - deadzone) / (1 - deadzone);
    const s = Math.min(Math.max(t,0),1); const smooth = s*s*(3-2*s);
    return Math.sign(a) * smooth;
  }
}