import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import { EventBus } from '../core/EventBus.js';
import { State } from '../core/State.js';

export class LabScene extends BaseScene{
  constructor(app){
    super(app); this.name = 'lab';
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.interactives = [];
  }

  async mount(){
    // Luces sencillas
    this.scene.background = null; // transparente
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(2,3,2);
    this.scene.add(amb, dir);

    // Un “piso”
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10,10), new THREE.MeshStandardMaterial({ color:0x10151c }));
    floor.rotation.x = -Math.PI/2; floor.position.y = -0.5; this.scene.add(floor);

    // Un “panel” interactivo que navega a Recorrido
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.8,1.0), new THREE.MeshStandardMaterial({ color:0x203040 }));
    panel.position.set(0, 0.5, -2.2); this.scene.add(panel); panel.userData = { goto:'#recorrido', label:'Recorrido' };
    this.interactives.push(panel);

    // Un “monitor” (placeholder) que abre un video overlay (imagina tus videos del Delta)
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(1.2,0.7,0.05), new THREE.MeshStandardMaterial({ color:0x354a6a }));
    monitor.position.set(-2, 0.9, -1.5); this.scene.add(monitor); monitor.userData = { video:'/game-assets/recorrido/transicion01.mp4', label:'Video Delta' };
    this.interactives.push(monitor);

    // Cámara
    this.camera.position.set(0, 1.4, 2.8);
    this.camera.lookAt(0,0.6,-2);

    // Input
    this._onClick = (ev)=> this.onClick(ev);
    this.app.canvas.addEventListener('click', this._onClick);
  }

  async unmount(){
    this.app.canvas.removeEventListener('click', this._onClick);
  }

  update(dt){
    // peq. animación
    this.scene.traverse(o=>{ if (o.userData && o.userData.label==='Recorrido'){ o.rotation.y += dt*0.2; }});
  }

  screenToNDC(ev){
    const rect = this.app.canvas.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) / rect.width;
    const cy = (ev.clientY - rect.top)  / rect.height;
    this.ndc.set(cx*2-1, -(cy*2-1));
  }

  onClick(ev){
    this.screenToNDC(ev);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.interactives, false);
    if (!hits.length) return;
    const data = hits[0].object.userData || {};
    if (data.goto){ location.hash = data.goto; }
    if (data.video){ import('../core/UI.js').then(({UI})=> UI.showVideo(data.video)); }
  }
}