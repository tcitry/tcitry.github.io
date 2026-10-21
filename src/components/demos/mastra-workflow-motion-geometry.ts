import {boxCorners, cylinder, depthOf, fitProjection, haloOf, sideSeam, slabOf, topMatrix, type Plan, type Point3, type SolidPaths, type Tone} from './anatomy-iso-kit';

/** A collating fixture: a retained original, a return track, and a decision die. */
export const WIDTH = 760;
export const HEIGHT = 435;
const BASE: Plan = {x: -188, y: -88, w: 376, d: 190, r: 9};
export const P = fitProjection([
  ...boxCorners(BASE, -16, 13),
  ...boxCorners({x: 25, y: -13, w: 26, d: 79, r: 1}, 10, 113),
], WIDTH, HEIGHT, {pad: 26, azimuth: 50, elevation: 38});
export const SHADOW = haloOf(BASE, -16, 3, P);
export interface FixturePart {name: string; purpose: string; paths: SolidPaths; tone: Tone; center: Point3; seam?: string; front?: boolean}
const parts: FixturePart[] = [];
function slab(name: string, purpose: string, plan: Plan, z: number, h: number, tone: Tone = 'mid', front = false) {
  const part: FixturePart = {name, purpose, paths: slabOf(plan, z, h, P, 7, h >= 3 ? .5 : 0), tone, center: [plan.x + plan.w/2, plan.y + plan.d/2, z+h/2], front};
  parts.push(part);return part;
}
function round(name: string, purpose: string, x: number, y: number, r: number, z: number, h: number, tone: Tone='mid', front=false) {
  parts.push({name,purpose,paths:cylinder(x,y,r,z,h,P,48,h>=3?.25:0),tone,center:[x,y,z+h/2],front});
}
for(const [i,[x,y]] of [[-170,-70],[170,-70],[-170,84],[170,84]].entries()) {
  round(`foot-${i}`,'Rubber foot supports the instrument',x,y,6,-16,3,'lo');
  round(`foot-neck-${i}`,'Neck joins the foot to the milled bed',x,y,4,-13,5);
}
const bed=slab('bed','One milled bed supports the input, archive and return track',BASE,-8,8,'lo');
bed.seam=sideSeam(BASE,-4,P,7);
for(const [i,[x,y]] of [[-177,-77],[177,-77],[-177,91],[177,91]].entries()) round(`bed-bolt-${i}`,'Fastens the bed',x,y,1.5,0,.8,'hi');

for(const [name,x] of [['input',-140],['normalize',-78],['approval',38],['receipt',140]] as const) {
  slab(`${name}-platen`,'Supports the amount working piece at this station',{x:x-31,y:7,w:62,d:37,r:3},0,9);
  for(const [i,dx] of [-25,25].entries()) round(`${name}-mount-${i}`,'Retains the station platen',x+dx,12,1.2,9,.8,'hi');
}
// The front track carries the initial input and finished output. Its return
// branch goes behind the fixture, bypassing normalize when a run resumes.
for(const [i,y] of [14,36].entries()) slab(`main-rail-${i}`,'Guides the amount carriage between execution stations',{x:-167,y:y-1.5,w:334,d:3,r:1},9,3,'hi');
for(const [i,x] of [-27,17].entries()) slab(`return-rail-${i}`,'Guides a restored copy from the archive to approval',{x:x-1.5,y:-45,w:3,d:70,r:1},9,3,'hi');
for(const [i,y] of [-56,-34].entries()) slab(`archive-rail-${i}`,'Joins the retained original to the return track',{x:-110,y:y-1.5,w:105,d:3,r:1},9,3,'hi');
for(const [i,x] of [-145,-111,-77,-43,-9,25,59,93,127,161].entries()) round(`track-pin-${i}`,'Locates the rail on the bed',x,45,1,0,1,'lo');

slab('archive-platen','A shallow recess retains the original step payload',{x:-144,y:-65,w:68,d:40,r:3},0,12,'mid');
slab('archive-back','Protects the back edge of the saved payload',{x:-144,y:-65,w:68,d:3,r:1},12,5,'hi');
slab('archive-left','Registers the saved payload without covering its face',{x:-144,y:-62,w:3,d:34,r:1},12,4);
slab('archive-right','Registers the saved payload without covering its face',{x:-79,y:-62,w:3,d:34,r:1},10,2);
slab('archive-front','Retains the original inside its recess',{x:-141,y:-28,w:62,d:3,r:1},12,3,'hi',true);
for(const [i,x] of [-135,-85].entries()) round(`archive-bolt-${i}`,'Fastens the archive recess',x,-60,1.1,12,.8,'hi');
slab('archive-scan-guide','Supports the copying head above the retained original',{x:-144,y:-68,w:68,d:3,r:1},17,3,'hi');

