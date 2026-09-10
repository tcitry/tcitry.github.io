/**
 * F5 Tick Rows teaching adaptation of Lieflat Charts by 躺在废墟里.
 * Upstream commit: eace082a317b696c5570c25826a53a7fa113e984.
 * Template-derived code retains PolyForm Noncommercial License 1.0.0:
 * https://polyformproject.org/licenses/noncommercial/1.0.0/
 */
import {Fragment, useEffect, useId, useMemo, useRef, useState} from 'react';
import {Button} from '@heroui/react';
import {LieflatSlider} from './LieflatExampleFrame';
import {buildTickRows, createTickAnimation, DEFAULT_TICK_DATA, MAX_TICK_COUNT, parseTickCount} from './lieflat-tick-rows';
import '../../styles/demos.css';
import surface from './DemoSurface.module.css';
import styles from './LieflatTickRows.module.css';

export interface LieflatTickRowsProps {className?: string; id?: string}

const source = 'https://github.com/larashero3-dotcom/lieflat-charts/blob/eace082a317b696c5570c25826a53a7fa113e984/templates/basics-gallery.html';

export default function LieflatTickRows({className = '', id: rootId}: LieflatTickRowsProps) {
  const id = useId();
  const [values, setValues] = useState<number[]>(() => DEFAULT_TICK_DATA.map(({value}) => value));
  const [drafts, setDrafts] = useState<string[]>(() => DEFAULT_TICK_DATA.map(({value}) => String(value)));
  const [hydrated, setHydrated] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const animator = useRef<ReturnType<typeof createTickAnimation> | null>(null);
  const chart = useMemo(() => buildTickRows(DEFAULT_TICK_DATA.map((row, index) => ({name: row.name, value: values[index]}))), [values]);
  const hasInvalid = drafts.some(value => parseTickCount(value) === null);

  useEffect(() => {
    setHydrated(true);
    if (!svgRef.current) return;
    const animation = createTickAnimation(svgRef.current);
    animator.current = animation;
    return () => {animation.destroy(); animator.current = null;};
  }, []);
  useEffect(() => {animator.current?.refresh();}, [values]);

  const update = (index: number, draft: string) => {
    setDrafts(previous => previous.map((value, i) => i === index ? draft : value));
    const parsed = parseTickCount(draft);
    if (parsed !== null) setValues(previous => previous.map((value, i) => i === index ? parsed : value));
  };
  const reset = () => {
    setDrafts(DEFAULT_TICK_DATA.map(({value}) => String(value)));
    setValues(DEFAULT_TICK_DATA.map(({value}) => value));
  };

  return (
    <section id={rootId ?? `${id}-root`} className={`${surface.surface} ${styles.surface} ${className}`} data-book-island data-demo="lieflat-tick-rows" data-hydrated={hydrated} aria-label="Lieflat Charts 刻度计数交互示例">
      <div className={styles.editorHeading}>
        <p className={styles.intro}>改一个数量，看看刻度与结论怎样变化。</p>
        <div className={styles.actions}>
          <Button size="sm" variant="outline" className={styles.button} onPress={reset} isDisabled={!hydrated}>重置</Button>
          <Button size="sm" variant="outline" className={styles.button} onPress={() => animator.current?.replay()} isDisabled={!hydrated || chart.total === 0} aria-controls={`${id}-chart`}>重播动画</Button>
        </div>
      </div>
      <div className={styles.fields}>
        {DEFAULT_TICK_DATA.map((row, index) => {
          const invalid = parseTickCount(drafts[index]) === null;
          return (
            <LieflatSlider key={row.name} label={row.name} value={drafts[index]} onChange={draft => update(index, draft)} min={0} max={MAX_TICK_COUNT} step={1} disabled={!hydrated} invalid={invalid} />
          );
        })}
      </div>
      <p id={`${id}-limits`} className={styles.limits} role={hasInvalid ? 'alert' : undefined}>
        {hasInvalid ? `请输入 0–${MAX_TICK_COUNT} 的整数；无效输入暂不更新图表。` : `每项 0–${MAX_TICK_COUNT} 的整数 · 数据仅在本页修改`}
      </p>

      <figure className={styles.figure} aria-labelledby={`${id}-heading`} aria-describedby={`${id}-legend ${id}-source`}>
        <h2 id={`${id}-heading`} className={styles.title} data-chart-heading>{chart.heading}</h2>
        <p className={styles.summary} role="status" aria-live="polite" aria-atomic="true" data-chart-summary>{chart.note}</p>
        <p id={`${id}-legend`} className={styles.legend}>一条刻度 = 一项 · 圆点标出每 5 项<br />共 <span data-chart-total>{chart.total}</span> 项 · 水平尺度随最大值调整</p>
        <svg ref={svgRef} id={`${id}-chart`} className={styles.chart} viewBox="0 0 344 210" role="img" aria-labelledby={`${id}-svg-title ${id}-svg-description`} preserveAspectRatio="xMidYMid meet">
          <title id={`${id}-svg-title`}>{chart.heading}</title>
          <desc id={`${id}-svg-description`}>{chart.rows.map(row => `${row.name} ${row.value} 项`).join('、')}，共 {chart.total} 项。每条刻度代表一项；刻度高度与深浅的细微变化仅为纹理，不编码额外数值。</desc>
          {chart.rows.map(row => (
            <g key={row.name} data-chart-row data-name={row.name} data-value={row.value}>
              <text x="78" y={row.y + 4} fontSize="18" fontWeight="600" fill="#4A4944" textAnchor="end">{row.name}</text>
              <line data-baseline x1={chart.x0} y1={row.y + 9} x2={chart.baselineEnd} y2={row.y + 9} stroke="#DEDDD6" strokeWidth="0.6" />
              {row.ticks.map((tick, index) => (
                <Fragment key={index}>
                  <line data-tick data-reveal data-delay={tick.delay} data-opacity={tick.opacity} x1={tick.x} y1={row.y + 9} x2={tick.x} y2={row.y + 9 - tick.height} stroke="#1C1C1A" strokeWidth="0.9" opacity={tick.opacity} />
                  {tick.fifth && <circle data-fifth data-reveal data-delay={tick.delay} data-opacity="1" cx={tick.x} cy={row.y + 13} r="0.8" fill="#6A6963" />}
                </Fragment>
              ))}
              <text data-row-value x={row.valueX} y={row.y + 4} fontSize="20" fontWeight="800" fill="#1C1C1A">{row.value}<title>{`${row.name}：${row.value} 项`}</title></text>
            </g>
          ))}
        </svg>
        <figcaption id={`${id}-source`} className={styles.source}>
          <p>教学构造数据，不代表实际工作记录；刻度的高度与深浅仅为纹理。</p>
          <p>模板：躺在废墟里 / <a href={source} target="_blank" rel="noreferrer">Lieflat Charts F5</a>。衍生代码沿用 <a href="https://polyformproject.org/licenses/noncommercial/1.0.0/" target="_blank" rel="noreferrer">PolyForm Noncommercial 1.0.0</a>。</p>
        </figcaption>
      </figure>
    </section>
  );
}
