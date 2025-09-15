import { App } from './core/App.js';
import { Router } from './core/Router.js';
import { SceneManager } from './core/SceneManager.js';
import { EventBus } from './core/EventBus.js';
import { State } from './core/State.js';
import { UI } from './core/UI.js';


import { LabScene } from './scenes/LabScene.js';
import { RecorridoScene } from './scenes/RecorridoScene.js';
import { SimuladorScene } from './scenes/SimuladorScene.js';
import { RioScene } from './scenes/RioScene.js';


// App singleton
const app = new App('#app');


// UI overlays (hud)
UI.init({ app, clockEl: document.getElementById('clock'),
inventoryEl: document.getElementById('inventoryPanel'),
achievementsEl: document.getElementById('achievementsPanel'),
videoOverlayEl: document.getElementById('videoOverlay'),
videoEl: document.getElementById('labVideo') });


// Global router + scenes
const scenes = {
lab: () => new LabScene(app),
recorrido: () => new RecorridoScene(app),
simulador: () => new SimuladorScene(app),
rio: () => new RioScene(app)
};


const sceneManager = new SceneManager(app, scenes);
const router = new Router({
onRoute: (route) => {
const name = route.replace(/^#/, '') || 'lab';
sceneManager.goTo(name);
}
});


// Topbar buttons navigation
for (const btn of document.querySelectorAll('[data-nav]')) {
btn.addEventListener('click', () => router.navigate(btn.dataset.nav));
}


// Start
app.start();
router.boot(); // reads current hash and triggers first scene


// Example: listen to item found and refresh UI
EventBus.on('inventory:changed', () => UI.renderInventory(State));
EventBus.on('achievements:changed', () => UI.renderAchievements(State));
UI.renderInventory(State);
UI.renderAchievements(State);