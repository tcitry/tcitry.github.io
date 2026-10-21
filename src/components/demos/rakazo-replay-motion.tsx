import {AnatomySolid} from './AnatomyArt';
import {motionEase, motionMix, motionRange} from './MechanismPlayer';
import type {EffectStatus} from './rakazo-effect-model';
import {
  DEST_EXECUTION, DEST_RETURN, DEST_REVIEW, REPLAY_CARRIAGE_PARTS, REPLAY_CLAMP_LEFT, REPLAY_CLAMP_RIGHT,
  REPLAY_BED_GROOVE, REPLAY_HALO, REPLAY_HEAD_PARTS, REPLAY_HEIGHT, REPLAY_PART_COUNT, REPLAY_STATIC_PARTS, REPLAY_WIDTH,
  REQUEST_TOKEN, RECEIPT_TOKEN, REVIEW_TOKEN, SOURCE_PROPOSAL, SOURCE_RECEIPT, SOURCE_REQUEST,
  receiverCover, replayAt, replayMove, replayPickupNeck,
} from './rakazo-replay-motion-geometry';
import type {Point3} from './anatomy-iso-kit';
import styles from './RakazoEffectReplayMachine.module.css';

type Nodes = {
  request: SVGGElement; receipt: SVGGElement; review: SVGGElement; proposal: SVGGElement;
  bridge: SVGGElement; head: SVGGElement; left: SVGGElement; right: SVGGElement;
  pickup: SVGGElement; neck: SVGPathElement[];
  scanner: SVGPathElement; outcome: HTMLElement;
  covers: Array<{cy: number; group: SVGGElement; top: SVGPathElement; front: SVGPathElement; side: SVGPathElement}>;
  lamps: SVGCircleElement[];
};
const cache = new WeakMap<HTMLDivElement, Nodes>();
const lerpPoint = (a: Point3, b: Point3, t: number): Point3 => a.map((value, at) => motionMix(value, b[at]!, t)) as Point3;
const smooth = (p: number, a: number, b: number) => motionEase(motionRange(p, a, b));

