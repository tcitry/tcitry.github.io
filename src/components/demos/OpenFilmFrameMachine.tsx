import {Fragment, useEffect, useId, useRef, useState} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {AnatomySolid, AnatomyLine} from './AnatomyArt';
import {WIDTH, HEIGHT, PARTS, PICTURE_LAYERS, SHADOW} from './openfilm-frame-geometry';
import {FILM_DURATION, OPENFILM_REVISION, REFERENCE_TIME, TOUR_TIMES, frameAt, type FilmFrame} from './openfilm-frame-model';
import demoSurface from './DemoSurface.module.css';
import frameStyles from './AnatomyFrame.module.css';
import styles from './OpenFilmFrameMachine.module.css';

const SOURCE = `https://github.com/openfilm/openfilm/blob/${OPENFILM_REVISION}/packages/openfilm/`;
const fmt = (t: number) => t.toFixed(1);

/** These are teaching HTML-page pictures, sampled from one shared time model. */
function BackgroundPicture({frame}: {frame: FilmFrame}) {
  return <g data-page-picture="background" visibility={frame.background.active ? 'visible' : 'hidden'}>
    <rect width="320" height="180" fill="#162d36" />
    <circle data-sun cx={frame.sunX} cy="52" r="22" fill="#eab966" />
    <path d="M0 106L58 64L126 123L199 76L271 121L320 90V180H0Z" fill="#3c7477" />
    <path d="M0 135L88 107L168 145L239 115L320 142V180H0Z" fill="#255056" />
    <path d="M0 164Q100 137 320 159V180H0Z" fill="#1b3d46" />
    <rect x="22" y="22" width="28" height="3" rx="1.5" fill="#a8d5cd" />
  </g>;
}
function TitlePicture({frame}: {frame: FilmFrame}) {
  return <g data-page-picture="title" visibility={frame.title.active ? 'visible' : 'hidden'}>
    <g data-title-content transform={`translate(0 ${frame.titleY})`}>
      <rect x="19" y="-23" width="205" height="58" rx="3" fill="#0b1e28" fillOpacity="0.82" />
      <text x="30" y="-6" fontSize="10" letterSpacing="2" fill="#eab966">A FRAME IN TIME</text>
      <text x="29" y="18" fontSize="20" fontWeight="600" fill="#fff4de">此刻，由代码绘制</text>
    </g>
  </g>;
}
const physicalParts = PARTS.map(part => <g key={part.name} opacity={part.opacity ?? 1}>
  <AnatomySolid name={part.name} paths={part.paths} tone={part.tone} />
  {part.line && <AnatomyLine d={part.line} />}
</g>);

