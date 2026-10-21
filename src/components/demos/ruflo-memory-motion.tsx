import {Fragment} from 'react';
import {AnatomyLine, AnatomySolid} from './AnatomyArt';
import {boxCorners, depthOf, fitProjection, haloOf, iso, lineOnTop, pathOf, slabOf, topMatrix, translateAlong, type Plan, type Point3, type SolidPaths, type Tone} from './anatomy-iso-kit';
import {motionEase, motionMix, motionRange} from './MechanismPlayer';
import type {MemoryWindowResult} from './ruflo-memory-window-model';
import styles from './RufloMemoryWindowFigure.module.css';

export const MEMORY_STAGE_WIDTH = 820;
export const MEMORY_STAGE_HEIGHT = 485;
const BED: Plan = {x: -181, y: -104, w: 364, d: 211, r: 9};
export const MEMORY_CAMERA = fitProjection(boxCorners(BED, -15, 75), MEMORY_STAGE_WIDTH, MEMORY_STAGE_HEIGHT, {pad: 22, azimuth: 60, elevation: 46});
const sourceX = -126;
const scoreX = -9;
const outputX = 145;
const localY = (rank: number) => -68 + (Math.max(998, Math.min(1002, rank)) - 998) * 28;
const rowY = {A: -47, B: 0, C: 47} as const;
const outputY = (rank: number) => -80 + (rank - 1) * 18;
const BAR_START = 17;
const BAR_LENGTH = 75;
const INDEX_FLOOR_TOP = 4;
const OUTPUT_FLOOR_TOP = 4;
const SEAT_HEIGHT = 1.2;
const SCORE_BED_TOP = 4;
const SCORE_CRADLE_HEIGHT = 2;
const RULER_HEIGHT = .8;
const BYPASS_TOP = 3;
const FEED_TOP = 5;
const INDEX_CARD_Z = INDEX_FLOOR_TOP + SEAT_HEIGHT;
const OUTPUT_CARD_Z = OUTPUT_FLOOR_TOP + SEAT_HEIGHT;
const SCORE_CARD_Z = SCORE_BED_TOP + SCORE_CRADLE_HEIGHT;
const CARD_HALF_WIDTH = 14;
const CARD_THICKNESS = 2.4;
const FINGER_DROP = 10;
// The fingers meet the two card edges; their tips are level with its bottom.
const GRIP_HEAD_OFFSET = FINGER_DROP;
const CARD = slabOf({x: -CARD_HALF_WIDTH, y: -7, w: CARD_HALF_WIDTH * 2, d: 14, r: 1.4}, 0, CARD_THICKNESS, MEMORY_CAMERA, 4, .35);
const BACKGROUND_CARD = slabOf({x: -CARD_HALF_WIDTH, y: -7, w: CARD_HALF_WIDTH * 2, d: 14, r: 1.4}, 0, 1.6, MEMORY_CAMERA, 4, .25);

