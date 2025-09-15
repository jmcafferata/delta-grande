export class SceneManager{
constructor(app, registry){
this.app = app;
this.registry = registry; // { name: () => new Scene(app) }
this.currentName = null;
this.instance = null;
}
async goTo(name){
const factory = this.registry[name];
if (!factory) throw new Error('Scene not found: '+name);
if (this.instance) await this.instance.unmount?.();
this.instance = factory();
this.currentName = name;
await this.app.setScene(this.instance);
}
}