slab('draft-platen','Holds the next draft separately from the current run',{x:-172,y:61,w:64,d:31,r:3},0,6,'lo');
slab('draft-stop','Stops the next draft from entering the current run track',{x:-109,y:61,w:3,d:31,r:1},6,7,'hi');
for(const [i,x] of [-167,-115].entries()) round(`draft-bolt-${i}`,'Mounts the independent draft tray',x,86,1,6,.7,'hi');

for(const [i,y] of [-8,58].entries()) {
  slab(`press-foot-${i}`,'Seats a vertical press guide beside the working track',{x:29,y:y-8,w:18,d:16,r:2},0,9,'mid',i===1);
  for(const [j,dx] of [-5,5].entries()) round(`press-bolt-${i}-${j}`,'Fixes the press foot to the bed',38+dx,y-4,1.1,9,.7,'hi',i===1);
  round(`press-post-${i}`,'A guide post supports the crosshead outside the carriage path',38,y,2.8,9,91,'mid',i===1);
  round(`press-collar-${i}`,'Seats the guide post at the crosshead',38,y,4,96,4,'hi',i===1);
}
slab('crosshead','Holds the decision die over approval',{x:29,y:-14,w:18,d:78,r:2},100,8,'hi',true);
for(const [i,y] of [-8,58].entries()) round(`crosshead-fastener-${i}`,'Retains the press crosshead',38,y,1.3,108,.8,'hi',true);
slab('ram-gland','Keeps the sliding ram connected to the crosshead',{x:32,y:19,w:12,d:12,r:2},70,30,'mid',true);

for(const [i,y] of [5,45].entries()) round(`gate-guide-${i}`,'Keeps the approval exit stop outside the payload path',71,y,1.5,9,30,'hi');

export const PARTS = parts.slice().sort((a,b)=>depthOf(a.center,P)-depthOf(b.center,P));
export const FOUNDATION=PARTS.filter(part=>part.name.startsWith('foot-')).concat(PARTS.filter(part=>part.name==='bed'),PARTS.filter(part=>part.name.startsWith('bed-bolt-')));
const foundationNames=new Set(FOUNDATION.map(part=>part.name));
export const BACK = PARTS.filter(part=>!part.front&&!foundationNames.has(part.name)).sort((a,b)=>{const layer=(part:FixturePart)=>part.name.includes('platen')?0:part.name.includes('rail')?1:2;return layer(a)-layer(b)||depthOf(a.center,P)-depthOf(b.center,P);});
export const FRONT = PARTS.filter(part=>part.front);
export const PART_COUNT = PARTS.length + 10; // working pieces, copying head, die and ram below
export const INPUT: Point3 = [-140,25,13];
export const NORMAL: Point3 = [-78,25,13];
export const APPROVAL: Point3 = [38,25,13];
export const ARCHIVE: Point3 = [-110,-45,13];
export const OUTPUT: Point3 = [140,25,13];
export const DRAFT: Point3 = [-140,76,7];
export const WORK_PLAN: Plan = {x:-27.5,y:-13,w:55,d:26,r:2};
export const WORK = slabOf(WORK_PLAN,0,3,P,7,.4);
export const WORK_MATRIX=topMatrix([-27.5,-13],3.08,P);
export const DRAFT_WORK=slabOf(WORK_PLAN,0,2,P,7,.3);
export const SCANNER=slabOf({x:-143,y:-59,w:4,d:28,r:.8},17,4,P,7,.4);
export const DIE=slabOf({x:25,y:17,w:26,d:16,r:2},52,8,P,7,.8);
export const CARRIAGE=slabOf({x:25,y:-12,w:26,d:74,r:2},60,6,P,7,.5);
export const RAM=slabOf({x:35,y:22,w:6,d:6,r:1},66,45,P,7,.4);
export const DECISION=slabOf({x:30,y:39,w:16,d:12,r:1},66,3,P,7,.4);
export const DECISION_MATRIX=topMatrix([30,39],69.08,P);
export const RECEIPT_MATRIX=topMatrix([115,42],13.05,P);
export const RECEIPT=slabOf({x:115,y:42,w:50,d:35,r:.5},12,1,P,7,0);

export const GATE=slabOf({x:68,y:9,w:5,d:32,r:1},13,8,P,7,.4);