export function drawReplayMotion(stage: HTMLDivElement, p: number, status: EffectStatus) {
  let nodes = cache.get(stage);
  if (!nodes) {
    const get = <T extends Element>(selector: string) => stage.querySelector<T>(selector)!;
    nodes = {
      request: get('[data-moving-request]'), receipt: get('[data-moving-receipt]'), review: get('[data-moving-review]'),
      proposal: get('[data-moving-proposal]'), bridge: get('[data-copy-bridge]'), head: get('[data-copy-head]'),
      left: get('[data-pickup-left]'), right: get('[data-pickup-right]'), scanner: get('[data-reader-scan]'),
      pickup: get('[data-lowering-pickup]'), neck: [...stage.querySelectorAll<SVGPathElement>('[data-anatomy-part="head-neck"] path')],
      outcome: get('[data-arrival-readout]'),
      covers: [...stage.querySelectorAll<SVGGElement>('[data-receiver-cover]')].map(group => ({cy: Number(group.dataset.cy), group,
        top: group.querySelector<SVGPathElement>('[data-cover-top]')!, front: group.querySelector<SVGPathElement>('[data-cover-front]')!, side: group.querySelector<SVGPathElement>('[data-cover-side]')!})),
      lamps: [...stage.querySelectorAll<SVGCircleElement>('[data-receiver-lamp]')],
    };
    cache.set(stage, nodes);
  }
  const request = status === 'approved';
  const receipt = status === 'completed';
  const review = status === 'executing' || status === 'uncertain';
  const moving = request || receipt || review;
  const source = receipt ? SOURCE_RECEIPT : SOURCE_REQUEST;
  const destination = request ? DEST_EXECUTION : receipt ? DEST_RETURN : DEST_REVIEW;
  const branch = request ? 'execution' : receipt ? 'return' : 'review';
  const scan = smooth(p, .20, .40);
  const transport = smooth(p, .46, .78);
  const release = smooth(p, .80, .87);
  const returnHead = smooth(p, .93, .99);
  const create = smooth(p, .30, .40);
  // The retained originals never move. A scan creates this working copy above them.
  const movingSource: Point3 = [source[0], source[1], 20];
  const movingDestination: Point3 = [destination[0], destination[1], 20];
  let position = lerpPoint(movingSource, movingDestination, transport);
  position[2] = motionMix(20, destination[2], release);
  const travelPosition: Point3 = [motionMix(position[0], source[0], returnHead), motionMix(position[1], source[1], returnHead), 0];
  // A completed copy stays in its bay. The player explicitly fades between cycles.
  const reset = p < .20;
  const copyOpacity = moving && !reset ? create : 0;
  const chosen = request ? nodes.request : receipt ? nodes.receipt : nodes.review;
  for (const node of [nodes.request, nodes.receipt, nodes.review]) {
    node.style.opacity = node === chosen ? String(copyOpacity) : '0';
    if (node === chosen) node.setAttribute('transform', replayMove(position));
  }
  const proposalForward = smooth(p, .05, .18) * (1 - smooth(p, .24, .38));
  nodes.proposal.setAttribute('transform', replayMove([motionMix(SOURCE_PROPOSAL[0], -60, proposalForward), SOURCE_PROPOSAL[1], SOURCE_PROPOSAL[2]]));
  nodes.bridge.setAttribute('transform', replayMove([moving ? travelPosition[0] : SOURCE_REQUEST[0], 0, 0]));
  nodes.head.setAttribute('transform', replayMove([moving ? travelPosition[0] : SOURCE_REQUEST[0], moving ? travelPosition[1] : SOURCE_REQUEST[1], 0]));
  const grip = moving ? smooth(p, .38, .44) * (1 - smooth(p, .87, .895)) : 0;
  // Inner jaw faces meet the selected object's edges; the smaller receipt and
  // review marker need a narrower grasp than the complete request carrier.
  const objectHalfWidth = receipt ? 18 : review ? 13 : 23;
  const jawHalfWidth = motionMix(28, objectHalfWidth, grip);
  nodes.left.setAttribute('transform', replayMove([23 - jawHalfWidth, 0, 0]));
  nodes.right.setAttribute('transform', replayMove([jawHalfWidth - 23, 0, 0]));
  // The stem extends while lowering the held copy. It opens only after the
  // copy rests on the destination, then retracts before travelling home.
  const extension = moving ? (20 - destination[2]) * release * (1 - smooth(p, .895, .93)) : 0;
  nodes.pickup.setAttribute('transform', replayMove([0, 0, -extension]));
  const neck = replayPickupNeck(extension);
  const neckPaths = [neck.fill, ...neck.shades.filter(Boolean), neck.top, ...(neck.crease ? [neck.crease] : []), ...(neck.bevel ? [neck.bevel] : []), neck.outline];
  nodes.neck.forEach((path, index) => path.setAttribute('d', neckPaths[index]!));
  const halfWidth = receipt ? 18 : 23, halfDepth = receipt ? 10 : 14;
  const scanHeight = receipt ? 6.05 : 7.05;
  const [sx, sy] = replayAt([motionMix(source[0] - halfWidth, source[0] + halfWidth, scan), source[1] - halfDepth, scanHeight]);
  const [ex, ey] = replayAt([motionMix(source[0] - halfWidth, source[0] + halfWidth, scan), source[1] + halfDepth, scanHeight]);
  nodes.scanner.setAttribute('d', `M${sx} ${sy}L${ex} ${ey}`);
  nodes.scanner.style.opacity = moving && p > .20 && p < .40 ? String(Math.sin(Math.PI * motionRange(p, .20, .40))) : '0';
  const open = smooth(p, .54, .67);
  for (const cover of nodes.covers) {
    const active = moving && cover.group.dataset.receiverCover === branch;
    const geometry = receiverCover(cover.cy, active ? open : 0);
    cover.top.setAttribute('d', geometry.top);cover.front.setAttribute('d', geometry.front);cover.side.setAttribute('d', geometry.side);
  }
  const arrived = moving ? p >= .87 : p >= .44;
  nodes.outcome.dataset.arrived = String(arrived);
  nodes.outcome.style.opacity = String(arrived ? smooth(p, moving ? .87 : .44, moving ? .91 : .50) : 0);
  for (const lamp of nodes.lamps) lamp.dataset.on = String(arrived && lamp.dataset.receiverLamp === branch && moving);
  stage.dataset.replayBranch = moving ? branch : 'held';
  stage.dataset.copyArrived = String(moving && arrived);
  stage.dataset.sourceRetained = 'true';
}

