import * as THREE from 'three';


export const AssetLoader = {
texture(url){
return new Promise((resolve, reject) => {
const loader = new THREE.TextureLoader();
loader.load(url, (tex)=>{ tex.colorSpace = THREE.SRGBColorSpace; resolve(tex); }, undefined, reject);
});
},
audio(url){
// Devuelve un HTMLAudioElement listo para usar
const a = new Audio(url);
a.preload = 'auto';
return a;
},
async gltf(url){
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const loader = new GLTFLoader();
return new Promise((resolve, reject)=> loader.load(url, resolve, undefined, reject));
}
};