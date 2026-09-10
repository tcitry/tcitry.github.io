/**
 * F5 Tick Rows geometry and deterministic texture adapted from Lieflat Charts
 * by 躺在废墟里, commit eace082a317b696c5570c25826a53a7fa113e984.
 * https://github.com/larashero3-dotcom/lieflat-charts/blob/eace082a317b696c5570c25826a53a7fa113e984/templates/basics-gallery.html
 * PolyForm Noncommercial License 1.0.0:
 * https://polyformproject.org/licenses/noncommercial/1.0.0/
 */
export const MAX_TICK_COUNT = 40;
export const DEFAULT_TICK_DATA = [
  {name: '内容校对', value: 18},
  {name: '链接修复', value: 12},
  {name: '图片说明', value: 6},
  {name: '目录整理', value: 4},
] as const;

export function parseTickCount(input: string): number | null {
  if (!/^\d+$/.test(input)) return null;
  const value = Number(input);
  return Number.isInteger(value) && value >= 0 && value <= MAX_TICK_COUNT ? value : null;
}

export function buildTickRows(data: ReadonlyArray<{name: string; value: number}>) {
  if (!data.length || data.some(({value}) => !Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > MAX_TICK_COUNT)) {
    throw new Error(`Tick Rows requires integer counts from 0 to ${MAX_TICK_COUNT}.`);
  }
  const total = data.reduce((sum, {value}) => sum + value, 0);
  const maxValue = Math.max(...data.map(({value}) => value));
  const leaders = total === 0 ? [] : data.filter(({value}) => value === maxValue);
  const share = total === 0 ? 0 : Math.round(maxValue / total * 1000) / 10;
  const x0 = 88;
  const step = 214.8 / Math.max(maxValue, 1);
  const rnd = (i: number, k: number) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;
  return {
    total, maxValue, leaders, share, x0, step,
    baselineEnd: x0 + maxValue * step,
    heading: total === 0 ? '数量都是 0，暂无刻度' : leaders.length > 1 ? `${leaders.length} 类并列第一` : `${leaders[0].name}占 ${share}%`,
    note: total === 0 ? '输入一个大于 0 的数量，即可看到刻度。' : leaders.length > 1 ? `${leaders.map(({name}) => name).join('、')}，各占 ${share}%。` : `共 ${total} 项，${leaders[0].name}有 ${maxValue} 项。`,
    rows: data.map((row, i) => ({
      ...row,
      y: 25 + i * 52,
      valueX: x0 + row.value * step + 10,
      ticks: Array.from({length: row.value}, (_, k) => ({
        x: x0 + k * step + step / 2,
        height: 9 + rnd(k + 1, i + 2) * 6,
        opacity: 0.55 + rnd(k + 3, i + 5) * 0.45,
        delay: i * 80 + k * 12,
        fifth: k % 5 === 4,
      })),
    })),
  };
}

/** Progressive enhancement: server-rendered marks remain readable without JS. */
export function createTickAnimation(svg: SVGSVGElement) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let animations: Animation[] = [];
  let revealed = false;
  let destroyed = false;
  const cancel = () => {
    animations.forEach(animation => animation.cancel());
    animations = [];
  };
  const replay = () => {
    if (destroyed) return;
    revealed = true;
    cancel();
    if (motion.matches) return;
    animations = Array.from(svg.querySelectorAll<SVGElement>('[data-reveal]'), mark => {
      const opacity = Number(mark.dataset.opacity ?? 1);
      let frames: Keyframe[] = [{opacity: 0}, {opacity}];
      if (mark.dataset.motion === 'draw') {
        mark.style.strokeDasharray = '1';
        frames = [{strokeDashoffset: 1, opacity: 0}, {strokeDashoffset: 0, opacity}];
      } else if (mark.dataset.motion === 'pop') {
        mark.style.transformBox = 'fill-box';
        mark.style.transformOrigin = 'center';
        frames = [{transform: 'scale(0)', opacity: 0}, {transform: 'scale(1)', opacity}];
      }
      return mark.animate(frames, {
        duration: Number(mark.dataset.duration ?? 900),
        delay: Number(mark.dataset.delay ?? 0),
        easing: 'cubic-bezier(0.165, 0.84, 0.44, 1)',
        fill: 'backwards',
      });
    });
  };
  const onMotionChange = () => {if (motion.matches) cancel();};
  motion.addEventListener('change', onMotionChange);
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      replay();
      observer.disconnect();
    }
  }, {threshold: 0.3});
  observer.observe(svg);
  return {
    replay,
    refresh: () => {if (revealed) replay();},
    destroy: () => {
      destroyed = true;
      observer.disconnect();
      motion.removeEventListener('change', onMotionChange);
      cancel();
    },
  };
}