function Token({parts, marker}: {parts: typeof REQUEST_TOKEN; marker?: boolean}) {
  return <>{parts.map(part => <AnatomySolid key={part.name} name={part.name} paths={part.paths} tone={part.tone} lit={marker && part.name.includes('field-0')} />)}</>;
}

export function ReplayMotionDrawing({uid, changed}: {uid: string; changed: boolean}) {
  return <svg className={styles.machine} viewBox={`0 0 ${REPLAY_WIDTH} ${REPLAY_HEIGHT}`} role="img" aria-labelledby={`${uid}-drawing-title ${uid}-drawing-description`} data-purposeful-parts={REPLAY_PART_COUNT}>
    <title id={`${uid}-drawing-title`}>存档读取与请求回放机</title>
    <desc id={`${uid}-drawing-description`}>左侧后方为保存回执，中间为保存请求；前方独立轨道承载模型新提议。扫描生成工作副本，原档案始终留存。夹具运输工作副本至右侧执行、返回或待核验托座，最后空载回位。</desc>
    <path d={REPLAY_HALO} className={styles.shadow} />
    {REPLAY_STATIC_PARTS.map(part => <AnatomySolid key={part.name} name={part.name} paths={part.paths} tone={part.tone} />)}
    <path d={REPLAY_BED_GROOVE} className={styles.groove} />
    <g transform={replayMove(SOURCE_REQUEST)} data-retained-request><Token parts={REQUEST_TOKEN} marker /></g>
    <g transform={replayMove(SOURCE_RECEIPT)} data-retained-receipt><Token parts={RECEIPT_TOKEN} marker /></g>
    <g transform={replayMove(SOURCE_PROPOSAL)} data-moving-proposal><Token parts={REQUEST_TOKEN} marker={!changed} /></g>
    <path data-reader-scan className={styles.scan} d="" opacity="0" />
    <g data-moving-request opacity="0"><Token parts={REQUEST_TOKEN} marker /></g>
    <g data-moving-receipt opacity="0"><Token parts={RECEIPT_TOKEN} marker /></g>
    <g data-moving-review opacity="0"><Token parts={REVIEW_TOKEN} marker /></g>
    {([['return', -66], ['execution', -4], ['review', 66]] as const).map(([bay, cy]) => {
      const cover = receiverCover(cy, 0);const lamp = replayAt([159, cy, 5]);
      return <g key={bay}>
        <g data-receiver-cover={bay} data-cy={cy} className={styles.cover}>
          <path data-cover-side d={cover.side} className={styles.coverSide} /><path data-cover-front d={cover.front} className={styles.coverFront} /><path data-cover-top d={cover.top} className={styles.coverTop} />
        </g>
        <circle data-receiver-lamp={bay} data-on="false" cx={lamp[0]} cy={lamp[1]} r="3.2" className={styles.lamp} />
      </g>;
    })}
    <g data-copy-bridge transform={replayMove([SOURCE_REQUEST[0], 0, 0])}>{REPLAY_CARRIAGE_PARTS.map(part => <AnatomySolid key={part.name} name={part.name} paths={part.paths} tone={part.tone} />)}</g>
    <g data-copy-head transform={replayMove([SOURCE_REQUEST[0], SOURCE_REQUEST[1], 0])}>
      {REPLAY_HEAD_PARTS.filter(part => part.name !== 'head-tip').map(part => <AnatomySolid key={part.name} name={part.name} paths={part.paths} tone={part.tone} />)}
      <g data-lowering-pickup>
      {REPLAY_HEAD_PARTS.filter(part => part.name === 'head-tip').map(part => <AnatomySolid key={part.name} name={part.name} paths={part.paths} tone={part.tone} />)}
      <g data-pickup-left><AnatomySolid name={REPLAY_CLAMP_LEFT.name} paths={REPLAY_CLAMP_LEFT.paths} tone="hi" /></g>
      <g data-pickup-right><AnatomySolid name={REPLAY_CLAMP_RIGHT.name} paths={REPLAY_CLAMP_RIGHT.paths} tone="hi" /></g>
      </g>
    </g>
  </svg>;
}
