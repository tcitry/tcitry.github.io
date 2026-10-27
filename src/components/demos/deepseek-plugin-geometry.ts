import paintOrder from './deepseek-plugin-order.json';
import {boxCorners, depthOf, fitProjection, slabOf, type Plan, type SolidPaths, type Tone} from './anatomy-iso-kit';

const BED: Plan = {x:-157,y:-104,w:314,d:244,r:7};
export const PLUGIN_CAMERA = fitProjection([...boxCorners(BED,-12,45),[-160,145,120]],760,490,{pad:25,azimuth:55,elevation:43});
interface Part {id: string; plan: Plan; z: number; h: number; paths: SolidPaths; tone: Tone; group: string; key: number}
/** Parts list: chassis/feet, three sockets/sleds/contacts, PCB, chips/pins, registry sockets, and two owned blades. */
export const DEEPSEEK_PARTS: Part[] = [];
function add(id: string,x:number,y:number,w:number,d:number,z:number,h:number,group='fixed',tone:Tone='mid') {
  const plan={x,y,w,d,r:Math.min(1.5,w/4,d/4)};
  DEEPSEEK_PARTS.push({id,plan,z,h,group,tone,paths:slabOf(plan,z,h,PLUGIN_CAMERA,4,.2),key:paintOrder[id as keyof typeof paintOrder] ?? depthOf([x+w/2,y+d/2,z+h/2],PLUGIN_CAMERA)});
}
for(const x of [-144,130])for(const y of [-92,122])add(`foot-${x}-${y}`,x,y,14,12,-12,5,'fixed','lo');
add('chassis',-157,-104,314,244,-7,7,'fixed','lo');
for(const x of [-145,143])for(const y of [-93,126])add(`bolt-${x}-${y}`,x,y,3,3,0,1,'fixed','hi');
// Three visible dependency sockets. Each slot is bounded by two cheeks and a back stop.
for(const [i,x] of [-110,-20,70].entries()) {
  add(`seat-${i}`,x-6,-85,62,60,0,3);
  add(`guide-l-${i}`,x-6,-85,3,60,3,6);
  add(`guide-r-${i}`,x+53,-85,3,60,3,6);
  add(`stop-${i}`,x-3,-85,56,3,3,6);
  const group=i===1?'service':'fixed';
  add(`sled-${i}`,x,-79,50,48,3,3,group,'hi');
  add(`housing-${i}`,x+7,-73,36,27,6,10,group);
  add(`cap-${i}`,x+8,-72,34,25,16,1,i===1?'backend':group,'hi');
  for(let pin=0;pin<4;pin++)add(`socket-contact-${i}-${pin}`,x+6+pin*10,-30,5,10,5,1);
  add(`dependency-finger-${i}`,x+18,-40,14,18,6,2,group,'hi');
  add(`trace-${i}`,x+23,-20,4,44,0,.7,'fixed','lo');
}
// tool-web stays on its own guides. Its two blades withdraw together with owned effects.
add('tool-pcb',-121,24,242,45,1,3,'consumer','hi');
for(const x of [-128,123])add(`tool-guide-${x}`,x,20,5,112,0,6);
for(const x of [-106,-40,26,92])add(`chip-${x}`,x,36,19,18,4,5,'consumer');
for(const x of [-105,-39,27,93])for(let i=0;i<3;i++)add(`chip-pin-${x}-${i}`,x+i*5,32,2,4,4,1,'consumer','lo');
for(const [i,x] of [-65,35].entries()) {
  add(`owned-trace-${i}`,x+12,54,4,14,4,.5,'consumer','lo');
  add(`owned-blade-${i}`,x,68,30,23,2,1,'consumer','hi');
  // A receiving slot is a floor and two separate cheeks, leaving an actual opening.
  add(`registry-floor-${i}`,x-4,80,38,18,0,1);
  for(const dx of [-4,31])add(`registry-cheek-${i}-${dx}`,x+dx,80,3,18,1,4);
  add(`registry-stop-${i}`,x-1,95,32,3,1,4);
  for(let n=0;n<4;n++)add(`registry-contact-${i}-${n}`,x+2+n*7,90,4,4,1,1);
}
// Independent plugin: no injection of web, so its owned registration stays seated.
add('independent-seat',-132,105,264,24,0,1,'fixed','lo');
add('independent-module',-115,109,35,16,1,4,'fixed','hi');
for(let n=0;n<5;n++)add(`independent-pin-${n}`,-74+n*12,113,7,5,1,1);
add('independent-registry',0,109,100,16,1,4);