interface Part {name: string; paths: SolidPaths; tone: Tone; key: number; lines: string[]; front?: boolean}
export const MEMORY_MOTION_PARTS: Part[] = [];
function add(name: string, plan: Plan, z: number, height: number, tone: Tone = 'mid', front = false) {
  const part = {name, paths: slabOf(plan, z, height, MEMORY_CAMERA, 4, height > 2 ? .5 : 0), tone,
    key: depthOf([plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2], MEMORY_CAMERA), lines: [] as string[], front};
  MEMORY_MOTION_PARTS.push(part);return part;
}
for (const x of [-165, 165]) for (const y of [-88, 91]) add(`foot-${x}-${y}`, {x: x - 7, y: y - 7, w: 14, d: 14, r: 3}, -15, 6, 'lo');
add('chassis', BED, -9, 9, 'lo');
for (const x of [-170, 170]) for (const y of [-92, 95]) {
  const screw = add(`chassis-screw-${x}-${y}`, {x: x - 1.8, y: y - 1.8, w: 3.6, d: 3.6, r: .6}, 0, .8, 'mid');
  screw.lines.push(lineOnTop([x - 1.6, y], [x + 1.6, y], .82, MEMORY_CAMERA));
}
add('index-floor', {x: -163, y: -83, w: 73, d: 154, r: 3}, 0, INDEX_FLOOR_TOP, 'mid');
for (const x of [-161, -93]) add(`index-guide-${x}`, {x, y: -83, w: 3, d: 154, r: .6}, 4, 6, 'mid');
for (const rank of [998, 999, 1000, 1001, 1002]) {
  const y = localY(rank);
  add(`index-seat-${rank}`, {x: -155, y: y - 10, w: 58, d: 20, r: 1}, INDEX_FLOOR_TOP, SEAT_HEIGHT, rank <= 1000 ? 'mid' : 'lo');
}
add('cutoff-collar-left', {x: -165, y: 0, w: 8, d: 5, r: .6}, 4, 8, 'hi');
add('cutoff-collar-right', {x: -95, y: 0, w: 8, d: 5, r: .6}, 4, 8, 'hi');
add('cutoff-edge', {x: -157, y: 1.4, w: 62, d: 2.2, r: .5}, 6.5, 3, 'hi', true);
add('scope-bypass-tray', {x: -162, y: 77, w: 70, d: 20, r: 2}, 0, BYPASS_TOP, 'lo');
add('score-bed', {x: -31, y: -66, w: 133, d: 133, r: 4}, 0, SCORE_BED_TOP, 'mid');
for (const name of ['A', 'B', 'C'] as const) {
  const y = rowY[name];
  add(`record-cradle-${name}`, {x: -28, y: y - 11, w: 37, d: 22, r: 1.5}, SCORE_BED_TOP, SCORE_CRADLE_HEIGHT, 'lo');
  for (const offset of [-6, 1, 8]) {
    const ruler = add(`score-ruler-${name}-${offset}`, {x: BAR_START - 2, y: y + offset - 1, w: BAR_LENGTH + 4, d: 4.5, r: .5}, SCORE_BED_TOP, RULER_HEIGHT, 'lo');
    for (let tick = 0; tick <= 10; tick++) {
      const x = BAR_START + tick * BAR_LENGTH / 10;
      ruler.lines.push(lineOnTop([x, y + offset - 1], [x, y + offset + (tick % 5 === 0 ? 3.5 : 1)], SCORE_BED_TOP + RULER_HEIGHT + .02, MEMORY_CAMERA));
    }
  }
}
add('output-floor', {x: 121, y: -94, w: 49, d: 190, r: 3}, 0, OUTPUT_FLOOR_TOP, 'mid');
for (let rank = 1; rank <= 10; rank++) {
  const y = outputY(rank);
  add(`output-shelf-${rank}`, {x: 127, y: y - 8, w: 36, d: 16, r: .8}, OUTPUT_FLOOR_TOP, SEAT_HEIGHT, 'lo');

}
add('output-front-guide', {x: 163.5, y: -88, w: 2, d: 180, r: .4}, OUTPUT_CARD_Z, 4, 'mid', true);
add('background-feed', {x: 23, y: 73, w: 37, d: 20, r: 2}, 0, FEED_TOP, 'lo');
for (const x of [24, 58.5]) add(`background-feed-guide-${x}`, {x, y: 73, w: 2, d: 20, r: .3}, FEED_TOP, 7, 'lo');
// One gantry can lift a card, carry it into a comparator, then file it in score order.
for (const x of [-169, 167]) {
  add(`gantry-foot-${x}`, {x: x - 6, y: -102, w: 12, d: 16, r: 1.5}, 0, 5, 'mid');
  add(`gantry-post-${x}`, {x: x - 3, y: -98, w: 6, d: 8, r: .6}, 5, 61, 'mid');
  add(`gantry-top-collar-${x}`, {x: x - 5, y: -100, w: 10, d: 12, r: 1}, 61, 8, 'hi');
}
add('gantry-beam', {x: -172, y: -98, w: 343, d: 8, r: 1}, 65, 6, 'mid');
add('gantry-running-rail', {x: -162, y: -91, w: 323, d: 3, r: .4}, 66, 2, 'hi');
MEMORY_MOTION_PARTS.sort((a, b) => a.key - b.key);
export const MEMORY_MOTION_PART_COUNT = MEMORY_MOTION_PARTS.length;
const HEAD = slabOf({x: -CARD_HALF_WIDTH - 2, y: -7, w: CARD_HALF_WIDTH * 2 + 4, d: 14, r: 1.3}, 0, 5, MEMORY_CAMERA, 4, .5);
const THRESHOLD = slabOf({x: -.5, y: 0, w: 1, d: 2, r: .1}, 0, 5, MEMORY_CAMERA, 3);
const CARRIAGE = [
  slabOf({x: -9, y: -103, w: 18, d: 20, r: 1.2}, 71, 3, MEMORY_CAMERA, 4, .5),
  slabOf({x: -8, y: -103, w: 16, d: 4, r: .5}, 66, 5, MEMORY_CAMERA, 4, .3),
  slabOf({x: -8, y: -89, w: 16, d: 6, r: .5}, 66, 5, MEMORY_CAMERA, 4, .3),
];
const FINGERS = [-CARD_HALF_WIDTH - 2, CARD_HALF_WIDTH].map(x => slabOf({x, y: -5, w: 2, d: 10, r: 0}, -FINGER_DROP, FINGER_DROP, MEMORY_CAMERA, 3));

