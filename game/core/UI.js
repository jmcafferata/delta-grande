import { Time } from './Time.js';
import { EventBus } from './EventBus.js';

export const UI = new class{
  init({ app, clockEl, inventoryEl, achievementsEl, videoOverlayEl, videoEl }){
    this.app = app;
    this.clockEl = clockEl;
    this.inventoryEl = inventoryEl;
    this.achievementsEl = achievementsEl;
    this.videoOverlayEl = videoOverlayEl;
    this.videoEl = videoEl;

    // Reloj local
    this.clockEl.textContent = '--:--';
    setInterval(()=>{
      const d = Time.now();
      this.clockEl.textContent = d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
    }, 1000);

    // Cerrar overlay al click “afuera” o con ESC
    this.videoOverlayEl.addEventListener('click', (e)=>{
      if (e.target === this.videoOverlayEl) this.hideVideo();
    });
    addEventListener('keydown', (e)=>{ if (e.key === 'Escape') this.hideVideo(); });

    // Mostrar paneles solo en LAB
    EventBus.on('scene:changed', ({ name })=>{
      const inLab = (name === 'lab' || name === 'LabScene');
      this.setPanelsVisible(inLab);
    });

    // Ocultos hasta que cargue primera escena
    this.setPanelsVisible(false);
  }

  setPanelsVisible(visible){
    const disp = visible ? 'block' : 'none';
    if (this.inventoryEl) this.inventoryEl.style.display = disp;
    if (this.achievementsEl) this.achievementsEl.style.display = disp;
  }

  renderInventory(State){
    const inv = State.get().inventory;
    this.inventoryEl.innerHTML = `<h3>Inventario</h3>` +
      (inv.length
        ? `<ul>${inv.map(i=>`<li>${i.name} <small>(${new Date(i.whenISO).toLocaleDateString('es-AR')})</small></li>`).join('')}</ul>`
        : `<p style="color:#94a3b8">Vacío</p>`);
  }

  renderAchievements(State){
    const ac = State.get().achievements;
    this.achievementsEl.innerHTML = `<h3>Logros</h3>` +
      (ac.length
        ? `<ul>${ac.map(i=>`<li>${i.name}</li>`).join('')}</ul>`
        : `<p style="color:#94a3b8">Sin logros aún</p>`);
  }

  /**
   * Reproduce un video en overlay full-screen “cover”.
   * opts: { src, controls=false, muted=true, immersive=true, onended }
   */
  showVideo(opts = {}){
    const { src, controls=false, muted=true, immersive=true, onended } = opts;

    // Atributos y estilo para que no muestre controles y cubra pantalla
    this.videoEl.src = src || '';
    this.videoEl.controls = !!controls;
    this.videoEl.muted = !!muted;
    this.videoEl.playsInline = true;

    this.videoOverlayEl.style.display = 'block';

    const done = () => {
      this.videoEl.onended = null;
      this.hideVideo();
      if (typeof onended === 'function') onended();
    };
    this.videoEl.onended = done;

    const p = this.videoEl.play();
    if (p && typeof p.catch === 'function') p.catch(()=>{});

    // Intento opcional de fullscreen nativo (ignora si falla/iOS)
    if (immersive && this.videoOverlayEl.requestFullscreen) {
      this.videoOverlayEl.requestFullscreen().catch(()=>{});
    }
  }

  hideVideo(){
    try { this.videoEl.pause(); } catch {}
    this.videoOverlayEl.style.display = 'none';
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(()=>{});
    }
  }
}();
