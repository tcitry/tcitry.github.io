import {useEffect, useId, useRef, useState, type ReactNode} from 'react';
import {Button} from '@heroui/react';
import {CellSlider} from '@heroui-pro/react';
import {createTickAnimation} from './lieflat-tick-rows';
import '../../styles/demos.css';
import surface from './DemoSurface.module.css';
import styles from './LieflatExampleFrame.module.css';

export interface LieflatField {
  label: string; value: string; onChange: (value: string) => void;
  min: number; max: number; step?: number; invalid?: boolean;
}

export function LieflatSlider({label, value, onChange, min, max, step = 1, disabled = false}: LieflatField & {disabled?: boolean}) {
  return <div className={styles.field}>
    <CellSlider aria-label={label} minValue={min} maxValue={max === min ? min + step : max} step={step} value={Number(value)} isDisabled={disabled || min === max}
      formatOptions={{maximumFractionDigits: 2}} onChange={next => onChange(String(Array.isArray(next) ? next[0] : next))}>
      <CellSlider.Track className={styles.track}>
        <CellSlider.Fill /><CellSlider.Thumb />
        <CellSlider.Label className={styles.label}>{label}</CellSlider.Label>
        <CellSlider.Output className={styles.output} />
      </CellSlider.Track>
    </CellSlider>
    <span className={styles.range}>{min}–{max} · 每次 {step}</span>
  </div>;
}

interface Props {
  typeId: string; title: string; description: string; legend: string;
  prompt: string; source: string; summary: string;
  fields: LieflatField[]; presets: {label: string; onPress: () => void}[];
  onReset: () => void; children: ReactNode;
}

export default function LieflatExampleFrame({typeId, title, description, legend, prompt, source, fields, presets, onReset, children, summary}: Props) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const animator = useRef<ReturnType<typeof createTickAnimation> | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState('');
  useEffect(() => {setHydrated(true);}, []);
  useEffect(() => {
    const svg = root.current?.querySelector('svg');
    if (!svg) return;
    const animation = createTickAnimation(svg);
    animator.current = animation;
    return () => {animation.destroy(); animator.current = null;};
  }, []);
  const values = fields.map(field => field.value).join('|');
  useEffect(() => {animator.current?.refresh();}, [values]);
  return <section ref={root} className={`${surface.surface} ${styles.frame}`} data-book-island data-demo={`lieflat-${typeId.toLowerCase()}`} data-hydrated={hydrated} aria-labelledby={`${id}-title`}>
    <p className={styles.eyebrow}>{typeId} · 可调数据示例</p>
    <h3 id={`${id}-title`} className={styles.title}>{title}</h3>
    <p className={styles.description}>{description}</p>
    <div className={styles.fields}>{fields.map(field => <LieflatSlider key={field.label} {...field} disabled={!hydrated} />)}</div>
    <div className={styles.actions}>
      {presets.map(preset => <Button key={preset.label} variant="outline" size="sm" onPress={preset.onPress} isDisabled={!hydrated}>{preset.label}</Button>)}
      <Button variant="outline" size="sm" onPress={onReset} isDisabled={!hydrated}>重置</Button>
      <Button variant="outline" size="sm" onPress={() => animator.current?.replay()} isDisabled={!hydrated}>重播动画</Button>
    </div>
    <p className={styles.summary} role="status" aria-live="polite" aria-atomic="true" data-example-summary>{summary}</p>
    <p className={styles.legend}>{legend}</p>
    <div className={styles.visual}>{children}</div>
    <details className={styles.prompt}>
      <summary>查看这张图的 Prompt</summary>
      <pre>{prompt}</pre>
      <Button size="sm" variant="outline" isDisabled={!hydrated} onPress={async () => {
        try {await navigator.clipboard.writeText(prompt); setCopied('已复制');}
        catch {setCopied('请选中上方文字复制');}
      }}>复制 Prompt</Button><span role="status">{copied}</span>
    </details>
    <p className={styles.source}>教学构造数据 · <a href={source}>躺在废墟里 / Lieflat Charts {typeId} 原模板</a> · <a href="https://polyformproject.org/licenses/noncommercial/1.0.0/">PolyForm Noncommercial 1.0.0</a></p>
  </section>;
}