function MovingCard({name, marker}: {name: string; marker?: string}) {
  return <g data-memory-card={name} transform={translateAlong(MEMORY_CAMERA, name === 'C' ? [sourceX, localY(1001), INDEX_CARD_Z] : [scoreX,rowY[name as 'A' | 'B'],SCORE_CARD_Z])}>
    <AnatomySolid paths={CARD} tone={name === 'C' ? 'hi' : 'mid'} lit={name === 'C'} name={`record-${name}`} />
    {marker && <text transform={topMatrix([0, 0], 2.5, MEMORY_CAMERA)} className={styles.cardLetter} textAnchor="middle" dominantBaseline="middle">{marker}</text>}
    <path className={styles.cardRule} d={lineOnTop([-9, 3], [9, 3], 2.5, MEMORY_CAMERA)} />
  </g>;
}
function Bar({record, signal}: {record: string; signal: string}) {
  return <g data-memory-bar={`${record}-${signal}`} className={signal === 'blended-lexical' ? styles.lexicalMotion : undefined} opacity="0"><path className={styles.barTop} /><path className={styles.barSide} /><path className={styles.barEnd} /><path className={styles.barOutline} /></g>;
}

export function RufloMemoryStage({id}: {id: string}) {
  return <svg className={styles.machine} viewBox={`0 0 ${MEMORY_STAGE_WIDTH} ${MEMORY_STAGE_HEIGHT}`} role="img" aria-labelledby={`${id}-machine-title ${id}-machine-desc`}>
    <title id={`${id}-machine-title`}>索引卡读取与分选台</title>
    <desc id={`${id}-machine-desc`}>左侧放大第998到1002条索引槽，固定挡片隔开1000与1001。读头只取窗口内的卡片，中间三组量尺由真实分数组成，最后同一张记录卡按相关性进入右侧排序槽。</desc>
    <path className={styles.shadow} d={haloOf(BED, -15, 10, MEMORY_CAMERA)} />
    {MEMORY_MOTION_PARTS.filter(part => !part.front).map(part => <Fragment key={part.name}>
      <AnatomySolid paths={part.paths} tone={part.tone} name={part.name} />
      {part.lines.map((d, index) => <AnatomyLine key={index} d={d} faint />)}
    </Fragment>)}
    {[998, 999, 1000, 1001, 1002].map(rank => <g key={rank} data-memory-neighbour={rank} opacity={rank === 1001 ? 0 : 1} transform={translateAlong(MEMORY_CAMERA, [sourceX, localY(rank), INDEX_CARD_Z])}>
      <AnatomySolid paths={BACKGROUND_CARD} tone="lo" name={`neighbour-${rank}`} />
      <path className={styles.cardRule} d={lineOnTop([-9, -2], [9, -2], 1.7, MEMORY_CAMERA)} />
    </g>)}
    {(['A', 'B', 'C'] as const).map(record => <Fragment key={record}>
      {['semantic', 'blended-semantic', 'blended-lexical', 'score'].map(signal => <Bar key={signal} record={record} signal={signal} />)}
      <g data-memory-threshold={record}><AnatomySolid paths={THRESHOLD} tone="hi" name={`threshold-${record}`} /></g>
    </Fragment>)}
    {(['A', 'B', 'C'] as const).map(name => <MovingCard key={name} name={name} marker={name} />)}
    {Array.from({length: 10}, (_, index) => <g key={index} data-memory-background-output={index} opacity="0"><AnatomySolid paths={BACKGROUND_CARD} tone="lo" name={`background-result-${index}`} /></g>)}
    {MEMORY_MOTION_PARTS.filter(part => part.front).map(part => <AnatomySolid key={part.name} paths={part.paths} tone={part.tone} name={part.name} />)}
    <g data-memory-head-carriage>{CARRIAGE.map((paths,index)=><AnatomySolid key={index} paths={paths} tone="hi" name={`reading-carriage-${index}`} />)}</g>
    <g data-memory-head-arm><path className={styles.armTop} /><path className={styles.armSide} /><path className={styles.armEnd} /><path className={styles.barOutline} /></g>
    <g data-memory-head-shaft><path className={styles.armTop} /><path className={styles.armSide} /><path className={styles.armEnd} /><path className={styles.barOutline} /></g>
    <g data-memory-head><AnatomySolid paths={HEAD} tone="hi" name="reading-head" />{FINGERS.map((paths, index) => <AnatomySolid key={index} paths={paths} tone="mid" name={`reading-clamp-${index}`} />)}</g>
  </svg>;
}

