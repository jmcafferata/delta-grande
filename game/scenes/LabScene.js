import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import { EventBus } from '../core/EventBus.js';
import { State } from '../core/State.js';
import { AssetLoader } from '../core/AssetLoader.js';
import { CursorRadarModule } from './CursorRadarModule.js';

export class LabScene extends BaseScene{
  constructor(app){
    super(app); this.name = 'lab';
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.interactives = [];
  this.backgroundMusic = null;
    this.cursorRadar = null;
    this.labModel = null;
    this.gltfCameraNode = null;
    
    // 👇 Camera control system from RecorridoScene
    this.mouseNDC = new THREE.Vector2();
    this.lon = 0;
    this.lat = 0;
    this.velLon = 0;
    this.velLat = 0;
    this.isAutoLook = false;
    this.config = {
      deadzone: 0.05,
      maxSpeed: { yaw: 60, pitch: 40 },
      damping: 0.15
    };
    
    this.isFallbackLab = false;
    this.fallbackGroup = null;
    this.fallbackNodes = [];
    this.carpaEmpty = null;
    this._carpaBasePosition = null;
    this._carpaBaseRotation = null;
    this._carpaNoiseTime = 0;
    this._carpaNoiseSeed = Math.random() * 100;
    this.luzCarpa = null;
    this.interactionProxies = [];
    
    // Video texture for tv_centro_recorrido
    this.tvVideoElement = null;
    this.tvVideoTexture = null;
    this.tvVideoMesh = null;
    this._tvRetryPlay = null;
    
    // Video texture for tv_der_subacuatico
    this.tvSubacuaVideoElement = null;
    this.tvSubacuaVideoTexture = null;
    this.tvSubacuaVideoMesh = null;
    this._tvSubacuaRetryPlay = null;
  }

  cleanBackgroundMusic() {
    if (this.backgroundMusic) {
      this.backgroundMusic.pause();
      this.backgroundMusic.currentTime = 0;
      this.backgroundMusic.src = '';
      this.backgroundMusic = null;
    }
  }

  async mount(){
    // 👇 Ocultar overlays de recorrido (solo para RecorridoScene)
    this.app.canvas.removeEventListener('pointerdown', this._onPointerDown);
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);

    if (document.pointerLockElement === this.app.canvas) {
      document.exitPointerLock?.();
    }

    if (this.labModel) {
      this.scene.remove(this.labModel);
      this.labModel = null;
    }

    if (this.fallbackGroup) {
      this.scene.remove(this.fallbackGroup);
      this.fallbackGroup = null;
    }

    if (this.fallbackNodes.length) {
      this.fallbackNodes.forEach((node) => this.scene.remove(node));
      this.fallbackNodes.length = 0;
    }

    this.clearInteractionProxies();

