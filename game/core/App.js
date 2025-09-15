import * as THREE from 'three';
import { EventBus } from './EventBus.js';

export class App {
constructor(rootSelector){
this.root = document.querySelector(rootSelector);
if (!this.root) throw new Error('App root not found');


// Renderer único para todas las escenas
this.renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
this.renderer.setSize(this.root.clientWidth, this.root.clientHeight);
this.root.appendChild(this.renderer.domElement);


// Loop
this._running = false;
this._last = performance.now();
this._currentScene = null;


// Resize
addEventListener('resize', () => this._resize());
new ResizeObserver(() => this._resize()).observe(this.root);
}

get canvas(){ return this.renderer.domElement; }


start(){
if (this._running) return;
this._running = true;
const loop = () => {
if (!this._running) return;
const now = performance.now();
const dt = Math.min((now - this._last) / 1000, 0.05);
this._last = now;


if (this._currentScene){
this._currentScene.update?.(dt);
// Cada escena debe tener scene+camera
if (this._currentScene.scene && this._currentScene.camera){
this.renderer.render(this._currentScene.scene, this._currentScene.camera);
} else if (this._currentScene.render){
this._currentScene.render(this.renderer, dt);
}
}
requestAnimationFrame(loop);
};
loop();

}


stop(){ this._running = false; }


async setScene(scene){
if (this._currentScene){
await this._currentScene.unmount?.();
this._currentScene = null;
}
this._currentScene = scene;
await this._currentScene.mount?.();
this._resize();
EventBus.emit('scene:changed', { name: scene?.name || scene?.constructor?.name });
}


_resize(){
const w = this.root.clientWidth, h = this.root.clientHeight;
this.renderer.setSize(w, h, false);
if (this._currentScene && this._currentScene.onResize){
this._currentScene.onResize(w, h);
}
}
}