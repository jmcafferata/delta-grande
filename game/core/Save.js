const KEY = 'deltaPlus.save.v1';


export const Save = {
load(){
try{ return JSON.parse(localStorage.getItem(KEY) || '{}'); }
catch{ return {}; }
},
save(obj){ localStorage.setItem(KEY, JSON.stringify(obj)); }
};