  this.interactives.length = 0;
    this.isFallbackLab = false;
    this.app.canvas.removeEventListener('pointerdown', this._onPointerDown);
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);

    if (document.pointerLockElement === this.app.canvas) {
      document.exitPointerLock?.();
    }

    if (this.labModel) {
      this.scene.remove(this.labModel);
      this.labModel = null;
    }

    this.interactives.length = 0;
    this.isFallbackLab = false;
    const mapOverlay = document.querySelector('.map-overlay');
    const metadataOverlay = document.querySelector('.metadata-overlay');
    const zocaloVideo = document.getElementById('zocaloVideo');
    const inventoryCanvas = document.getElementById('inventoryCanvas');
    if (mapOverlay) mapOverlay.style.display = 'none';
    if (metadataOverlay) metadataOverlay.style.display = 'none';
    if (inventoryCanvas) inventoryCanvas.style.display = 'none';
    if (zocaloVideo) {
      zocaloVideo.style.opacity = '0';
      zocaloVideo.style.display = 'none';
      zocaloVideo.pause();
      zocaloVideo.src = '';
    }

    // Cargar el laboratorio desde GLB
    try {
      await this.loadLabEnvironment();
    } catch (err) {
      console.error('[LabScene] Falló la carga de carpa.glb, usando fallback simple', err);
      this.buildFallbackLab();
    }

    this.startBackgroundMusic();

    // 👇 Initialize cursor first
    this.cursorRadar = new CursorRadarModule({
      cursor: {
        src: '/game-assets/recorrido/interfaz/cursor.png',
        scale: 0.15,
        enabled: true
      },
      radar: {
        enabled: false // Disable radar for lab scene
      }
    });
    await this.cursorRadar.init();

    // Input
    this._onClick = (ev)=> this.onClick(ev);
    this.app.canvas.addEventListener('click', this._onClick);

    // 👇 Mouse movement for camera control (like RecorridoScene)
    this._onMouseMove = this.onMouseMove.bind(this);
    this.app.canvas.addEventListener('mousemove', this._onMouseMove);

    // Teclado para ajustar luz
    this._onKeyDown = this.onKeyDown.bind(this);
    document.addEventListener('keydown', this._onKeyDown);
  }

  startBackgroundMusic() {
    this.cleanBackgroundMusic();
    const audio = AssetLoader.audio('/game-assets/laboratorio/Laboratorio V1.mp3');
    audio.loop = true;
    audio.volume = 0.4;
    audio.play().catch(() => {});
    this.backgroundMusic = audio;
  }

  applyMaterialFixes(root) {
    const tweakMaterial = (material) => {
      if (!material) return;
      if (material.side !== undefined) {
        material.side = THREE.DoubleSide;
      }

      if (material.map && material.map.format !== THREE.RGBAFormat && material.map.format !== THREE.RedFormat) {
        // Fuerza la textura a RGBA para reutilizar el canal alfa exportado
        material.map.format = THREE.RGBAFormat;
        material.map.needsUpdate = true;
      }

      const hasEmbeddedAlpha = !!material.map && material.map.format === THREE.RGBAFormat;
      if (hasEmbeddedAlpha) {
        material.transparent = true;
        if (material.alphaTest === undefined || material.alphaTest === 0) {
          material.alphaTest = 0.02;
        }
        if (material.depthWrite === false) {
          material.depthWrite = true;
        }
      } else if (material.opacity < 1) {
        material.transparent = true;
      }

      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.needsUpdate = true;
      }

      material.needsUpdate = true;
    };

    root.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(tweakMaterial);
    });
  }

  async loadLabEnvironment() {
    const gltf = await AssetLoader.gltf('/game-assets/laboratorio/carpa.glb');
    this.labModel = gltf.scene;
    this.scene.add(this.labModel);
    this.scene.background = null;
    this.isFallbackLab = false;

    if (this.fallbackGroup) {
      this.scene.remove(this.fallbackGroup);
      this.fallbackGroup = null;
    }

    if (this.fallbackNodes.length) {
      this.fallbackNodes.forEach((node) => this.scene.remove(node));
      this.fallbackNodes.length = 0;
    }

    this.applyMaterialFixes(this.labModel);

    this.setupCarpaEmpty();
    this.setupLuzCarpa();

    // Detectar cámara principal dentro del GLB
    let cameraNode = null;
    console.log('[LabScene] 🎥 Buscando cámaras en carpa.glb...');
    console.log('[LabScene] gltf.cameras:', gltf.cameras);
    
    // Buscar por nombre conocido primero
    const cameraNames = ['Camera.001', 'Camera', 'camera', 'Camera001'];
    for (const name of cameraNames) {
      const cam = this.labModel.getObjectByName(name);
      if (cam) {
        console.log('[LabScene] 🎯 Cámara encontrada por nombre "' + name + '":', cam);
        console.log('[LabScene]    - isCamera:', cam.isCamera);
        console.log('[LabScene]    - type:', cam.type);
        console.log('[LabScene]    - position:', cam.position?.toArray());
        if (cam.isCamera || cam.type === 'PerspectiveCamera' || cam.type === 'OrthographicCamera') {
          cameraNode = cam;
          break;
        }
      }
    }
    
    // Si no se encontró por nombre, buscar por traverse
    if (!cameraNode) {
      this.labModel.traverse((child) => {
        if (child.isCamera) {
          console.log('[LabScene] ✅ Cámara encontrada por traverse:', child.name, child.type);
          if (!cameraNode) cameraNode = child;
        }
      });
    }
    
    // Fallback a gltf.cameras array
    if (!cameraNode && gltf.cameras?.length) {
      console.log('[LabScene] ✅ Cámara encontrada en gltf.cameras[0]:', gltf.cameras[0].name);
      cameraNode = gltf.cameras[0];
    }

    if (cameraNode) {
      console.log('[LabScene] ✅ Configurando cámara desde GLB:', cameraNode.name);
      this.configureCameraFromGLTF(cameraNode);
    } else {
      console.warn('[LabScene] ⚠️ carpa.glb no contiene cámaras, usando cámara por defecto');
      this.camera.position.set(0, 1.4, 2.8);
      this.camera.lookAt(0, 0.6, -2);
      this.initializeCameraOrientation();
    }

    this.interactives.length = 0;

    const foundRecorrido = this.bindInteractiveNode([
      'tv_centro_recorrido',
      'panel_recorrido',
      'PanelRecorrido',
      'Recorrido',
      'recorrido_panel'
    ], { goto: '#instrucciones-transition', label: 'Recorrido' });

    const foundSubacuatico = this.bindInteractiveNode([
      'tv_der_subacuatico'
    ], { goto: '#subacuatico-transition', label: 'Subacuático' });

    if (!foundRecorrido) {
      console.warn('[LabScene] Nodo interactivo de recorrido no encontrado en carpa.glb. Activando fallback.');
      this.createFallbackInteractives();
    }
    
    // Setup video texture for TVs
    this.setupTVVideo();
    this.setupTVSubacuaVideo();
  }

  setupTVVideo() {
    if (!this.labModel) return;

    const tvMesh = this.labModel.getObjectByName('tv_centro_recorrido');
    if (!tvMesh) {
      console.warn('[LabScene] tv_centro_recorrido mesh not found');
      return;
    }

    console.log('[LabScene] 📺 Setting up video texture for tv_centro_recorrido');
    this.tvVideoMesh = tvMesh;

    // Clean previous handlers/resources
    if (this._tvRetryPlay) {
      document.removeEventListener('click', this._tvRetryPlay);
      this._tvRetryPlay = null;
    }

    if (this.tvVideoElement) {
      this.tvVideoElement.pause();
      this.tvVideoElement.src = '';
    }

    if (this.tvVideoTexture) {
      this.tvVideoTexture.dispose();
      this.tvVideoTexture = null;
    }

    const video = document.createElement('video');
    video.src = '/game-assets/laboratorio/screen-recorrido.webm';
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('webkit-playsinline', 'true');
    video.autoplay = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    this.tvVideoElement = video;

    const ensurePlay = () => {
      const playPromise = video.play();
      if (!playPromise) return;
      playPromise
        .then(() => {
          console.log('[LabScene] ✅ TV video playing successfully');
        })
        .catch((err) => {
          console.warn('[LabScene] ⚠️ Failed to autoplay TV video, will retry on user interaction:', err.message);
          this._tvRetryPlay = () => {
            video.play().then(() => {
              console.log('[LabScene] ✅ TV video playing after user interaction');
              if (this._tvRetryPlay) {
                document.removeEventListener('click', this._tvRetryPlay);
                this._tvRetryPlay = null;
              }
            }).catch((e) => console.warn('[LabScene] Still failed to play TV video:', e));
          };
          document.addEventListener('click', this._tvRetryPlay, { once: true });
        });
    };

    const buildTexture = () => {
      if (!this.tvVideoElement) return;

      if (this.tvVideoTexture) {
        this.tvVideoTexture.dispose();
      }

      const texture = new THREE.VideoTexture(this.tvVideoElement);
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.format = THREE.RGBAFormat;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.repeat.set(1, -1);
      texture.offset.set(0, 1);
      this.tvVideoTexture = texture;

      this.applyTVVideoTexture(tvMesh);
    };

    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      console.log('[LabScene] 📼 TV video already has data, creating texture immediately');
      buildTexture();
    } else {
      const onLoadedData = () => {
        video.removeEventListener('loadeddata', onLoadedData);
        console.log('[LabScene] 📼 TV video loaded data, creating texture');
        buildTexture();
      };
      video.addEventListener('loadeddata', onLoadedData, { once: true });
    }

    ensurePlay();
  }

  applyTVVideoTexture(tvMesh) {
    if (!this.tvVideoTexture) {
      console.warn('[LabScene] Cannot apply TV video texture - texture not ready');
      return;
    }

    let appliedCount = 0;

    const assignTexture = (material, label = 'material') => {
      if (!material) return;
      const materials = Array.isArray(material) ? material : [material];
      materials.forEach((mat, idx) => {
        const tag = Array.isArray(material) ? `${label}[${idx}]` : label;
        console.log(`[LabScene] Applying TV video texture to ${tag}:`, mat.name || 'unnamed');
        mat.map = this.tvVideoTexture;
        mat.emissiveMap = this.tvVideoTexture;
        mat.emissive?.set?.(0xffffff);
        mat.needsUpdate = true;
        appliedCount++;
      });
    };

    if (tvMesh.isMesh) {
      assignTexture(tvMesh.material, 'tv_centro_recorrido.material');
    } else {
      console.log('[LabScene] tv_centro_recorrido is a group, traversing children');
      tvMesh.traverse((child) => {
        if (child.isMesh) {
          assignTexture(child.material, `${child.name || 'mesh'}.material`);
        }
      });
    }

    console.log(`[LabScene] ✅ Video texture applied to ${appliedCount} material(s)`);
  }

  setupTVSubacuaVideo() {
    if (!this.labModel) return;

    const tvMesh = this.labModel.getObjectByName('tv_der_subacuatico');
    if (!tvMesh) {
      console.warn('[LabScene] tv_der_subacuatico mesh not found');
      return;
    }

    console.log('[LabScene] 📺 Setting up video texture for tv_der_subacuatico');
    this.tvSubacuaVideoMesh = tvMesh;

    // Clean previous handlers/resources
    if (this._tvSubacuaRetryPlay) {
      document.removeEventListener('click', this._tvSubacuaRetryPlay);
      this._tvSubacuaRetryPlay = null;
    }

    if (this.tvSubacuaVideoElement) {
      this.tvSubacuaVideoElement.pause();
      this.tvSubacuaVideoElement.src = '';
    }

    if (this.tvSubacuaVideoTexture) {
      this.tvSubacuaVideoTexture.dispose();
      this.tvSubacuaVideoTexture = null;
    }

    const video = document.createElement('video');
    video.src = '/game-assets/laboratorio/screen-subacua.webm';
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('webkit-playsinline', 'true');
    video.autoplay = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    this.tvSubacuaVideoElement = video;

    const ensurePlay = () => {
      const playPromise = video.play();
      if (!playPromise) return;
      playPromise
        .then(() => {
          console.log('[LabScene] ✅ TV subacua video playing successfully');
        })
        .catch((err) => {
          console.warn('[LabScene] ⚠️ Failed to autoplay TV subacua video, will retry on user interaction:', err.message);
          this._tvSubacuaRetryPlay = () => {
            video.play().then(() => {
              console.log('[LabScene] ✅ TV subacua video playing after user interaction');
              if (this._tvSubacuaRetryPlay) {
                document.removeEventListener('click', this._tvSubacuaRetryPlay);
                this._tvSubacuaRetryPlay = null;
              }
            }).catch((e) => console.warn('[LabScene] Still failed to play TV subacua video:', e));
          };
          document.addEventListener('click', this._tvSubacuaRetryPlay, { once: true });
        });
    };

    const buildTexture = () => {
      if (!this.tvSubacuaVideoElement) return;

      if (this.tvSubacuaVideoTexture) {
        this.tvSubacuaVideoTexture.dispose();
      }

      const texture = new THREE.VideoTexture(this.tvSubacuaVideoElement);
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.format = THREE.RGBAFormat;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.repeat.set(1, -1);
      texture.offset.set(0, 1);
      this.tvSubacuaVideoTexture = texture;

      this.applyTVSubacuaVideoTexture(tvMesh);
    };

    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      console.log('[LabScene] 📼 TV subacua video already has data, creating texture immediately');
      buildTexture();
    } else {
      const onLoadedData = () => {
        video.removeEventListener('loadeddata', onLoadedData);
        console.log('[LabScene] 📼 TV subacua video loaded data, creating texture');
        buildTexture();
      };
      video.addEventListener('loadeddata', onLoadedData, { once: true });
    }

    ensurePlay();
  }

  applyTVSubacuaVideoTexture(tvMesh) {
    if (!this.tvSubacuaVideoTexture) {
      console.warn('[LabScene] Cannot apply TV subacua video texture - texture not ready');
      return;
    }

    let appliedCount = 0;

    const assignTexture = (material, label = 'material') => {
      if (!material) return;
      const materials = Array.isArray(material) ? material : [material];
      materials.forEach((mat, idx) => {
        const tag = Array.isArray(material) ? `${label}[${idx}]` : label;
        console.log(`[LabScene] Applying TV subacua video texture to ${tag}:`, mat.name || 'unnamed');
        mat.map = this.tvSubacuaVideoTexture;
        mat.emissiveMap = this.tvSubacuaVideoTexture;
        mat.emissive?.set?.(0xffffff);
        mat.needsUpdate = true;
        appliedCount++;
      });
    };

    if (tvMesh.isMesh) {
      assignTexture(tvMesh.material, 'tv_der_subacuatico.material');
    } else {
      console.log('[LabScene] tv_der_subacuatico is a group, traversing children');
      tvMesh.traverse((child) => {
        if (child.isMesh) {
          assignTexture(child.material, `${child.name || 'mesh'}.material`);
        }
      });
    }

    console.log(`[LabScene] ✅ Subacua video texture applied to ${appliedCount} material(s)`);
  }

  buildFallbackLab() {
    this.isFallbackLab = true;
    this.scene.background = null;
    this.fallbackNodes.forEach((node) => this.scene.remove(node));
    this.fallbackNodes.length = 0;

    this.carpaEmpty = null;
    this._carpaBasePosition = null;
    this._carpaBaseRotation = null;

    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(2, 3, 2);
    this.scene.add(amb, dir);
    this.fallbackNodes.push(amb, dir);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial({ color: 0x10151c, side: THREE.DoubleSide })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.5;
    this.scene.add(floor);
    this.fallbackNodes.push(floor);

    this.createFallbackInteractives();

    this.camera.position.set(0, 1.4, 2.8);
    this.camera.lookAt(0, 0.6, -2);
    this.initializeCameraOrientation();
  }

  setupCarpaEmpty() {
    this.carpaEmpty = null;
    this._carpaBasePosition = null;
    this._carpaBaseRotation = null;
    if (!this.labModel) return;
    const node =
      this.labModel.getObjectByName('carpa_empty') ||
      this.labModel.getObjectByName('Carpa_empty') ||
      this.labModel.getObjectByName('Carpa_Empty');
    if (!node) return;
    this.carpaEmpty = node;
    this._carpaBasePosition = node.position.clone();
    this._carpaBaseRotation = node.rotation.clone();
    this._carpaNoiseTime = 0;
  }

  setupLuzCarpa() {
    this.luzCarpa = null;
    if (!this.labModel) return;
    const luz =
      this.labModel.getObjectByName('luz carpa') ||
      this.labModel.getObjectByName('Luz carpa') ||
      this.labModel.getObjectByName('Luz Carpa') ||
      this.labModel.getObjectByName('luz_carpa') ||
      this.labModel.getObjectByName('luzCarpa');
    if (!luz) return;
    if (!luz.isLight) {
      console.warn('[LabScene] "luz carpa" encontrada pero no es una luz');
      return;
    }
    this.luzCarpa = luz;
  }

  createFallbackInteractives() {
    console.log('[LabScene] 🔧 Creando fallback interactives...');
    this.interactives.length = 0;

    if (this.fallbackGroup) {
      this.scene.remove(this.fallbackGroup);
      this.fallbackGroup = null;
    }

    this.fallbackGroup = new THREE.Group();
    this.scene.add(this.fallbackGroup);

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x203040, side: THREE.DoubleSide })
    );
    panel.position.set(0, 0.5, 2.2); // 👈 Cambiado a Z positivo (delante de la cámara)
    panel.name = 'fallback_panel_recorrido';
  panel.userData = { goto: '#recorrido-transition', label: 'Recorrido' };
    this.fallbackGroup.add(panel);
    this.interactives.push(panel);
    console.log('[LabScene] ✅ Panel creado:', panel.name, 'en posición:', panel.position.toArray());

    const monitor = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.7, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x354a6a, side: THREE.DoubleSide })
    );
    monitor.position.set(-2, 0.9, 1.5); // 👈 Cambiado a Z positivo (delante de la cámara)
    monitor.name = 'fallback_monitor_video';
    monitor.userData = { video: '/game-assets/recorrido/transicion01.mp4', label: 'Video Delta' };
    this.fallbackGroup.add(monitor);
    this.interactives.push(monitor);
    console.log('[LabScene] ✅ Monitor creado:', monitor.name, 'en posición:', monitor.position.toArray());
    
    console.log('[LabScene] 📊 Total interactives:', this.interactives.length);
  }

  clearInteractionProxies() {
    if (!this.interactionProxies.length) return;
    this.interactionProxies.forEach((proxy) => {
      if (proxy.parent) {
        proxy.parent.remove(proxy);
      }
      proxy.geometry?.dispose?.();
      proxy.material?.dispose?.();
    });
    this.interactionProxies.length = 0;
  }

  createInteractionProxy(node) {
    if (!node) return null;
    node.updateWorldMatrix(true, true);

    const bbox = new THREE.Box3();
    bbox.setFromObject(node);

    const size = new THREE.Vector3();
    bbox.getSize(size);

    const defaultSize = 0.5;
    const minExtent = 0.2;

    if (!isFinite(size.x) || !isFinite(size.y) || !isFinite(size.z) || size.lengthSq() === 0) {
      size.set(defaultSize, defaultSize, defaultSize);
    } else {
      size.set(
        Math.max(size.x, minExtent),
        Math.max(size.y, minExtent),
        Math.max(size.z, minExtent)
      );
    }

    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    proxy.visible = false;
    proxy.name = `${node.name || 'interactive'}__proxy`;

    const center = new THREE.Vector3();
    bbox.getCenter(center);
    if (isFinite(center.x) && isFinite(center.y) && isFinite(center.z)) {
      node.worldToLocal(center);
      proxy.position.copy(center);
    }

    proxy.raycast = THREE.Mesh.prototype.raycast;
    node.add(proxy);
    this.interactionProxies.push(proxy);
    return proxy;
  }

  bindInteractiveNode(nameCandidates, userData) {
    if (!this.labModel) return false;
    for (const name of nameCandidates) {
      const node = this.labModel.getObjectByName(name);
      if (!node) continue;

      if (node.isMesh) {
        node.userData = { ...node.userData, ...userData };
        this.interactives.push(node);
        return true;
      }

      const meshChildren = [];
      node.traverse((child) => {
        if (child.isMesh) {
          meshChildren.push(child);
        }
      });

      if (meshChildren.length) {
        meshChildren.forEach((mesh) => {
          mesh.userData = { ...mesh.userData, ...userData };
          this.interactives.push(mesh);
        });
        return true;
      }

      const proxy = this.createInteractionProxy(node);
      if (proxy) {
        proxy.userData = { ...proxy.userData, ...userData };
        this.interactives.push(proxy);
        return true;
      }

      console.warn(`[LabScene] Nodo interactivo "${name}" encontrado pero sin geometría para raycast`);
    }
    return false;
  }

  configureCameraFromGLTF(cameraNode) {
    this.gltfCameraNode = cameraNode;

    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();

    cameraNode.updateWorldMatrix(true, true);
    cameraNode.getWorldPosition(worldPosition);
    cameraNode.getWorldQuaternion(worldQuaternion);

    this.camera.position.copy(worldPosition);
    this.camera.quaternion.copy(worldQuaternion);

    if (cameraNode.isPerspectiveCamera) {
      this.camera.fov = cameraNode.fov;
      this.camera.near = cameraNode.near;
      this.camera.far = cameraNode.far;
      this.camera.updateProjectionMatrix();
    }

    // 👇 Initialize lon/lat from camera direction
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.lon = THREE.MathUtils.radToDeg(Math.atan2(direction.x, direction.z));
    this.lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)));
  }

  initializeCameraOrientation() {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.lon = THREE.MathUtils.radToDeg(Math.atan2(direction.x, direction.z));
    this.lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)));
  }

  updateCameraAim() {
    const phi = THREE.MathUtils.degToRad(90 - this.lat);
    const theta = THREE.MathUtils.degToRad(this.lon);
    this.lookTarget.set(
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.cos(theta)
    );
    this.lookTarget.add(this.camera.position);
    this.camera.lookAt(this.lookTarget);
  }

  async unmount(){
    this.app.canvas.removeEventListener('click', this._onClick);
    this.app.canvas.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('keydown', this._onKeyDown);

    // 👇 Destroy cursor
    if (this.cursorRadar) {
      this.cursorRadar.destroy();
      this.cursorRadar = null;
    }

    if (document.pointerLockElement === this.app.canvas) {
      document.exitPointerLock?.();
    }

    if (this.labModel) {
      this.scene.remove(this.labModel);
      this.labModel = null;
    }

    if (this.fallbackGroup) {
      this.scene.remove(this.fallbackGroup);
      this.fallbackGroup = null;
    }

    if (this.fallbackNodes.length) {
      this.fallbackNodes.forEach((node) => this.scene.remove(node));
      this.fallbackNodes.length = 0;
    }

    this.interactives.length = 0;
    this.isFallbackLab = false;
    this.carpaEmpty = null;
    this._carpaBasePosition = null;
    this._carpaBaseRotation = null;
    this.luzCarpa = null;

    // Clean up TV video
    if (this.tvVideoElement) {
      this.tvVideoElement.pause();
      this.tvVideoElement.src = '';
      this.tvVideoElement = null;
    }
    if (this.tvVideoTexture) {
      this.tvVideoTexture.dispose();
      this.tvVideoTexture = null;
    }
    if (this._tvRetryPlay) {
      document.removeEventListener('click', this._tvRetryPlay);
      this._tvRetryPlay = null;
    }
    this.tvVideoMesh = null;

    // Clean up TV subacua video
    if (this.tvSubacuaVideoElement) {
      this.tvSubacuaVideoElement.pause();
      this.tvSubacuaVideoElement.src = '';
      this.tvSubacuaVideoElement = null;
    }
    if (this.tvSubacuaVideoTexture) {
      this.tvSubacuaVideoTexture.dispose();
      this.tvSubacuaVideoTexture = null;
    }
    if (this._tvSubacuaRetryPlay) {
      document.removeEventListener('click', this._tvSubacuaRetryPlay);
      this._tvSubacuaRetryPlay = null;
    }
    this.tvSubacuaVideoMesh = null;

    if (this.backgroundMusic) {
      this.backgroundMusic.pause();
      this.backgroundMusic.currentTime = 0;
      this.backgroundMusic = null;
    }

    if (this.labMenuMusic) {
      this.labMenuMusic.pause();
      this.labMenuMusic.currentTime = 0;
      this.labMenuMusic = null;
    }

    document.body.style.cursor = 'auto';

    this.cleanBackgroundMusic();
  }

  update(dt){
    // 👇 Update cursor and radar animations
    if (this.cursorRadar) {
      this.cursorRadar.update();
    }

    // 👇 Update TV video texture
    if (
      this.tvVideoTexture &&
      this.tvVideoElement &&
      this.tvVideoElement.readyState >= this.tvVideoElement.HAVE_CURRENT_DATA &&
      !this.tvVideoElement.paused &&
      !this.tvVideoElement.seeking
    ) {
      this.tvVideoTexture.needsUpdate = true;
    }

    // 👇 Update TV subacua video texture
    if (
      this.tvSubacuaVideoTexture &&
      this.tvSubacuaVideoElement &&
      this.tvSubacuaVideoElement.readyState >= this.tvSubacuaVideoElement.HAVE_CURRENT_DATA &&
      !this.tvSubacuaVideoElement.paused &&
      !this.tvSubacuaVideoElement.seeking
    ) {
      this.tvSubacuaVideoTexture.needsUpdate = true;
    }

    // 👇 Camera control system from RecorridoScene
    if (!this.isAutoLook) {
      const { deadzone, maxSpeed, damping } = this.config;
      const ax = this.axis(this.mouseNDC.x, deadzone);
      const ay = this.axis(this.mouseNDC.y, deadzone);
      const vx = ax * maxSpeed.yaw;
      const vy = ay * maxSpeed.pitch;
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

    this.updateCarpaFloat(dt);

    if (this.isFallbackLab) {
      this.scene.traverse((o) => {
        if (o.userData && o.userData.label === 'Recorrido') {
          o.rotation.y += dt * 0.2;
        }
      });
    }
  }

  updateCarpaFloat(dt) {
    // Subtle idle drift for the carpa_empty anchor.
    if (!this.carpaEmpty || !this._carpaBasePosition || !this._carpaBaseRotation) return;
    this._carpaNoiseTime += dt;
    const t = this._carpaNoiseTime;
    const floatAmp = 0.035;
    const driftAmp = 0.02;
    const rotAmp = THREE.MathUtils.degToRad(1);
    const phase = this._carpaNoiseSeed;

    const yOffset = Math.sin(t * 0.8 + phase) * floatAmp;
    const xOffset = Math.sin(t * 0.6 + phase * 0.37) * driftAmp;
    const zOffset = Math.sin(t * 0.55 + phase * 0.53) * driftAmp;

    this.carpaEmpty.position.set(
      this._carpaBasePosition.x + xOffset,
      this._carpaBasePosition.y + yOffset,
      this._carpaBasePosition.z + zOffset
    );

    // Rotación constante: 1 grado cada 5 segundos = 0.2 deg/s
    const constantRotation = t * THREE.MathUtils.degToRad(-1);

    const rotX = this._carpaBaseRotation.x + Math.sin(t * 0.7 + phase * 0.61) * rotAmp;
    const rotY = this._carpaBaseRotation.y + Math.sin(t * 0.5 + phase * 0.43) * rotAmp * 0.6 + constantRotation;
    const rotZ = this._carpaBaseRotation.z + Math.sin(t * 0.65 + phase * 0.88) * rotAmp;

    this.carpaEmpty.rotation.set(rotX, rotY, rotZ, this.carpaEmpty.rotation.order);
  }

  onKeyDown(event) {
    if (!this.luzCarpa) return;
    const step = 0.05;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.luzCarpa.intensity = Math.min(this.luzCarpa.intensity + step, 10);
      console.log('[LabScene] luz carpa intensity:', this.luzCarpa.intensity.toFixed(2));
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.luzCarpa.intensity = Math.max(this.luzCarpa.intensity - step, 0);
      console.log('[LabScene] luz carpa intensity:', this.luzCarpa.intensity.toFixed(2));
    }
  }

  onMouseMove(e) {
    // 👇 Mouse movement for camera control (like RecorridoScene)
    const rect = this.app.canvas.getBoundingClientRect();
    this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNDC.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  }

  axis(a, deadzone) {
    if (Math.abs(a) <= deadzone) return 0;
    const t = (Math.abs(a) - deadzone) / (1 - deadzone);
    const s = Math.min(Math.max(t, 0), 1);
    const smooth = s * s * (3 - 2 * s);
    return Math.sign(a) * smooth;
  }

  screenToNDC(ev){
    // 👇 Always use actual mouse coordinates (no pointer lock in LabScene)
    const rect = this.app.canvas.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) / rect.width;
    const cy = (ev.clientY - rect.top)  / rect.height;
    this.ndc.set(cx*2-1, -(cy*2-1));
  }

  onClick(ev){
    console.log('[LabScene] ═══════════════════════════════════════');
    console.log('[LabScene] CLICK DETECTADO');
    console.log('[LabScene] Click position:', ev.clientX, ev.clientY);
    
    // 👇 Start cursor click animation
    if (this.cursorRadar) {
      this.cursorRadar.startCursorClick(ev.clientX, ev.clientY);
    }

    this.screenToNDC(ev);
    console.log('[LabScene] NDC:', this.ndc.x, this.ndc.y);
    
    this.raycaster.setFromCamera(this.ndc, this.camera);
    console.log('[LabScene] Camera position:', this.camera.position.toArray());
    console.log('[LabScene] Raycaster direction:', this.raycaster.ray.direction.toArray());
    
    console.log('[LabScene] Interactives count:', this.interactives.length);
    
    // 👇 Update world matrices before raycasting
    this.interactives.forEach((obj, idx) => {
      obj.updateMatrixWorld(true);
      const worldPos = new THREE.Vector3();
      obj.getWorldPosition(worldPos);
      console.log(`[LabScene]   [${idx}] ${obj.name || 'unnamed'}`, {
        visible: obj.visible,
        localPosition: obj.position?.toArray(),
        worldPosition: worldPos.toArray(),
        userData: obj.userData
      });
    });
    
    // 👇 Intersect with recursive=true to check children
    const hits = this.raycaster.intersectObjects(this.interactives, true);
    
    console.log('[LabScene] Raycaster hits:', hits.length);
    if (hits.length > 0) {
      hits.forEach((hit, idx) => {
        console.log(`[LabScene]   Hit [${idx}]:`, {
          object: hit.object.name,
          distance: hit.distance,
          point: hit.point.toArray(),
          userData: hit.object.userData
        });
      });
    }
    
    if (!hits.length) {
      console.log('[LabScene] ❌ No hits - nothing clicked');
      console.log('[LabScene] ═══════════════════════════════════════');
      return;
    }
    
    const data = hits[0].object.userData || {};
    console.log('[LabScene] First hit userData:', data);
    
    if (data.goto){ 
      console.log('[LabScene] ✅ Navigating to:', data.goto);
      // 👇 Detener música inmediatamente antes de navegar
      if (this.backgroundMusic) {
        this.backgroundMusic.pause();
        this.backgroundMusic.currentTime = 0;
      }
      location.hash = data.goto; 
    } else if (data.video) {
      console.log('[LabScene] ✅ Playing video:', data.video);
      import('../core/UI.js').then(({UI})=> UI.showVideo({ src: data.video }));
    } else {
      console.log('[LabScene] ⚠️ Hit object has no goto or video action');
    }
    
    console.log('[LabScene] ═══════════════════════════════════════');
  }

  async playIntro() {
    // Variable para controlar si se debe saltar la intro
    let skipIntro = false;
    
    // Listener para ESC - permite saltear la intro
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        skipIntro = true;
      }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Ocultar cursor durante las cinemáticas
    document.body.style.cursor = 'none';
    
    // Crear overlay persistente para ambos videos
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: black;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: none;
      pointer-events: none;
    `;
    document.body.appendChild(overlay);

    // Delay inicial de medio segundo
    await new Promise(resolve => setTimeout(resolve, 500));

    // Iniciar música de intro (intro dron sin bola)
    const introMusic = new Audio('/game-assets/laboratorio/intro dron sin bola.mp3');
    introMusic.volume = 0.2;
    introMusic.play().catch(() => {});

    // Mostrar logo con fadeout mientras inicia el mapa
    const logoPromise = this.showLogoFlash(overlay, '/game-assets/laboratorio/cinematicas/logo_naranja_alpha.webm', 2000, 2000);

    // Esperar 1 segundo antes de iniciar el video del mapa (para que el logo se vea)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Reproducir primer video (mapa gigante) - sin música porque ya está sonando
    const mapaPromise = this.playIntroVideo(overlay, '/game-assets/laboratorio/cinematicas/mapa_gigante.webm', true, true);

    // Programar reproducción del audio "glitch bola" 5s después
    const glitchTimer = setTimeout(() => {
      try {
        const gbAudio = new Audio('/game-assets/laboratorio/glitch bola.mp3');
        gbAudio.volume = 0.2;
        gbAudio.play().catch(() => {});
      } catch (e) { /* ignore */ }
    }, 5000);

    // Esperar a que termine el fadeout del logo
    await logoPromise;

    // Esperar a que termine el mapa
    await mapaPromise;

    // Limpiar timer si sigue pendiente
    clearTimeout(glitchTimer);

    // Detener música de intro
    introMusic.pause();

    // Mostrar menú con video de laboratorio en loop y botón de iniciar recorrido
    await this.showLabMenu(overlay, skipIntro);
    
    // Limpiar listener de ESC
    document.removeEventListener('keydown', escapeHandler);
    
    // Limpiar overlay después del menú
    overlay.style.transition = 'opacity 0.5s';
    overlay.style.opacity = '0';
    await new Promise(resolve => setTimeout(resolve, 500));
    document.body.removeChild(overlay);
    
    // Restaurar cursor después de las cinemáticas
    document.body.style.cursor = 'auto';
  }

  async showLogoFlash(overlay, videoSrc, holdDuration, fadeOutDuration) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.src = videoSrc;
      video.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 1;
        pointer-events: none;
        z-index: 3;
        position: absolute;
        inset: 0;
      `;
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.playbackRate = 2.0;

      overlay.appendChild(video);

      video.play().then(() => {
        // Mantener el logo visible, luego hacer fadeout lento
        setTimeout(() => {
          video.style.transition = `opacity ${fadeOutDuration / 1000}s ease-out`;
          video.style.opacity = '0';
          
          // Remover después del fadeout
          setTimeout(() => {
            if (video.parentNode) video.parentNode.removeChild(video);
            resolve();
          }, fadeOutDuration);
        }, holdDuration);
      });
    });
  }

  async playIntroVideo(overlay, videoSrc, skippeable = false, withFades = false, audioSrc = null, audioVolume = 1.0) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.src = videoSrc;
      video.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: ${withFades ? '0' : '1'};
        pointer-events: auto;
        position: absolute;
        top: 0;
        left: 0;
        z-index: ${withFades ? '1' : '2'};
      `;
      video.muted = !audioSrc;
      video.playsInline = true;

      overlay.appendChild(video);

      // Audio sincronizado si se proporciona
      let audio = null;
      if (audioSrc) {
        audio = new Audio(audioSrc);
        audio.volume = audioVolume;
      }

      // Permitir saltear el video con clic si skippeable
      const skipVideo = (e) => {
        if (skippeable) {
          e.stopPropagation();
          if (audio) audio.pause();
          video.pause();
          if (video.parentNode) video.parentNode.removeChild(video);
          video.removeEventListener('click', skipVideo);
          resolve();
        }
      };
      
      if (skippeable) {
        video.addEventListener('click', skipVideo);
      }

      // Fade in del negro a video (3 segundos) solo si withFades
      video.play().then(() => {
        if (audio) audio.play().catch(() => {});
        
        if (withFades) {
          video.style.transition = 'opacity 3s ease-in';
          video.style.opacity = '1';
        }
      });

      // Calcular cuándo hacer fade out (últimos 3 segundos) solo si withFades
      if (withFades) {
        video.addEventListener('loadedmetadata', () => {
          const fadeOutTime = Math.max(0, video.duration - 3);
          
          const checkTime = () => {
            if (video.currentTime >= fadeOutTime) {
              video.style.transition = 'opacity 3s ease-out';
              video.style.opacity = '0';
            }
          };
          
          video.addEventListener('timeupdate', checkTime);
        });
      }

      // Cuando termine el video, limpiar
      video.addEventListener('ended', () => {
        if (audio) audio.pause();
        // Remover después de un breve delay
        setTimeout(() => {
          if (video.parentNode) video.parentNode.removeChild(video);
        }, 50);
        video.removeEventListener('click', skipVideo);
        resolve();
      });
    });
  }

  async showLabMenu(overlay, skipIntro = false) {
    return new Promise((resolve) => {
      // Si se debe saltear la intro, resolver inmediatamente
      if (skipIntro) {
        resolve();
        return;
      }
      
      // Limpiar overlay y preparar para el menú
      // Bajar z-index para que el menú de pausa (12000) pueda aparecer encima
      overlay.style.background = 'black';
      overlay.style.pointerEvents = 'auto';
      overlay.style.cursor = 'auto';
      overlay.style.zIndex = '10000'; // Menor que el menú de pausa (12000)
      
      // Iniciar música de fondo del laboratorio: start at 4s and fade in to 0.5 over 1.05s
      this.labMenuMusic = new Audio('/game-assets/laboratorio/Laboratorio V1.mp3');
      this.labMenuMusic.loop = true;
      // Start muted and ramp up
      this.labMenuMusic.volume = 0;
      const targetLabVol = 0.5;
      const fadeDurationMs = 1050; // 1.05s
      const startAtSec = 4.0;

      const startLabPlayback = () => {
        try {
          if (this.labMenuMusic.duration && this.labMenuMusic.duration > startAtSec) {
            this.labMenuMusic.currentTime = startAtSec;
          }
        } catch (e) { /* ignore if not allowed yet */ }
        this.labMenuMusic.play().catch(() => {});

        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min((now - t0) / fadeDurationMs, 1);
          try { this.labMenuMusic.volume = targetLabVol * p; } catch (e) { /* ignore */ }
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };

      if (this.labMenuMusic.readyState >= 2) {
        startLabPlayback();
      } else {
        this.labMenuMusic.addEventListener('loadedmetadata', startLabPlayback, { once: true });
        this.labMenuMusic.addEventListener('canplay', startLabPlayback, { once: true });
      }
      
      // Crear contenedor del menú
      const menuContainer = document.createElement('div');
      menuContainer.style.cssText = `
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: relative;
      `;
      
      // Video de laboratorio en loop (720p de alto, mantener aspecto original)
      const labVideo = document.createElement('video');
      labVideo.src = '/game-assets/laboratorio/cinematicas/laboratorio_loop.webm';
      labVideo.style.cssText = `
        height: 720px;
        width: auto;
        object-fit: cover;
        margin-bottom: 40px;
      `;
      labVideo.muted = true;
      labVideo.playsInline = true;
      labVideo.loop = true;
      labVideo.play().catch(() => {});
      
      // Contenedor de botones
      const buttonsWrapper = document.createElement('div');
      buttonsWrapper.style.cssText = `
        display: flex;
        gap: 20px;
        flex-wrap: wrap;
        justify-content: center;
      `;

      const createMenuButton = (label) => {
        const button = document.createElement('button');
        button.textContent = label;
        button.style.cssText = `
          padding: 20px 60px;
          font-size: 24px;
          font-weight: bold;
          font-family: "new-science-mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
          background: transparent;
          color: white;
          border: 2px solid white;
          border-radius: 8px;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 2px;
          transition: all 0.3s ease;
          min-width: 320px;
        `;
        button.addEventListener('mouseenter', () => {
          button.style.transform = 'scale(1.05)';
          button.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        button.addEventListener('mouseleave', () => {
          button.style.transform = 'scale(1)';
          button.style.background = 'transparent';
        });
        return button;
      };

      const enterLabButton = createMenuButton('ENTRAR AL LABORATORIO');
      enterLabButton.addEventListener('click', () => {
        labVideo.pause();
        if (this.labMenuMusic) {
          this.labMenuMusic.pause();
          this.labMenuMusic.currentTime = 0;
          this.labMenuMusic = null;
        }
        menuContainer.remove();
        // Ocultar overlay
        overlay.style.display = 'none';
        resolve();
      });

      const startButton = createMenuButton('INICIAR RECORRIDO');
      startButton.addEventListener('click', () => {
        labVideo.pause();
        if (this.labMenuMusic) {
          this.labMenuMusic.pause();
          this.labMenuMusic.currentTime = 0;
          this.labMenuMusic = null;
        }
        menuContainer.remove();
        // Ocultar overlay antes de cambiar de escena
        overlay.style.display = 'none';
        resolve();
        location.hash = '#recorrido-transition';
      });

      buttonsWrapper.appendChild(enterLabButton);
      buttonsWrapper.appendChild(startButton);

      // Agregar elementos al contenedor
      menuContainer.appendChild(labVideo);
      menuContainer.appendChild(buttonsWrapper);
      overlay.appendChild(menuContainer);
    });
  }

  ensureLabFont() {
    // Cargar fuente de Adobe Typekit si no está cargada
    const fontLinkId = 'lab-font-kit';
    if (!document.getElementById(fontLinkId)) {
      const link = document.createElement('link');
      link.id = fontLinkId;
      link.rel = 'stylesheet';
      link.href = 'https://use.typekit.net/vmy8ypx.css';
      document.head.appendChild(link);
    }
  }
}