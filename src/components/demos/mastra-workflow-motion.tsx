import {useId} from 'react';
import {AnatomySolid} from './AnatomyArt';
import {iso, translateAlong, type Point3} from './anatomy-iso-kit';
import {MechanismPlayer, motionEase, motionMix, motionRange, type MechanismFrame} from './MechanismPlayer';
import {APPROVAL, ARCHIVE, BACK, CARRIAGE, DECISION, DECISION_MATRIX, DIE, DRAFT, DRAFT_WORK, FRONT, FOUNDATION, GATE, HEIGHT, INPUT, NORMAL, OUTPUT, P, PART_COUNT, RAM, RECEIPT, RECEIPT_MATRIX, SCANNER, SHADOW, WIDTH, WORK, WORK_MATRIX} from './mastra-workflow-motion-geometry';
import type {WorkflowMachineState} from './mastra-workflow-model';
import styles from './mastra-workflow-motion.module.css';

interface Props {amount: number; nextAmount: number; approved: boolean; target: WorkflowMachineState}
const cached = new WeakMap<HTMLDivElement, Record<string, SVGElement | HTMLElement>>();
const keys = ['ram-clip','work','archive','draft','scanner','ram','decision','imprint','gate','receipt','working-value','saved-value','resume-value','output-value','counts','phase-result'];
const lerp = (a:Point3,b:Point3,t:number):Point3 => [motionMix(a[0],b[0],t),motionMix(a[1],b[1],t),motionMix(a[2],b[2],t)];
function route(points: Point3[], t: number): Point3 {
  const lengths=points.slice(1).map((point,i)=>Math.hypot(point[0]-points[i]![0],point[1]-points[i]![1],point[2]-points[i]![2]));
  let distance=Math.max(0,Math.min(1,t))*lengths.reduce((a,b)=>a+b,0);
  for(let i=0;i<lengths.length;i++){if(distance<=lengths[i]!||i===lengths.length-1)return lerp(points[i]!,points[i+1]!,motionEase(distance/lengths[i]!));distance-=lengths[i]!;}
  return points[points.length-1]!;
}
const RETURN: Point3[]=[APPROVAL,[-5,25,13],[-5,-45,13],ARCHIVE];
const RESTORE = [...RETURN].reverse();

function amountArt(amount:number, drafted=false) {
  return <>
    <AnatomySolid paths={drafted?DRAFT_WORK:WORK} tone="hi" lit={!drafted} />
    <g transform={WORK_MATRIX} className={styles.engraving}>
      
      <rect x="5" y="16" width={45*amount/300} height="3" className={drafted?styles.draftBar:styles.amountBar} />
      <text x="5" y="12">{amount}</text>
      <circle cx="48" cy="8" r="1.6" className={drafted?styles.draftBar:styles.amountBar} />
    </g>
  </>;
}

