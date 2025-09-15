export class Router{
constructor({ onRoute }){
this.onRoute = onRoute;
addEventListener('hashchange', () => this.onRoute?.(location.hash));
}
boot(){ this.onRoute?.(location.hash); }
navigate(hash){ location.hash = hash; }
}