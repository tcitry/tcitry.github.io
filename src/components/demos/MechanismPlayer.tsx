import {useEffect, useId, useRef, useState, type ReactNode} from 'react';
import {Button} from '@heroui/react';
import styles from './MechanismPlayer.module.css';

export const motionRange = (p: number, from: number, to: number) => Math.max(0, Math.min(1, (p - from) / (to - from)));
export const motionEase = (t: number) => {const p = Math.max(0, Math.min(1, t));return p * p * (3 - 2 * p);};
export const motionMix = (a: number, b: number, t: number) => a + (b - a) * t;
export interface MechanismPhase {at: number; label: string}
export interface MechanismFrame {reducedMotion: boolean}
interface Props {
  label: string;
  duration?: number;
  resetKey?: string | number;
  phases: MechanismPhase[];
  onFrame: (stage: HTMLDivElement, progress: number, meta: MechanismFrame) => void;
  onCycle?: () => boolean | void;
  onUserControl?: () => void;
  loop?: boolean;
  children: ReactNode;
}

/** One time-based loop moves SVG refs; React renders only user controls and phase changes. */
export function MechanismPlayer({label, duration = 14, resetKey, phases, onFrame, onCycle, onUserControl, loop = true, children}: Props) {
  const id = useId();
  const stage = useRef<HTMLDivElement>(null);
  const scrub = useRef<HTMLInputElement>(null);
  const caption = useRef<HTMLParagraphElement>(null);
  const position = useRef<HTMLOutputElement>(null);
  const callbacks = useRef({onFrame, phases, duration, onCycle, onUserControl, loop});
  callbacks.current = {onFrame, phases, duration, onCycle, onUserControl, loop};
  const controller = useRef({p: 0, speed: 1, wanted: true, visible: false, hidden: false, reduced: false,
    focus: false, intent: 'auto' as 'auto' | 'manual', frame: 0, last: 0, hold: 0,
    idleUntil: 0, phase: -1, expectCycleReset: false, fadeIn: 0});
  const wake = useRef<() => void>(() => {});
  const draw = useRef<() => void>(() => {});
  const previousKey = useRef(resetKey);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [reduced, setReduced] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const element = stage.current!;
    const c = controller.current;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    const render = () => {
      const props = callbacks.current;
      const current = c.p;
      props.onFrame(element, current, {reducedMotion: c.reduced});
      element.dataset.progress = current.toFixed(4);
      element.dataset.playing = String(c.wanted && c.visible && !c.hidden && !c.reduced && (c.intent === 'manual' || !c.focus));
      element.dataset.motion = c.reduced ? 'reduced' : 'full';
      element.style.opacity = String(c.reduced || !c.wanted ? 1 : c.fadeIn > 0 ? 1 - c.fadeIn / .18 : c.hold > 2 ? Math.max(0, (2.2-c.hold)/.2) : 1);
      const index = Math.max(0, props.phases.findLastIndex(phase => phase.at <= current));
      if (caption.current && (c.phase !== index || caption.current.textContent !== (props.phases[index]?.label ?? ''))) {caption.current.textContent = props.phases[index]?.label ?? '';c.phase = index;}
      if (scrub.current && document.activeElement !== scrub.current) scrub.current.value = String(Math.round(current * 1000));
      if (position.current) position.current.textContent = `${Math.round(current * 100)}%`;
    };
    draw.current = render;
    const tick = (now: number) => {
      c.frame = 0;
      if (disposed || !c.visible || c.hidden || !c.wanted || c.reduced || (c.intent === 'auto' && c.focus)) {render();return;}
      const dt = c.last ? Math.min((now - c.last) / 1000, 1 / 30) : 0;
      c.last = now;
      if (now >= c.idleUntil) {
        c.fadeIn = Math.max(0, c.fadeIn-dt);
        if (c.p < 1) c.p = Math.min(1, c.p + dt * c.speed / callbacks.current.duration);
        else {
          if (c.intent === 'manual' || !callbacks.current.loop) {
            c.wanted = false;c.hold = 0;setPlaying(false);render();return;
          }
          c.hold += dt;
          if (c.hold >= 2.2) {
            c.hold = 0;c.p = 0;c.phase = -1;c.fadeIn = .18;
            c.expectCycleReset = callbacks.current.onCycle?.() === true;
          }
        }
        render();
      }
      c.frame = requestAnimationFrame(tick);
    };
    const run = () => {
      if (disposed) return;
      render();
      if (!c.frame && c.visible && !c.hidden && c.wanted && !c.reduced && (c.intent === 'manual' || !c.focus)) {
        c.last = 0;c.frame = requestAnimationFrame(tick);
      }
    };
    wake.current = run;
    const still = () => {
      c.reduced = preference.matches;setReduced(c.reduced);setPlaying(c.reduced ? false : c.wanted);
      if (c.frame) cancelAnimationFrame(c.frame);c.frame = 0;
      c.p = c.reduced ? 1 : 0;c.phase = -1;c.idleUntil = performance.now() + 900;run();
    };
    const visibility = () => {c.hidden = document.hidden;c.last = 0;run();};
    c.hidden = document.hidden;
    const observer = new IntersectionObserver(entries => {
      c.visible = entries[entries.length - 1]?.isIntersecting ?? false;c.last = 0;
      if (!c.visible && c.frame) {cancelAnimationFrame(c.frame);c.frame = 0;}
      run();
    }, {threshold: .08});
    observer.observe(element);
    preference.addEventListener('change', still);
    document.addEventListener('visibilitychange', visibility);
    still();setHydrated(true);
    return () => {disposed = true;observer.disconnect();preference.removeEventListener('change', still);document.removeEventListener('visibilitychange', visibility);if(c.frame)cancelAnimationFrame(c.frame);c.frame=0;};
  }, []);

  useEffect(() => {
    if (previousKey.current === resetKey) {draw.current();return;}
    previousKey.current = resetKey;
    const c = controller.current;
    c.p = c.reduced ? 1 : 0;c.hold = 0;c.fadeIn = 0;c.phase = -1;c.wanted = true;
    if (!c.expectCycleReset) c.intent = 'manual';
    c.expectCycleReset = false;c.idleUntil = 0;c.last = 0;setPlaying(true);wake.current();
  }, [resetKey]);

  function manual() {controller.current.intent = 'manual';callbacks.current.onUserControl?.();}
  function toggle() {const c=controller.current;const inspected=c.intent==='auto'&&c.focus;manual();c.wanted=inspected?true:!c.wanted;c.last=0;c.idleUntil=0;setPlaying(c.wanted);wake.current();}
  function seek(p: number) {manual();const c=controller.current;c.p=Math.max(0,Math.min(1,p));c.hold=0;c.fadeIn=0;c.phase=-1;c.wanted=false;setPlaying(false);draw.current();}
  function restart() {manual();const c=controller.current;c.p=c.reduced?1:0;c.hold=0;c.fadeIn=0;c.phase=-1;c.wanted=true;c.last=0;c.idleUntil=0;setPlaying(!c.reduced);wake.current();}

  return <div className={styles.player} data-mechanism-player data-hydrated={hydrated}>
    <div ref={stage} className={styles.stage} data-mechanism-stage data-progress="0" data-playing="false" data-motion="full"
      role="group" tabIndex={0} aria-label={`${label}。空格播放或暂停，左右键逐段查看，Home 和 End 到起点或终点。`}
      onFocusCapture={() => {const c=controller.current;c.focus=true;if(c.intent==='auto')setPlaying(false);wake.current();}}
      onBlurCapture={event => {if(!event.currentTarget.contains(event.relatedTarget as Node)){const c=controller.current;c.focus=false;if(c.intent==='auto')setPlaying(c.wanted);wake.current();}}}
      onKeyDown={event => {
        if(event.target!==event.currentTarget)return;
        if(event.key===' '||event.key==='Enter'){event.preventDefault();toggle();}
        else if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();seek(controller.current.p+(event.key==='ArrowRight'?.04:-.04));}
        else if(event.key==='Home'||event.key==='End'){event.preventDefault();seek(event.key==='Home'?0:1);}
      }}>{children}</div>
    <div className={styles.controls} aria-label={`${label}的动画控制`}>
      <Button size="sm" variant="secondary" isDisabled={!hydrated || reduced} onPress={toggle} data-motion-toggle>{reduced?'静态分镜':playing?'暂停':'播放'}</Button>
      <Button size="sm" variant="outline" isDisabled={!hydrated} onPress={restart} data-motion-restart>重播</Button>
      <label className={styles.speed}>速度 <select value={speed} disabled={!hydrated || reduced} onChange={event=>{manual();const next=Number(event.target.value);controller.current.speed=next;setSpeed(next);wake.current();}}>
        <option value={.25}>0.25×</option><option value={.5}>0.5×</option><option value={1}>1×</option>
      </select></label>
      <label className={styles.scrub} htmlFor={`${id}-progress`}><span>进度</span><input ref={scrub} id={`${id}-progress`} data-motion-seek type="range" min="0" max="1000" step="1" defaultValue="0" disabled={!hydrated} aria-label={`${label}的动画进度`} onInput={event=>seek(Number(event.currentTarget.value)/1000)} /></label>
      <output ref={position} className={styles.position}>0%</output>
    </div>
    <p ref={caption} className={styles.caption} aria-live="polite" data-motion-caption>{phases[0]?.label}</p>
    <p className={styles.hint}>{reduced?'系统已减少动画：显示完整结果，可拖动进度逐段查看。':'教学慢放 · 空闲时自动演示；播放后可暂停、慢放或拖动进度。运动时间不代表真实执行耗时。'}</p>
  </div>;
}
