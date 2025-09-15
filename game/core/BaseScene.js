import * as THREE from 'three';


export class BaseScene{
constructor(app){
this.app = app;
this.scene = new THREE.Scene();
this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
this.clock = new THREE.Clock();
}
async mount(){ /* override */ }
async unmount(){ /* override */ }
update(dt){ /* override */ }
onResize(w,h){ this.camera.aspect = w/h; this.camera.updateProjectionMatrix(); }
}