import { Save } from './Save.js';
import { EventBus } from './EventBus.js';


const DEFAULT = {
inventory: [], // [{id, name, whenISO}]
achievements: [], // [{id, name, whenISO}]
scores: { simulador: 0 },
fishCounts: {}, // { speciesId: count }
};


const data = Object.assign({}, DEFAULT, Save.load());


function commit(){ Save.save(data); }

export const State = {
get(){ return data; },


addItem(item){
if (!data.inventory.find(x=>x.id===item.id)){
data.inventory.push({ ...item, whenISO: new Date().toISOString() });
commit(); EventBus.emit('inventory:changed');
}
},


addAchievement(ach){
if (!data.achievements.find(x=>x.id===ach.id)){
data.achievements.push({ ...ach, whenISO: new Date().toISOString() });
commit(); EventBus.emit('achievements:changed');
}
},


setHighScoreSimulador(score){
if (score > (data.scores.simulador||0)){
data.scores.simulador = score; commit(); EventBus.emit('scores:changed');
}
},


addFish(speciesId){
data.fishCounts[speciesId] = (data.fishCounts[speciesId]||0) + 1;
commit(); EventBus.emit('fish:changed', { speciesId });
}
};