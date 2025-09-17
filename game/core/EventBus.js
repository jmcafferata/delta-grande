export const EventBus = new class {
constructor(){ this.m = new Map(); }
on(type, fn){
const arr = this.m.get(type) || []; arr.push(fn); this.m.set(type, arr);
return () => this.off(type, fn);
}
off(type, fn){
const arr = this.m.get(type) || []; const i = arr.indexOf(fn); if (i>=0) arr.splice(i,1);
}
emit(type, payload){ (this.m.get(type)||[]).forEach(fn=>fn(payload)); }
}();