export default function MastraWorkflowMotion({amount,nextAmount,approved,target}:Props) {
  const uid=useId().replaceAll(':','');
  const needsResume=amount>100;
  const decision=needsResume?(approved?'approved':'rejected'):'automatic';
  const output=target.snapshot?.context.receipt?.output;
  const fullReceipt=output?.receipt??'';
  const phases=needsResume?[
    {at:0,label:'金额工作副本进入 normalize；当前 Run 从这里开始。'},
    {at:.13,label:'normalize 已完成一次，金额进入 approval。'},
    {at:.25,label:`${amount} 超过 100：approval 输入送往保留槽，当前执行暂停。`},
    {at:.405,label:`Snapshot 保留 ${amount}；下一笔草稿 ${nextAmount} 留在独立入口。`},
    {at:.48,label:'扫描保留的原件，工作副本沿回送轨道直接返回 approval。'},
    {at:.65,label:`本次决定 ${String(approved)} 到达；恢复不再经过 normalize。`},
    {at:.76,label:'决定压模抬起，原金额副本带着完整输出等待出站。'},
    {at:.79,label:'组合后的同一工件离开 approval，前往 receipt。'},
    {at:.91,label:'receipt 正在接收并打印组合输出。'},
    {at:.97,label:`receipt 收到完整输出：${fullReceipt}。`},
  ]:[
    {at:0,label:`金额 ${amount} 进入 normalize。`},
    {at:.14,label:'normalize 完成一次，工作副本进入 approval。'},
    {at:.30,label:'金额不超过 100，出口直接放行；不保存暂停输入，也不使用恢复决定。'},
    {at:.70,label:'同一金额工件进入 receipt，正在生成回执。'},
    {at:.80,label:`receipt 已完成：${fullReceipt}；三个步骤各执行一次。`},
  ];
  function draw(stage:HTMLDivElement,p:number,_meta:MechanismFrame) {
    let nodes=cached.get(stage);
    if(!nodes){nodes={};for(const key of keys)nodes[key]=stage.querySelector(`[data-workflow-motion="${key}"]`)!;cached.set(stage,nodes);}
    const n=nodes;
    const move=(key:string,point:Point3)=>n[key]!.setAttribute('transform',translateAlong(P,point));
    const show=(key:string,value:number)=>n[key]!.setAttribute('opacity',String(Math.max(0,Math.min(1,value))));
    const text=(key:string,value:string)=>{if(n[key]!.textContent!==value)n[key]!.textContent=value;};
    let point:Point3=INPUT;
    let workOpacity=1;
    let stamp=0;
    let imprinted=false;
    if(needsResume){
      if(p<.13)point=lerp(INPUT,NORMAL,motionEase(motionRange(p,.015,.11)));
      else if(p<.25)point=lerp(NORMAL,APPROVAL,motionEase(motionRange(p,.13,.23)));
      else if(p<.40)point=route(RETURN,motionEase(motionRange(p,.26,.385)));
      else if(p<.48){point=ARCHIVE;workOpacity=1-motionEase(motionRange(p,.395,.42));}
      else if(p<.65){point=route(RESTORE,motionEase(motionRange(p,.505,.645)));workOpacity=motionEase(motionRange(p,.48,.505));}
      else if(p<.78){point=APPROVAL;stamp=motionEase(motionRange(p,.67,.72))*(1-motionEase(motionRange(p,.735,.775)));imprinted=p>=.72;}
      else {point=lerp(APPROVAL,OUTPUT,motionEase(motionRange(p,.79,.905)));imprinted=true;}
      show('archive',motionEase(motionRange(p,.385,.405)));
      show('draft',motionEase(motionRange(p,.415,.45)));
      show('scanner',p>=.46&&p<.515?1:0);
      n.scanner!.setAttribute('transform',translateAlong(P,[motionMix(0,61,motionEase(motionRange(p,.46,.505))),0,0]));
      move('decision',[0,0,motionMix(24,0,motionEase(motionRange(p,.60,.665)))-36*stamp]);
      show('decision',motionEase(motionRange(p,.585,.61)));
    } else {
      point=p<.15?lerp(INPUT,NORMAL,motionEase(motionRange(p,.015,.13))):p<.32?lerp(NORMAL,APPROVAL,motionEase(motionRange(p,.16,.30))):lerp(APPROVAL,OUTPUT,motionEase(motionRange(p,.38,.70)));
      show('archive',0);show('draft',0);show('scanner',0);show('decision',0);
      imprinted=p>=.34;
    }
    move('work',point);show('work',workOpacity);
    move('archive',ARCHIVE);
    const draftTravel=motionEase(motionRange(p,.425,.475));
    const draftBounce=p>.475&&p<.51?1.5*Math.sin(motionRange(p,.475,.51)*Math.PI):0;
    move('draft',[motionMix(-167,-137,draftTravel)-draftBounce,DRAFT[1],DRAFT[2]]);
    n.ram!.setAttribute('transform',translateAlong(P,[0,0,-36*stamp]));
    n['ram-clip']!.setAttribute('transform',translateAlong(P,[0,0,36*stamp]));
    show('imprint',imprinted?1:0);
    const exitOpen=needsResume?motionEase(motionRange(p,.73,.78)):1;
    n.gate!.setAttribute('transform',translateAlong(P,[0,0,24*exitOpen]));
    const receiptAt=needsResume?.91:.73;
    show('receipt',motionEase(motionRange(p,receiptAt,receiptAt+.055)));
    n.receipt!.setAttribute('transform',translateAlong(P,[0,motionMix(-28,0,motionEase(motionRange(p,receiptAt,receiptAt+.065))),0]));
    const normalized=p>=.13;
    const saved=needsResume&&p>=.405;
    const resumed=needsResume&&p>=.65;
    const completed=p>=(needsResume?.97:.80);
    const approvalStarted=p>=(needsResume?.24:.32);
    text('working-value',!completed?(needsResume&&p>.40&&p<.48?'暂停':`${amount}`):fullReceipt);
    text('saved-value',saved?String(amount):'尚无');
    text('resume-value',resumed?String(approved):'尚无');
    text('output-value',p>= (needsResume?.76:.38)?`${amount} · ${decision}`:'尚无');
    text('counts',`${normalized?1:0} / ${!approvalStarted?0:resumed?2:1} / ${completed?1:0}`);
    text('phase-result',completed?`receipt = ${fullReceipt}`:p>=.76&&needsResume?'组合结果正在进入 receipt':saved&&!resumed?'暂停：保留原件，等待恢复':'工作副本正在经过当前步骤');
    stage.dataset.workflowMotionPhase=completed?'complete':saved&&!resumed?'saved':resumed?'resuming':'initial';
    stage.dataset.workflowReceipt=completed?fullReceipt:'';
  }
  const ramY=iso([38,25,70],P)[1];
  return <MechanismPlayer label="Mastra 保存与恢复夹具" duration={18} resetKey={`${amount}/${nextAmount}/${approved}`} phases={phases} onFrame={draw}>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`${uid}-title ${uid}-desc`} data-mastra-motion data-part-count={PART_COUNT}>
      <title id={`${uid}-title`}>保存原件、专用回送轨道与决定压模</title>
      <desc id={`${uid}-desc`}>金额工作副本先经过 normalize，超限时保存在后方 Snapshot。恢复复制原件并沿侧边直接回 approval，与决定压模合成输出。下一笔草稿留在独立托盘，不进入当前 Run。</desc>
      <defs><clipPath id={`${uid}-ram`}><rect data-workflow-motion="ram-clip" x="0" y={ramY} width={WIDTH} height={HEIGHT}/></clipPath><clipPath id={`${uid}-receipt`}><path d={RECEIPT.top}/></clipPath></defs>
      <path d={SHADOW} className={styles.shadow}/>
      {[...FOUNDATION,...BACK].map(part=><g key={part.name}><AnatomySolid paths={part.paths} tone={part.tone} name={part.name}/>{part.seam&&<path d={part.seam} className={styles.seam}/>}</g>)}
      <g data-workflow-motion="archive" opacity="0" transform={translateAlong(P,ARCHIVE)}>{amountArt(amount)}</g>
      <g data-workflow-motion="draft" opacity="0" transform={translateAlong(P,DRAFT)}>{amountArt(nextAmount,true)}</g>
      <g data-workflow-motion="work" transform={translateAlong(P,INPUT)}>
        {amountArt(amount)}
        <g data-workflow-motion="imprint" opacity="0" transform={WORK_MATRIX} className={styles.imprint}>
          {needsResume?(approved?<path d="M30 8l4 4 8-8"/>:<path d="M31 5l9 9M40 5l-9 9"/>):<circle cx="36" cy="9" r="4"/>}
        </g>
      </g>
      <g data-workflow-motion="scanner" opacity="0"><AnatomySolid paths={SCANNER} tone="hi" lit name="copying-head"/></g>
      <g data-workflow-motion="gate"><AnatomySolid paths={GATE} tone="hi" name="approval-exit-stop"/></g>
      <g data-workflow-motion="ram">
        <g clipPath={`url(#${uid}-ram)`}><AnatomySolid paths={RAM} tone="hi" name="sliding-ram"/></g>
        <AnatomySolid paths={CARRIAGE} tone="mid" name="decision-carriage"/>
        <AnatomySolid paths={DIE} tone="hi" lit={needsResume} name="decision-die"/>
      </g>
      <g data-workflow-motion="decision" opacity="0"><AnatomySolid paths={DECISION} tone="hi" lit name="resume-decision"/><g transform={DECISION_MATRIX} className={styles.token}><text x="8" y="8" textAnchor="middle">{approved?'✓':'×'}</text></g></g>
      {FRONT.map(part=><AnatomySolid key={part.name} paths={part.paths} tone={part.tone} name={part.name}/>)}
      <g data-workflow-motion="receipt" opacity="0">
        <AnatomySolid paths={RECEIPT} tone="hi" name="printed-receipt"/>
        <g transform={RECEIPT_MATRIX} className={styles.receiptInk}><text x="4" y="8">{decision}</text><text x="4" y="19">{amount.toFixed(2)}</text><path d="M4 26H46"/></g>
      </g>
    </svg>
    <div className={styles.legend} aria-label="图中对象"><span><i/>同一 Run 的金额 {amount}</span><span><i className={styles.draftKey}/>下一笔草稿 {nextAmount}</span><span>后槽保留原件，工作副本沿侧轨返回</span></div>
    <div className={styles.readouts}>
      <div><span>Snapshot 原件</span><strong data-workflow-motion="saved-value">尚无</strong></div>
      <div><span>恢复决定</span><strong data-workflow-motion="resume-value">尚无</strong></div>
      <div><span>approval 输出</span><strong data-workflow-motion="output-value">尚无</strong></div>
      <div><span>执行次数 n / a / r</span><strong data-workflow-motion="counts">0 / 0 / 0</strong></div>
    </div>
    <p className={styles.current} data-workflow-motion="phase-result">工作副本正在经过当前步骤</p>
    <span className={styles.srOnly} data-workflow-motion="working-value">{amount}</span>
  </MechanismPlayer>;
}
