import {useEffect, useId, useMemo, useState} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {initialWorkflowState, MAX_AMOUNT, MIN_AMOUNT, workflowReadout, workflowReducer} from './mastra-workflow-model';
import MastraWorkflowMotion from './mastra-workflow-motion';
import demoSurface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './MastraWorkflowMachine.module.css';

/** The reducer produces the fixture; the moving working copy exposes its causal path. */
export default function MastraWorkflowMachine({id='mastra-workflow-machine'}:{id?:string}) {
  const uid=useId();
  const [hydrated,setHydrated]=useState(false);
  const [amount,setAmount]=useState(180);
  const [nextAmount,setNextAmount]=useState(60);
  const [approved,setApproved]=useState(false);
  useEffect(()=>setHydrated(true),[]);
  const fixture=useMemo(()=>{
    const initial=initialWorkflowState(amount);
    const started=workflowReducer(initial,{type:'start'});
    const changed=workflowReducer(started,{type:'amount',amount:nextAmount});
    return started.status==='suspended'?workflowReducer(changed,{type:'resume',approved}):changed;
  },[amount,nextAmount,approved]);
  const readout=workflowReadout(fixture);
  const automatic=amount<=100;

  return <section id={id} data-book-island data-demo="mastra-workflow-machine" data-hydrated={hydrated}
    data-model-status={fixture.status} data-approval-decision={readout.output?.decision} className={`${demoSurface.surface} ${frame.surface} ${styles.root}`} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <p className={frame.eyebrow}>ANATOMY · FIG. 01 / 保存与恢复</p>
      <h3 id={`${uid}-title`}>原输入留下来，新决定接进来</h3>
      <p>先看一次完整的暂停与恢复：保留的金额原件不会被下一笔草稿替换；恢复副本沿侧轨直接回到 approval，与新的决定接合，再进入 receipt。</p>
    </header>
    <div className={styles.scenarios} aria-label="比较两种执行路径">
      <Button size="sm" variant={automatic?'outline':'secondary'} isDisabled={!hydrated} data-scenario="suspend" onPress={()=>{setAmount(180);setNextAmount(60);setApproved(false);}}>180 → 草稿60 → 拒绝</Button>
      <Button size="sm" variant={automatic?'secondary':'outline'} isDisabled={!hydrated} data-scenario="automatic" onPress={()=>{setAmount(100);setNextAmount(60);}}>100 · 不暂停</Button>
    </div>
    <MastraWorkflowMotion amount={amount} nextAmount={nextAmount} approved={approved} target={fixture}/>
    <div className={styles.conditions}>
      <Slider minValue={MIN_AMOUNT} maxValue={MAX_AMOUNT} step={10} value={amount} isDisabled={!hydrated} aria-label="当前 Run 开始时的金额" onChange={value=>setAmount(Array.isArray(value)?value[0]!:value)}>
        <Label>当前 Run 的初始金额</Label><Slider.Output>{amount}</Slider.Output><Slider.Track><Slider.Fill/><Slider.Thumb/></Slider.Track>
      </Slider>
      <Slider minValue={MIN_AMOUNT} maxValue={MAX_AMOUNT} step={10} value={nextAmount} isDisabled={!hydrated} aria-label="暂停后下一笔草稿金额" onChange={value=>setNextAmount(Array.isArray(value)?value[0]!:value)}>
        <Label>暂停后的下一笔草稿</Label><Slider.Output>{nextAmount}</Slider.Output><Slider.Track><Slider.Fill/><Slider.Thumb/></Slider.Track>
      </Slider>
      <div className={styles.decision} role="group" aria-label="本次恢复决定">
        <span>恢复时传入</span>
        <Button size="sm" variant={approved?'secondary':'outline'} aria-pressed={approved} isDisabled={!hydrated||automatic} onPress={()=>setApproved(true)}>批准 · true</Button>
        <Button size="sm" variant={!approved?'secondary':'outline'} aria-pressed={!approved} isDisabled={!hydrated||automatic} onPress={()=>setApproved(false)}>拒绝 · false</Button>
      </div>
    </div>
    <p className={styles.explanation}>{automatic?'当前金额不超过100：直接通过，不取存档、不使用决定件。':'蓝色原件与工作副本都保持当前Run金额；灰色新草稿碰到独立挡块，不会进入恢复路径。true与false都会到达合成台；false产生rejected输出，流程仍会完成。'}</p>
    <details className={styles.details}>
      <summary>核对教学模型的最终字段与固定源码</summary>
      <p>这里是完整演示结束后的预期值。主画面的读数按当前播放阶段出现；金额、阈值、审批规则是本文的教学场景，浏览器没有运行 Mastra、LLM 或数据库。</p>
      <div className={styles.dataGrid}>
        <div><h4>保存的 approval 输入</h4><pre data-saved-payload>{JSON.stringify(automatic?null:fixture.snapshot?.context.approval.payload,null,2)}</pre></div>
        <div><h4>本次 resumeData</h4><pre data-resume-data>{readout.resumeData?JSON.stringify(readout.resumeData,null,2):'undefined'}</pre></div>
        <div><h4>组合后的 approval.output</h4><pre data-approval-output>{JSON.stringify(readout.output,null,2)}</pre></div>
      </div>
      <p>最终 receipt：<code data-receipt>{readout.receipt?.receipt}</code>。执行次数：<code data-counts>normalize {fixture.counts.normalize} / approval {fixture.counts.approval} / receipt {fixture.counts.receipt}</code>。</p>
      <pre data-snapshot>{JSON.stringify(fixture.snapshot,null,2)}</pre>
      <p><a href="https://github.com/mastra-ai/mastra/blob/a1fbf275e587d56a86c52295eceff6c0756169e8/packages/core/src/workflows/handlers/step.ts#L323-L465" target="_blank" rel="noopener noreferrer">固定版本的 Step 恢复入口</a>。恢复重新执行暂停的 Step，使用保存输入和新 resumeData；不会恢复旧 JavaScript 调用栈。实际副作用仍需业务幂等保护。</p>
    </details>
    <noscript><p className={styles.explanation}>静态结果：180 暂停后，下一笔草稿60不改变当前Run；传入 false 得到 rejected:180.00。normalize执行1次、approval2次、receipt1次。启用JavaScript可观看和接管动画。</p></noscript>
  </section>;
}
