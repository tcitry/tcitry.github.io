import {useEffect, useId, useMemo, useState} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {AnatomyLine, AnatomySolid} from './AnatomyArt';
import {
  SPLICE_HEIGHT, SPLICE_WIDTH, SPLICE_HALO, SPLICE_LABELS, SPLICE_PART_COUNT,
  cutterTransform, splicePartOrder, type SplicePart,
} from './cloudflare-code-change-geometry';
import {
  CODE_CHANGE_SOURCE, INITIAL_SPLICE, prefixForSource, spliceText, visibleText,
  type SourceVariant, type SpliceInput, type SpliceState, type TextCell,
} from './cloudflare-code-change-model';
import demoSurface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './CloudflareCodeChangeMachine.module.css';

function cellFor(part: SplicePart, state: SpliceState): TextCell | undefined {
  if (part.index === undefined) return;
  if (part.family === 'source') return state.sourceCells[part.index];
  if (part.family === 'output') return state.outputCells[part.index];
  if (part.family === 'inserted') return state.insertedCells[part.index];
  if (part.family === 'deleted') return state.deletedCells[part.index];
}

const roleText = {keep: '保留', delete: '计划删除', insert: '新插入', uncovered: '变更未覆盖'};

/** A direct parameter experiment. The apparatus is a metaphor, not an execution timeline. */
export default function CloudflareCodeChangeMachine() {
  const id = useId();
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState<SpliceInput>(() => ({...INITIAL_SPLICE}));
  useEffect(() => {setHydrated(true);}, []);
  const state = useMemo(() => spliceText(input), [input]);
  const parts = useMemo(() => splicePartOrder(state.prefix), [state.prefix]);
  function selectSource(variant: SourceVariant) {
    // Show the exact same initial edit against a different input before offering regeneration.
    setInput(current => ({...current, variant, prefix: 14}));
  }

  return <section className={`${demoSurface.surface} ${frame.surface} ${styles.demo}`}
    id="cloudflare-code-change-machine" data-demo="cloudflare-code-change-machine" data-book-island
    data-hydrated={hydrated} data-valid={state.valid} data-before-length={state.beforeLength}
    data-after-length={state.output?.length ?? 'rejected'} aria-labelledby={`${id}-heading`}>
    <p className={frame.eyebrow}>Anatomy / TextChange → applyCodeChange</p>
    <h3 className={frame.heading} id={`${id}-heading`}>一段改动，怎样拼出新文本？</h3>
    <p className={frame.note}>把文本想成字符料带：数字表示保留多少个 UTF-16 单元，<code>[2, '{state.inserted}']</code> 表示切掉 2 个、插入新文本。改动必须覆盖整条原文；滑块改变插入内容，不会重写保留长度。</p>

    <fieldset className={styles.controls} disabled={!hydrated}>
      <legend>改输入，立即观察字符怎样拼接</legend>
      <div className={styles.sources} role="radiogroup" aria-label="选择原文">
        <label><input type="radio" name={`${id}-source`} value="original" checked={input.variant === 'original'} onChange={() => selectSource('original')} />原文</label>
        <label><input type="radio" name={`${id}-source`} value="extra-space" checked={input.variant === 'extra-space'} onChange={() => selectSource('extra-space')} />原文多一个空格</label>
      </div>
      <Slider className={styles.slider} minValue={1} maxValue={999} step={1} value={Number(state.inserted)}
        isDisabled={!hydrated} aria-label="替换 limit 的数字" onChange={value => setInput(current => ({...current, replacement: Array.isArray(value) ? value[0] ?? 25 : value}))}>
        <Label>替换成</Label><Slider.Output>{state.inserted}</Slider.Output>
        <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
      </Slider>
      <div className={styles.actions}>
        <Button size="sm" variant="secondary" isDisabled={!hydrated || state.valid}
          onPress={() => setInput(current => ({...current, prefix: prefixForSource(current.variant)}))}>按新原文生成变更</Button>
        <Button size="sm" variant="ghost" isDisabled={!hydrated} onPress={() => setInput({...INITIAL_SPLICE})}>恢复初始示例</Button>
      </div>
    </fieldset>

    <div className={frame.card}>
      <div className={frame.corners}><span>Fig 01 · 文本拼接工作台</span><span>workpiece 7 / server.js</span></div>
      <div className={styles.viewport} tabIndex={0} role="region" aria-label="文本拼接工作台，可横向滚动查看字符">
        <svg className={`${frame.figure} ${styles.figure}`} viewBox={`0 0 ${SPLICE_WIDTH} ${SPLICE_HEIGHT}`}
          role="img" aria-labelledby={`${id}-svg-title ${id}-svg-description`} data-anatomy-parts={SPLICE_PART_COUNT}>
          <title id={`${id}-svg-title`}>字符料带上的保留、删除与插入</title>
          <desc id={`${id}-svg-description`}>{state.explanation} BEFORE 原文为 {visibleText(state.source)}；CUT 槽{state.valid ? `显示被删除的 ${state.deleted}` : '保持空白，因为变更被拒绝'}；INSERT 槽为 {state.inserted}；AFTER {state.output === null ? '不输出结果' : visibleText(state.output)}。点号表示空格，折返箭头表示换行。</desc>
          <defs><clipPath id={`${id}-glyph-face`}><rect width="14.6" height="20" /></clipPath></defs>
          <path d={SPLICE_HALO} className={styles.halo} />
          {parts.map(part => {
            const cell = cellFor(part, state);
            const isCell = part.index !== undefined;
            const label = SPLICE_LABELS.find(item => item.partName === part.name);
            return <g key={part.name} data-part={part.name} data-family={part.family}
              data-cell-index={part.index} data-role={cell?.role} data-empty={isCell && !cell || undefined}
              className={styles.part} transform={part.family === 'cutter' ? cutterTransform(state.prefix) : undefined}>
              <AnatomySolid paths={part.paths} tone={cell?.role === 'delete' ? 'lo' : part.tone}
                name={part.name} lit={part.family === 'inserted' && Boolean(cell)} />
              {part.lines.map((line, index) => <AnatomyLine key={index} {...line} />)}
              {part.print && <g transform={part.print.transform} className={styles.glyph} clipPath={`url(#${id}-glyph-face)`}>
                {cell && <>
                  <title>{`${roleText[cell.role]}：${JSON.stringify(cell.char)}，序号 ${cell.index}`}</title>
                  <text x={part.print.width / 2} y="13.8" fontSize="13" textAnchor="middle"
                    textDecoration={part.family === 'source' && cell.role === 'delete' ? 'line-through' : undefined}>{cell.glyph}</text>
                </>}
              </g>}
              {label && <g transform={label.transform} className={styles.engraving}>
                <text x="0" y="6" fontSize="6" letterSpacing="0.5">{label.text}{part.name === 'plate.source' ? ` ${state.beforeLength}` : part.name === 'plate.output' ? state.valid ? ` ${state.output!.length}` : ' —' : ''}</text>
              </g>}
            </g>;
          })}
        </svg>
      </div>
      <div className={frame.corners}><span>· 空格 / ↵ 换行；窄屏可横向滚动</span><span>{state.valid ? `${state.beforeLength} → ${state.output!.length} UTF-16` : `${state.expectedBeforeLength} ≠ ${state.beforeLength}，拒绝应用`}</span></div>
    </div>
    <div className={frame.legend}><span>上轨 BEFORE：原文，划线部分计划切除</span><span>CUT：仅成功后显示被删片段</span><span>INSERT：替换文本</span><span>下轨 AFTER：拼接结果</span></div>

    <div className={styles.transcript}>
      <div><span>原文 / {state.beforeLength} UTF-16</span><code data-field="source">{visibleText(state.source)}</code></div>
      <div data-result={state.valid ? 'applied' : 'rejected'}><span>结果 / {state.output === null ? '未生成' : `${state.output.length} UTF-16`}</span>
        <code data-field="result">{state.output === null ? '拒绝应用，原文保持不变' : <>{visibleText(state.keptPrefix)}<mark>{state.inserted}</mark>{visibleText(state.keptSuffix)}</>}</code>
      </div>
    </div>
    <div className={styles.wire}><span>CodeChange / 外层定位 workpiece 与文件，edit 描述文本转换</span><code data-field="change">{state.wire}</code></div>
    <dl className={styles.lengths}>
      <div><dt>变更要求的 before length</dt><dd data-field="expected-length">{state.prefix} + 2 + 2 = {state.expectedBeforeLength}</dd></div>
      <div><dt>实际 before length</dt><dd data-field="actual-length">{state.beforeLength}</dd></div>
      <div><dt>变更描述的 after length</dt><dd data-field="planned-length">{state.prefix} + {state.inserted.length} + 2 = {state.plannedAfterLength}{!state.valid && <small>尚未应用</small>}</dd></div>
    </dl>
    <p className={`${frame.note} ${styles.status}`} role="status" aria-live="polite" aria-atomic="true" data-machine-status>{state.explanation}</p>
    <p className={frame.note}>这是拼接机制的教学比喻，不是执行时间线；原文、废料和结果分别展示同一片段的不同用途。这里只计算“保留 / 单行数字替换 / 保留”子集，不执行上游完整 OT、并发变换或完整校验。真实项目通过 CodeMirror ChangeSet 应用变更；长度相等也不代表内容或 revision 一定相同。</p>
    <p className={frame.note}><a href={`${CODE_CHANGE_SOURCE}#L55-L81`} target="_blank" rel="noopener noreferrer">TextChange 结构</a> · <a href={`${CODE_CHANGE_SOURCE}#L196-L200`} target="_blank" rel="noopener noreferrer">上游文本应用</a> · <a href={`${CODE_CHANGE_SOURCE}#L246-L267`} target="_blank" rel="noopener noreferrer">applyCodeChange</a></p>
    <noscript><p className={frame.note}>静态示例：保留 14 个单元，将 10 替换为 25，保留分号和换行，结果为 const limit = 25;。启用 JavaScript 后可调整数字、切换原文并观察长度不匹配的拒绝。</p></noscript>
  </section>;
}