export default function OpenFilmFrameMachine({id = 'frame-time-machine'}: {id?: string}) {
  const uid = useId();
  const root = useRef<HTMLElement>(null);
  const [time, setTime] = useState(REFERENCE_TIME);
  const [ready, setReady] = useState(false);
  const [tour, setTour] = useState(false);
  const [touched, setTouched] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [foreground, setForeground] = useState(true);
  const frame = frameAt(time);
  useEffect(() => {
    setReady(true);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const preference = () => {setReduced(media.matches); if (media.matches) setTour(false);};
    preference(); media.addEventListener('change', preference);
    const visibility = () => {setForeground(!document.hidden);};
    visibility(); document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)));
    if (root.current) observer.observe(root.current);
    return () => {observer.disconnect(); media.removeEventListener('change', preference); document.removeEventListener('visibilitychange', visibility);};
  }, []);
  // An idle tour requests distinct frames, like seeking. No invented interpolation or per-frame React render.
  useEffect(() => {
    if (!ready || !visible || !foreground || reduced || touched || tour) return;
    const timer = setTimeout(() => setTour(true), 9000);
    return () => clearTimeout(timer);
  }, [ready, visible, foreground, reduced, touched, tour]);
  useEffect(() => {
    if (!tour || !visible || !foreground || reduced) return;
    let index = 0;
    const timer = setInterval(() => {setTime(TOUR_TIMES[index % TOUR_TIMES.length]!); index++;}, 2200);
    return () => clearInterval(timer);
  }, [tour, visible, foreground, reduced]);
  const stop = () => {setTouched(true); setTour(false);};
  const seek = (t: number) => {stop(); setTime(t);};
  const call = (active: boolean, t: number | null) => active ? `frame(${fmt(t!)})` : '不在时段内 · 隐藏';

  return <section ref={root} id={id} className={`${demoSurface.surface} ${frameStyles.surface} ${styles.root}`} data-book-island data-demo="openfilm-frame-machine" data-hydrated={ready} data-current-time={time} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <span className={styles.figureNumber}>ANATOMY · FIG. 01</span>
      <h3 id={`${uid}-title`}>一份时间轴，两个网页，一帧画面</h3>
      <p><code>film.html</code> 安排何时出现、谁在上层；各 HTML 页面决定此刻画什么。</p>
    </header>

    <div className={styles.schedule} onPointerDown={event => {if (!(event.target as Element).closest('[data-action="tour"]')) stop();}} onFocusCapture={event => {if (!(event.target as Element).closest('[data-action="tour"]')) stop();}}>
      <div className={styles.sectionLabel}><strong>① film.html · 安排图层和时段</strong><span>前面的 Track 在上层</span></div>
      <div className={styles.tracks}>
        <div className={styles.trackName}><i className={styles.titleKey} />title.html<small>上层 · 源时间 1–4 s</small></div>
        <div className={styles.track}><span className={styles.titleClip} style={{left: '33.3333%', width: '50%'}}>影片 2–5 s</span><b className={styles.playhead} style={{left: `${time / FILM_DURATION * 100}%`}} /></div>
        <div className={styles.trackName}><i className={styles.backgroundKey} />background.html<small>下层 · 源时间 0–6 s</small></div>
        <div className={styles.track}><span className={styles.backgroundClip}>影片 0–6 s</span><b className={styles.playhead} style={{left: `${time / FILM_DURATION * 100}%`}} /></div>
        <span /><div className={styles.ruler}><span>0 s</span><span>2 s</span><span>4 s</span><span>6 s</span></div>
      </div>
      <div className={styles.control}>
        <Slider minValue={0} maxValue={6} step={0.1} value={time} onChange={value => seek(Array.isArray(value) ? value[0]! : value)} isDisabled={!ready} formatOptions={{minimumFractionDigits: 1, maximumFractionDigits: 1}}>
          <Label>影片时间 T（秒）</Label><Slider.Output /><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
        </Slider>
      </div>
      <div className={styles.presets}>
        {[{t: 1, label: '1 s · 标题未出场'}, {t: 3, label: '3 s · 两层合成'}, {t: 5, label: '5 s · 标题已结束'}].map(item => <Button key={item.t} size="sm" variant={time === item.t ? 'secondary' : 'outline'} onPress={() => seek(item.t)} isDisabled={!ready}>{item.label}</Button>)}
        {!reduced && <Button data-action="tour" size="sm" variant="ghost" onPress={() => {setTouched(true); setTour(value => !value);}} isDisabled={!ready}>{tour ? '暂停演示' : '自动演示'}</Button>}
      </div>
    </div>

    <div className={styles.drawing}>
      <div className={styles.layers}>
        <div className={styles.sectionLabel}><strong>② 各页面绘制自己的当前画面</strong></div>
        <p className={styles.pageContract}>场景页保存画面和 <code>frame(t)</code>。加载后按 t 重绘，无需先播放此前各帧。</p>
        <svg className={styles.machine} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`${uid}-machine-title ${uid}-machine-desc`}>
          <title id={`${uid}-machine-title`}>分层动画摄影台，展示两个 HTML 页面的画面</title>
          <desc id={`${uid}-machine-desc`}>上层标题页{call(frame.title.active, frame.title.sourceTime)}，下层背景页{call(frame.background.active, frame.background.sourceTime)}。实体框架仅表示页面图层；实际由浏览器合成，没有摄影透视。</desc>
          <defs><pattern id={`${uid}-grid`} width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#d6ddd9" /><path d="M0 0H10V10H0ZM10 10H20V20H10Z" fill="#eef1ec" /></pattern></defs>
          <path className={styles.shadow} d={SHADOW} />
          {PARTS.map((part, index) => <Fragment key={part.name}>
            {physicalParts[index]}
            {part.name === PICTURE_LAYERS.background.partName && <g transform={PICTURE_LAYERS.background.pictureTransform}><rect width="320" height="180" fill="#162d36" fillOpacity="0.1" /><BackgroundPicture frame={frame} /><rect width="320" height="180" fill="none" stroke="#4b9191" strokeWidth="3" /></g>}
            {part.name === PICTURE_LAYERS.title.partName && <g transform={PICTURE_LAYERS.title.pictureTransform}><rect width="320" height="180" fill={`url(#${uid}-grid)`} fillOpacity="0.35" /><TitlePicture frame={frame} /><rect width="320" height="180" fill="none" stroke="#b27830" strokeWidth="3" /></g>}
          </Fragment>)}
        </svg>
        <div className={styles.layerCalls}>
          <p data-layer="title"><i className={styles.titleKey} /><strong>title.html</strong><code>{call(frame.title.active, frame.title.sourceTime)}</code></p>
          <p data-layer="background"><i className={styles.backgroundKey} /><strong>background.html</strong><code>{call(frame.background.active, frame.background.sourceTime)}</code></p>
        </div>
      </div>
      <div className={styles.output}>
        <div className={styles.sectionLabel}><strong>③ 浏览器按层级叠合</strong></div>
        <div className={styles.monitor}>
          <div className={styles.monitorTop}><span>影片当前帧</span><strong>T = {fmt(time)} s</strong></div>
          <svg viewBox="0 0 320 180" className={styles.picture} role="img" aria-label={`第 ${fmt(time)} 秒合成画面：${frame.background.active ? '山峦背景' : '影片结束'}${frame.title.active ? '，上方叠有标题' : '，无标题'}`} data-composite-frame>
            <rect width="320" height="180" fill="#162d36" />
            <BackgroundPicture frame={frame} /><TitlePicture frame={frame} />
          </svg>
        </div>
        <p className={styles.outputCaption}>{frame.title.active ? '标题页的空白部分透明，所以能看见下面的背景。' : frame.background.active ? '标题层被隐藏，背景仍然在当前帧中。' : '已到影片结束边界。'}</p>
        <p className={styles.mapping}>装置中的上下间距用来展开图层；合成帧保留原来的位置和尺寸。</p>
      </div>
    </div>

    <div className={styles.explain}>
      <p className={styles.formulaTitle}><strong>为什么两个网页收到不同的时间？</strong></p>
      <p className={styles.formula}><span>页面时间 t</span> = 源起点 in +（影片时间 T − 影片开始时间 at）</p>
      <p className={styles.example} data-time-equation>{frame.title.active ? <>标题页：<code>1 + ({fmt(time)} − 2) = {fmt(frame.title.sourceTime!)}</code> 秒。背景页从影片开头开始，因此直接收到 <code>{fmt(frame.background.sourceTime!)}</code> 秒。</> : <>标题只在影片的 <code>[2, 5)</code> 秒内绘制；{time < 2 ? '目前还没到标题的开始时间。' : '目前已离开这段时长。'}</>}</p>
      <p className={styles.status} role="status" aria-live={tour ? 'off' : 'polite'}>{frame.explanation}</p>
    </div>
    <details className={styles.source}>
      <summary>源码中的模块职责（核对用）</summary>
      <p><a href={`${SOURCE}src/film-doc.mjs#L334-L393`}>film-doc.mjs</a> 解析 Clip 和时间区间；<a href={`${SOURCE}src/timeline.mjs#L584-L640`}>timeline.mjs</a> 判断可见性、换算时间并调用各页 <code>frame(t)</code>；<a href={`${SOURCE}src/timeline.mjs#L95-L105`}>Track 层级</a> 控制浏览器中的覆盖顺序。</p>
    </details>
    <p className={styles.boundary}>教学示例：按固定源码的两层 HTML 时间规则计算，画面是示例页面的绘制结果示意；没有执行 OpenFilm 或导出视频。摄影台表示浏览器图层，棋盘格表示透明区域。各页面必须按传入的时间绘制完整画面，倒回同一时刻才会得到同一帧。</p>
  </section>;
}