type NodeCache = {
  cards: Record<string, SVGGElement>; thresholds: SVGGElement[]; neighbours: Array<{rank: number; node: SVGGElement}>;
  background: SVGGElement[]; bars: Record<string, SVGGElement>; carriage: SVGGElement; arm: SVGGElement; shaft: SVGGElement; head: SVGGElement;
  phase: HTMLElement; window: HTMLElement; score: HTMLElement; order: HTMLElement; equation: HTMLElement;
};
const nodes = new WeakMap<HTMLElement, NodeCache>();
function cache(stage: HTMLElement): NodeCache {
  let entry = nodes.get(stage);
  if (entry) return entry;
  const query = <T extends Element>(selector: string) => stage.querySelector<T>(selector)!;
  entry = {
    cards: Object.fromEntries(['A', 'B', 'C'].map(name => [name, query<SVGGElement>(`[data-memory-card="${name}"]`)])),
    thresholds: ['A','B','C'].map(name => query<SVGGElement>(`[data-memory-threshold="${name}"]`)),
    neighbours: [998, 999, 1000, 1001, 1002].map(rank => ({rank, node: query<SVGGElement>(`[data-memory-neighbour="${rank}"]`)})),
    background: Array.from({length: 10}, (_, index) => query<SVGGElement>(`[data-memory-background-output="${index}"]`)),
    bars: Object.fromEntries(['A', 'B', 'C'].flatMap(name => ['semantic', 'blended-semantic', 'blended-lexical', 'score'].map(signal => [`${name}-${signal}`, query<SVGGElement>(`[data-memory-bar="${name}-${signal}"]`)]))),
    carriage: query('[data-memory-head-carriage]'), arm: query('[data-memory-head-arm]'), shaft: query('[data-memory-head-shaft]'), head: query('[data-memory-head]'),
    phase: query('[data-memory-live-phase]'), window: query('[data-memory-live-window]'), score: query('[data-memory-live-score]'), order: query('[data-memory-live-order]'), equation: query('[data-memory-live-equation]'),
  };
  nodes.set(stage, entry);return entry;
}
const pointMix = (from: Point3, to: Point3, t: number): Point3 => from.map((value, index) => motionMix(value, to[index]!, t)) as Point3;
function carry(from: Point3, to: Point3, progress: number): Point3 {
  const t = motionEase(progress);
  const p = pointMix(from, to, t);
  p[2] += Math.sin(Math.PI * t) * 26;
  return p;
}
function pose(node: SVGGElement, position: Point3) {node.setAttribute('transform', translateAlong(MEMORY_CAMERA, position));}
function cuboid(node: SVGGElement, x: number, y: number, z: number, w: number, d: number, h: number) {
  const p = (dx: number, dy: number, dz: number) => iso([x + dx, y + dy, z + dz], MEMORY_CAMERA);
  const a=p(0,0,h), b=p(w,0,h), c=p(w,d,h), e=p(0,d,h), f=p(w,d,0), g=p(0,d,0), j=p(w,0,0);
  const paths = node.children;
  paths[0]?.setAttribute('d', pathOf([a,b,c,e], true));
  paths[1]?.setAttribute('d', pathOf([e,c,f,g], true));
  paths[2]?.setAttribute('d', pathOf([b,j,f,c], true));
  paths[3]?.setAttribute('d', pathOf([a,b,j,f,g,e,a], false)+pathOf([e,c,b], false)+pathOf([c,f], false));
}

