import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';

export class RioScene extends BaseScene{
  constructor(app){ super(app); this.name = 'rio'; }
  async mount(){
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const txt = this.banner('RÍO — WIP'); this.scene.add(txt);
    this.camera.position.set(0,1.2,3);
  }
  banner(text){
    const canvas = document.createElement('canvas'); const s=512; canvas.width=canvas.height=s;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#0d0f12'; ctx.fillRect(0,0,s,s);
    ctx.fillStyle='#35c9a5'; ctx.font='bold 40px Inter,Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(text, s/2, s/2);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(3,3), new THREE.MeshBasicMaterial({ map: tex, transparent:true }));
  }
}