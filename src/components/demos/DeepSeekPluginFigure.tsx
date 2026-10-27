import {useId, useState} from 'react';
import {Button} from '@heroui/react';
import {MechanismPlayer} from './MechanismPlayer';
import {AnatomySolid} from './AnatomyArt';
import {depthOf, translateAlong} from './anatomy-iso-kit';
import {DEEPSEEK_PARTS, PLUGIN_CAMERA as P} from './deepseek-plugin-geometry';
import {pluginFrame, type PluginScenario} from './deepseek-plugin-model';
import surface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './DeepSeekPluginFigure.module.css';

const PHASES=[{at:0,label:'1 / 三个必需服务均存在，tool-web 的两个注册已插入 registry。'},
  {at:.12,label:'2 / 改变指定条件；先移除服务或 provider，再观察依赖。'},
  {at:.24,label:'3 / 必需服务缺失才触发 consumer 卸载；回收它拥有的注册。'},
  {at:.39,label:'4 / 保持缺失状态：对照 registry 空位与仍在运行的独立插件。'},
  {at:.62,label:'5 / 恢复服务或 provider；显式 dispose 的插件保持移除。'},
  {at:.74,label:'6 / 依赖齐全时重新执行 apply，重新建立注册。'},
  {at:.89,label:'7 / 生命周期已完成；注册数量与 consumer 状态来自同一教学模型。'}];

function phasesFor(scenario: PluginScenario) {
  if(scenario==='service')return PHASES;
  const labels=scenario==='backend' ? [
    '1 / 必需服务与两个工具定义均存在。',
    '2 / 只取下 HTTP provider；ctx.web Service 本身保留。',
    '3 / inject 条件仍满足，consumer 不卸载。',
    '4 / 两个定义仍在 registry；fetch 执行会报告 provider 不可用。',
    '5 / 恢复 HTTP provider 的注册。',
    '6 / Service 重新获得 provider；tool-web 无须重新执行 apply。',
    '7 / provider 已恢复，consumer 一直保持 ACTIVE。',
  ] : [
    '1 / consumer 激活，两个工具注册存在。',
    '2 / 保留全部 Service，准备显式 dispose consumer。',
    '3 / 显式卸载 consumer，回收它拥有的两个注册。',
    '4 / consumer 已进入 DISPOSED；独立插件仍保留注册。',
    '5 / 服务持续可用，但已经移除的 consumer 不会自行恢复。',
    '6 / 没有重新挂载 consumer，因此不会执行 apply。',
    '7 / DISPOSED 为终态，两个工具定义保持移除。',
  ];
  return PHASES.map((phase,index)=>({...phase,label:labels[index]!}));
}

export default function DeepSeekPluginFigure() {
  const id=useId();const [scenario,setScenario]=useState<PluginScenario>('service');
  function paint(stage: HTMLDivElement,p:number) {
    const s=pluginFrame(p,scenario);
    stage.dataset.consumer=s.consumer;stage.dataset.tools=String(s.tools);
    stage.dataset.webService=String(s.webService);stage.dataset.fetchBackend=String(s.fetchBackend);
    const svg=stage.querySelector('svg');
    const ordered: Array<{node: Element; key: number}> = [];
    for(const part of DEEPSEEK_PARTS) {
      // Withdrawal goes back over the PCB, away from registry mouths; it never crosses an occupied blade.
      const move: [number,number,number]=part.group==='service'?[0,0,scenario==='service'?s.removed*58:0]
        : part.group==='backend'?[0,0,scenario==='service'?s.removed*58:scenario==='backend'?s.removed*28:0]
        : part.group==='consumer'?[0,-s.cleaned*12,s.cleaned*36]:[0,0,0];
      const node=stage.querySelector(`[data-part="${part.id}"]`);
      if(node){node.setAttribute('transform',translateAlong(P,move));ordered.push({node,key:part.key+depthOf(move,P)});}
    }
    ordered.sort((a,b)=>a.key-b.key);
    if(svg && ordered.some((item,i)=>svg.children[i]!==item.node)){const fragment=document.createDocumentFragment();for(const {node} of ordered)fragment.append(node);svg.append(fragment);}
    const text=(key:string,value:string)=>{const node=stage.querySelector(`[data-readout="${key}"]`);if(node)node.textContent=value;};
    text('state',s.consumer);text('tools',`${s.tools} 个 Web 工具定义`);
    text('services',`tools ✓ · web ${s.webService?'✓':'×'} · systemPrompt ✓`);
    text('call',s.call);text('backend',`HTTP fetch provider：${s.fetchBackend?'存在':'缺失'}`);
  }
  return <section className={`${surface.surface} ${frame.surface} ${styles.figure}`} data-demo="deepseek-plugins" data-book-island aria-labelledby={`${id}-heading`}>
    <header><p className={frame.eyebrow}>ANATOMY / CORDIS PLUGIN LIFETIME</p>
      <h3 id={`${id}-heading`}>拔掉服务，谁的注册会跟着退出？</h3>
      <p className={frame.note}>后排三个插接点对应 inject；中间电路板对应 tool-web；前排两枚插片对应它拥有的工具注册。最前方为不依赖 web 的独立插件。</p></header>
    <div className={frame.controls} aria-label="对照条件">
      {([['service','移除 ctx.web'],['backend','只移除 HTTP provider'],['dispose','显式 dispose consumer']] as const).map(([value,label])=><Button size="sm" key={value} variant={scenario===value?'secondary':'outline'} aria-pressed={scenario===value} onPress={()=>setScenario(value)}>{label}</Button>)}
    </div>
    <MechanismPlayer label="Cordis 必需依赖与资源回收" duration={16} resetKey={scenario} phases={phasesFor(scenario)} onFrame={paint}>
      <div className={frame.corners}><span>Fig. 1 · required services → owned registrations</span><span data-readout="state">ACTIVE</span></div>
      <svg className={frame.figure} viewBox="0 0 760 490" role="img" aria-label="插件背板：三个服务插座、中间 tool-web 电路板和两个注册插片。服务退出后，电路板及其注册从原插槽抬起；独立插件留在原位。">
        {[...DEEPSEEK_PARTS].sort((a,b)=>a.key-b.key).map(part=><g key={part.id} data-part={part.id}><AnatomySolid paths={part.paths} tone={part.tone} lit={part.group==='consumer'} /></g>)}
      </svg>
      <div className={styles.legend}><span>后排：tools / web / systemPrompt</span><span>中排：tool-web → search / fetch</span><span>前排：独立插件，保持注册</span></div>
      <div className={styles.readouts}><strong data-readout="tools">2 个 Web 工具定义</strong><code data-readout="services">tools ✓ · web ✓ · systemPrompt ✓</code><span data-readout="backend">HTTP fetch provider：存在</span><span data-readout="call">可执行（假设 provider 已配置）</span></div>
    </MechanismPlayer>
    <p className={frame.note}>服务与 provider 是两层：中间按钮保留 ctx.web，因此板和两枚插片都不退出；fetch 执行才会报告 provider 不可用。抬升距离和动画时长用于教学，不表示源码中的性能或真实硬件。</p>
    <p className={frame.note}>教学模型固定另外两个服务可用，两个工具配置均启用；省略 prompt 注册与进行中的调用。服务恢复会重新建立注册，不能推导为自动恢复网络请求。依据 <a href="https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/vendor/cordis/src/fiber.ts#L613-L743">Fiber 生命周期</a> 与 <a href="https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/web/tool-web/src/index.ts#L1-L26">tool-web</a>；绘图使用项目 Anatomy kit。</p>
  </section>;
}