export function paintRufloMemory(stage: HTMLDivElement, progress: number, result: MemoryWindowResult, fromPosition: number, _reducedMotion = false) {
  const n = cache(stage);
  // All readers, gauges and record positions share this one pedagogical time.
  const p = progress;
  const relocate = motionEase(motionRange(p, 0, .12));
  const fromRank = Math.max(998, Math.min(1002, fromPosition));
  const targetRank = Math.max(998, Math.min(1002, result.position));
  const movedIndex = fromRank !== targetRank;
  const source: Point3 = [sourceX, localY(targetRank), INDEX_CARD_Z];
  const cAtSource: Point3 = [sourceX, motionMix(localY(fromRank), localY(targetRank), relocate), INDEX_CARD_Z + (movedIndex ? Math.sin(Math.PI * relocate) * 18 : 0)];
  let c: Point3 = cAtSource;
  const cScore: Point3 = [scoreX, rowY.C, SCORE_CARD_Z];
  const bypass: Point3 = [sourceX,86,BYPASS_TOP];
  if (!result.inNamespace) c = carry([sourceX,localY(fromRank),INDEX_CARD_Z],bypass,motionRange(p,0,.12));
  else if (result.inWindow && p >= .22) c = carry(source,cScore,motionRange(p,.22,.43));
  const positions: Record<string,Point3> = {A:[scoreX,rowY.A,SCORE_CARD_Z],B:[scoreX,rowY.B,SCORE_CARD_Z],C:c};
  const beforeScan: Point3 = !result.inNamespace ? [bypass[0],bypass[1],bypass[2]+GRIP_HEAD_OFFSET]
    : [sourceX,localY(targetRank),movedIndex?INDEX_CARD_Z+GRIP_HEAD_OFFSET:34];
  const scanEnd: Point3 = result.inWindow ? [sourceX,localY(targetRank),INDEX_CARD_Z+GRIP_HEAD_OFFSET] : [sourceX,-12,34];
  let headAt: Point3;
  if(p<.12) headAt=!result.inNamespace||movedIndex?[c[0],c[1],c[2]+GRIP_HEAD_OFFSET]:[sourceX,localY(targetRank),34];
  else if(p<.22) {
    if(result.inWindow) headAt=pointMix(beforeScan,scanEnd,motionEase(motionRange(p,.12,.22)));
    else {
      const clearOfCard:Point3=[beforeScan[0],beforeScan[1],34];
      headAt=p<.15?pointMix(beforeScan,clearOfCard,motionEase(motionRange(p,.12,.15)))
        :pointMix(clearOfCard,scanEnd,motionEase(motionRange(p,.15,.22)));
    }
  }
  else if(p<.43) headAt=result.inWindow?[c[0],c[1],c[2]+GRIP_HEAD_OFFSET]:pointMix(scanEnd,[scoreX,rowY.C,34],motionEase(motionRange(p,.22,.43)));
  else headAt=[scoreX,rowY.C,result.inWindow?motionMix(SCORE_CARD_Z+GRIP_HEAD_OFFSET,34,motionEase(motionRange(p,.43,.5))):34];

  for (const item of n.neighbours) {
    if (item.rank === fromRank && result.inNamespace) {item.node.setAttribute('opacity','0');continue;}
    item.node.setAttribute('opacity',!result.inNamespace&&item.rank===fromRank?String(motionEase(motionRange(p,.02,.12))):'1');
    // Insert C into its new rank: each displaced neighbour moves only one seat.
    let nextRank=item.rank;
    if(result.inNamespace&&targetRank<fromRank&&item.rank>=targetRank&&item.rank<fromRank)nextRank++;
    else if(result.inNamespace&&targetRank>fromRank&&item.rank>fromRank&&item.rank<=targetRank)nextRank--;
    const y=motionMix(localY(item.rank),localY(nextRank),relocate);
    pose(item.node,[sourceX,y,INDEX_CARD_Z]);
  }
  for (const record of result.candidateRecords) {
    const at = record.id === 'C' ? .43 : .15;
    const semantic = motionEase(motionRange(p,at,at+.08));
    const blend = motionEase(motionRange(p,at+.08,at+.15));
    const final = motionEase(motionRange(p,at+.15,at+.22));
    const semanticPart = .6*Math.max(0,record.semantic ?? 0)*blend;
    const lexicalPart = .4*(record.lexical ?? 0)*blend;
    const segments = [
      {signal: 'semantic', value: (record.semantic ?? 0)*semantic, row: 0, offset: 0},
      {signal: 'blended-semantic', value: semanticPart, row: 1, offset: 0},
      {signal: 'blended-lexical', value: lexicalPart, row: 1, offset: semanticPart},
      {signal: 'score', value: (record.score ?? 0)*final, row: 2, offset: 0},
    ];
    for (const segment of segments) {
      const node=n.bars[`${record.id}-${segment.signal}`]!;
      node.setAttribute('opacity', record.inWindow && segment.value > .0001 ? '1' : '0');
      cuboid(node,BAR_START+BAR_LENGTH*segment.offset,rowY[record.id]-6+segment.row*7,SCORE_BED_TOP+RULER_HEIGHT,BAR_LENGTH*segment.value,2.2,2.2);
    }
  }
  n.thresholds.forEach((node,index)=>pose(node,[BAR_START+BAR_LENGTH*result.threshold,rowY[(['A','B','C'] as const)[index]!]+11.5,SCORE_BED_TOP]));
  n.background.forEach(node=>node.setAttribute('opacity','0'));
  const count=Math.max(1,result.results.length);
  let previousHead:Point3=[scoreX,rowY.C,34];
  result.results.forEach((record,index)=>{
    const start=.68+index*.18/count, end=start+.18/count;
    const trip=motionRange(p,start,end);
    const from:Point3=record.id==='A'||record.id==='B'||record.id==='C' ? positions[record.id]! : [42,83,FEED_TOP];
    const to:Point3=[outputX,outputY(index+1),OUTPUT_CARD_Z];
    const transport=motionRange(trip,.32,.78);
    const at=carry(from,to,transport);
    const aboveSource:Point3=[from[0],from[1],from[2]+25];
    const sourceGrip:Point3=[from[0],from[1],from[2]+GRIP_HEAD_OFFSET];
    const dropGrip:Point3=[to[0],to[1],to[2]+GRIP_HEAD_OFFSET];
    const aboveDrop:Point3=[to[0],to[1],to[2]+25];
    if (record.id==='A'||record.id==='B'||record.id==='C') positions[record.id]=at;
    else {const node=n.background[index]!;node.setAttribute('opacity',trip>0?'1':'0');pose(node,at);}
    if(trip>0) {
      headAt=trip<.2?pointMix(previousHead,aboveSource,motionEase(motionRange(trip,0,.2)))
        :trip<.32?pointMix(aboveSource,sourceGrip,motionEase(motionRange(trip,.2,.32)))
        :trip<.78?[at[0],at[1],at[2]+GRIP_HEAD_OFFSET]
        :pointMix(dropGrip,aboveDrop,motionEase(motionRange(trip,.78,.9)));
    }
    previousHead=aboveDrop;
  });
  for(const name of ['A','B','C']) pose(n.cards[name]!,positions[name]!);
  pose(n.carriage,[headAt[0],0,0]);
  cuboid(n.arm,headAt[0]-2,-89,63,4,Math.max(2,headAt[1]+91),3);
  cuboid(n.shaft,headAt[0]-2,headAt[1]-2,headAt[2]+5,4,4,Math.max(1,63-headAt[2]-5));
  pose(n.head,headAt);

  const cRecord=result.candidateRecords[2]!;
  const cFinal=motionRange(p,.58,.65);
  const settledScores=p>=.65;
  n.phase.textContent=p<.12?result.inNamespace?'更新时间改变，C 与邻卡交换索引槽':'先按 namespace 将 C 移出当前候选':p<.22?'读头扫描到第 1000 条截止边':p<.43?result.inWindow?'取出窗口内的 C，送入比较器':'C 留在窗口外，读头不能取走它':p<.65?'量尺先合成两项，再保留较大的分数':p<.86?'同一张记录卡按实际 score 进入结果槽':'读取完成；结果槽按相关性排列';
  n.window.textContent=!result.inNamespace?'namespace 不匹配，C 先被移出':p<.12&&fromRank!==targetRank?'正在更新 C 的索引位置':`C 第 ${result.position} 条 · ${result.inWindow?'进入窗口':'窗口外，不评分'}`;
  n.score.textContent=!result.inWindow?'C：未评分':p<.43?'C：等待读取':p<.58?'C：量尺计算中':`C：${((cRecord.score??0)*motionEase(cFinal)).toFixed(3)}${cFinal<1?' · 量尺移动中':''}`;
  n.equation.textContent=!result.inWindow?'窗口外没有 score，预设 cosine 不会进入计算。':p<.43?'先取得读取资格，才会把 C 送到比较器。':p<.58?'中间量尺：蓝色 0.6s 与灰色 0.4l 连成混合值。':`C：max(${(cRecord.blendedScore??0).toFixed(3)}, ${(cRecord.semantic??0).toFixed(3)}) → ${settledScores?(cRecord.score??0).toFixed(3):'量尺尚未到位'}${settledScores?` · threshold ${result.threshold.toFixed(2)}，${cRecord.passed?'通过':'未通过'}`:''}`;
  const arrived=result.results.filter((_,index)=>p>=.68+(index+1)*.18/count);
  n.order.textContent=arrived.length?arrived.map(record=>`${record.id.startsWith('background-')?'·':record.id} ${record.score!.toFixed(3)}`).join('  →  '):'结果槽尚未接收记录';
  stage.dataset.memoryMotionPhase=p<.22?'window':p<.43?'read':p<.65?'score':p<.86?'sort':'hold';
  stage.dataset.memoryPaintedScore=result.inWindow&&cFinal>=1?String(cRecord.score):'unscored';
}
