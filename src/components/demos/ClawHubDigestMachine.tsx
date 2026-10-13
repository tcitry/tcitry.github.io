import {useEffect, useId, useMemo, useRef, useState, type SyntheticEvent} from 'react';
import {Button} from '@heroui/react';
import {trackDemoStart} from '../../lib/analytics';
import {AnatomyLine, AnatomySolid} from './AnatomyArt';
import {depthOf, translateAlong} from './anatomy-iso-kit';
import {
  DIGEST_PARTS, DIGEST_PROJECTION, DIGEST_WIDTH, DIGEST_HEIGHT, DIGEST_HALO, DIGEST_PART_COUNT,
  INDEX_PRINT, PUBLIC_PRINT, SKILL_PRINT, V1_PRINT, V2_PRINT, PLATE_PRINT, selectorOffset,
} from './clawhub-digest-geometry';
import {catalogState, INITIAL_CONDITIONS, SOURCE_ROOT, type CatalogConditions} from './clawhub-digest-model';
import demoSurface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './ClawHubDigestMachine.module.css';

const INITIAL = catalogState();
const SELECTOR_REST = translateAlong(DIGEST_PROJECTION, selectorOffset(INITIAL.selectorPosition));
const versionShort = (id: string) => id.split(':').at(-1) ?? id;
const TOUR_CONDITIONS: readonly CatalogConditions[] = [
  {...INITIAL_CONDITIONS},
  {...INITIAL_CONDITIONS, v2Review: 'public'},
  {...INITIAL_CONDITIONS},
  {...INITIAL_CONDITIONS, v1Withdrawn: true},
];
const isTourControl = (event: SyntheticEvent) => Boolean((event.target as Element).closest('[data-action="tour"]'));

/** The catalogue's tab depicts publicVersion, while every source volume stays present. */
export default function ClawHubDigestMachine() {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const partsHost = useRef<SVGGElement>(null);
  const target = useRef(INITIAL.selectorPosition);
  const wake = useRef<(() => void) | null>(null);
  const tourIndex = useRef(0);
  const [conditions, setConditions] = useState<CatalogConditions>(() => ({...INITIAL_CONDITIONS}));
  const state = useMemo(() => catalogState(conditions), [conditions]);
  const [hydrated, setHydrated] = useState(false);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  const [reduced, setReduced] = useState(true);
  const [tour, setTour] = useState(false);
  const publicShort = state.digest.publicVersion.status === 'available' ? versionShort(state.digest.publicVersion.versionId) : '不可展示';

  useEffect(() => {
    setHydrated(true);
    const host = root.current;
    const layer = partsHost.current;
    if (!host || !layer) return;
    const nodes = Array.from(layer.querySelectorAll<SVGGElement>(':scope > g[data-part]'));
    const selectors = nodes.filter(node => node.dataset.motion === 'selector');
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    let inView = false;
    let handle = 0;
    let last = 0;
    let x = INITIAL.selectorPosition;
    let order = nodes.map(node => node.dataset.part).join('|');
    const place = () => {
      selectors.forEach(node => node.setAttribute('transform', translateAlong(DIGEST_PROJECTION, selectorOffset(x))));
      const lift = depthOf(selectorOffset(x), DIGEST_PROJECTION);
      const ordered = nodes.slice().sort((a, b) => Number(a.dataset.depth) + (a.dataset.motion === 'selector' ? lift : 0)
        - Number(b.dataset.depth) - (b.dataset.motion === 'selector' ? lift : 0));
      const next = ordered.map(node => node.dataset.part).join('|');
      if (next !== order) {
        const fragment = document.createDocumentFragment();
        ordered.forEach(node => fragment.appendChild(node));layer.appendChild(fragment);order = next;
      }
    };
    const tick = (now: number) => {
      handle = 0;
      if (!inView || document.hidden) {last = 0;return;}
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;last = now;
      x = calm.matches ? target.current : x + (target.current - x) * (1 - Math.exp(-dt / 0.16));
      if (Math.abs(x - target.current) < 0.01) x = target.current;
      place();
      if (x !== target.current) handle = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (calm.matches) {x = target.current;place();return;}
      if (!handle && inView && !document.hidden) {last = 0;handle = requestAnimationFrame(tick);}
    };
    wake.current = kick;
    const observer = new IntersectionObserver(entries => {
      inView = entries.at(-1)?.isIntersecting ?? false;setVisible(inView);
      if (inView) kick();else if (handle) {cancelAnimationFrame(handle);handle = 0;last = 0;}
    });
    observer.observe(host);
    const onVisibility = () => {
      setForeground(!document.hidden);
      if (document.hidden && handle) {cancelAnimationFrame(handle);handle = 0;last = 0;}else kick();
    };
    const onPreference = () => {setReduced(calm.matches);if (calm.matches) setTour(false);kick();};
    onVisibility();onPreference();
    document.addEventListener('visibilitychange', onVisibility);calm.addEventListener('change', onPreference);
    return () => {
      observer.disconnect();if (handle) cancelAnimationFrame(handle);
      document.removeEventListener('visibilitychange', onVisibility);calm.removeEventListener('change', onPreference);wake.current = null;
    };
  }, []);
  useEffect(() => {target.current = state.selectorPosition;wake.current?.();}, [state.selectorPosition]);
  useEffect(() => {
    if (!tour || !visible || !foreground || reduced) return;
    const timer = setInterval(() => {
      tourIndex.current = (tourIndex.current + 1) % TOUR_CONDITIONS.length;
      setConditions({...TOUR_CONDITIONS[tourIndex.current]!});
    }, 3000);
    return () => clearInterval(timer);
  }, [tour, visible, foreground, reduced]);
  const stopTour = () => setTour(false);
  function change(update: Partial<CatalogConditions>, action: string) {
    stopTour();
    setConditions(current => ({...current, ...update}));trackDemoStart('clawhub-digest-machine', action);
  }
  function toggleTour() {
    if (tour) {stopTour();return;}
    if (!hydrated || reduced) return;
    tourIndex.current = 0;
    setConditions({...TOUR_CONDITIONS[0]!});
    setTour(true);
    trackDemoStart('clawhub-digest-machine', 'play-conditions');
  }

  return <section ref={root} id="clawhub-digest-machine" className={`${demoSurface.surface} ${frame.surface} ${styles.demo}`}
    data-demo="clawhub-digest-machine" data-book-island data-outcome={state.outcome} data-hydrated={hydrated}
    data-tour={tour ? 'playing' : 'paused'} aria-labelledby={`${id}-heading`}
    onPointerDown={event => {if (!isTourControl(event)) stopTour();}} onFocusCapture={event => {if (!isTourControl(event)) stopTour();}}>
    <p className={frame.eyebrow}>Anatomy / ClawHub 公开读模型</p>
    <h3 className={frame.heading} id={`${id}-heading`}>最新版本，为什么没有成为公开版本？</h3>
    <p className={frame.note}>左边保存 Skill 与版本记录，中间索引卡保存列表所需字段，右边是公开目录。默认条件下，latest 是已发布但扫描待审的 v2；索引选择 v1，目录的标题与摘要仍来自父 Skill。</p>
    <ol className={styles.modules} aria-label="真实模块与数据转换">
      <li><code>skills / skillVersions</code><span>wrapped Mutation 更新源记录与父审核状态</span></li>
      <li><code>functions.ts → publicBrowse.ts</code><span>Trigger 重建投影，按公开条件选版本</span></li>
      <li><code>skillSearchDigest → listPublicPageV4</code><span>索引分页，再组装卡片和展示版本</span></li>
    </ol>
    <div className={frame.card}>
      <div className={frame.corners}><span>Fig 01</span><span>Skill 档案 → 索引卡 → 公开目录</span></div>
      <svg className={frame.figure} viewBox={`0 0 ${DIGEST_WIDTH} ${DIGEST_HEIGHT}`} role="img" aria-labelledby={`${id}-svg-title ${id}-svg-description`} data-anatomy-parts={DIGEST_PART_COUNT}>
        <title id={`${id}-svg-title`}>ClawHub 图书目录编目柜</title>
        <desc id={`${id}-svg-description`}>左侧完整 Skill 卷宗和两个版本册保持存放。中间抽屉的薄索引卡选择 {publicShort}；{state.explanation}右侧公开目录输出与下方字段一致。</desc>
        <path d={DIGEST_HALO} className={styles.halo} />
        <g ref={partsHost}>
          {DIGEST_PARTS.map(part => <g key={part.name} data-part={part.name} data-depth={part.key}
            data-motion={part.family === 'selector' ? 'selector' : undefined} transform={part.family === 'selector' ? SELECTOR_REST : undefined}>
            <AnatomySolid paths={part.paths} tone={part.tone} name={part.name} lit={part.family === 'selector'} />
            {part.lines.map((line, i) => <AnatomyLine key={i} {...line} />)}
            {part.name === SKILL_PRINT.partName && <g transform={SKILL_PRINT.transform} className={styles.print}><text x="20" y="13" textAnchor="middle" fontSize="8">SKILL</text><path d="M3 26H36M3 31H32M3 36H35M3 44H36M3 49H28" className={styles.printRule} data-free="both" /></g>}
            {part.name === V1_PRINT.partName && <g transform={V1_PRINT.transform} className={styles.print}><text x="11" y="14" textAnchor="middle" fontSize="12" opacity={conditions.v1Withdrawn ? 0.45 : 1}>v1</text>{conditions.v1Withdrawn && <path d="M1 5L21 18" className={styles.printRule} data-free="both" />}</g>}
            {part.name === V2_PRINT.partName && <g transform={V2_PRINT.transform} className={styles.print}><text x="11" y="14" textAnchor="middle" fontSize="12">v2</text></g>}
            {part.name === INDEX_PRINT.partName && <g transform={INDEX_PRINT.transform} className={styles.print}>
              <text x="6" y="5" textAnchor="middle" fontSize="5">v1</text><text x="26" y="5" textAnchor="middle" fontSize="5">v2</text><text x="46" y="5" textAnchor="middle" fontSize="5">Ø</text>
              <text x="25" y="15" textAnchor="middle" fontSize="4.3">publicVersion</text><path d="M5 20H45" className={styles.printRule} data-free="both" />
            </g>}
            {part.name === PUBLIC_PRINT.partName && <g transform={PUBLIC_PRINT.transform} className={styles.print}>
              <text x="33" y="12" textAnchor="middle" fontSize="10">{state.entry ? versionShort(state.entry.latestVersion.id) : '—'}</text>
              <path d={state.entry ? 'M5 21H59M5 27H50M5 33H55' : 'M15 25H51'} className={styles.printRule} data-free="both" />
            </g>}
            {part.name === PLATE_PRINT.partName && <g transform={PLATE_PRINT.transform} className={styles.print}><text x="0" y="0" fontSize="3.2" letterSpacing="0.4">CLAW HUB</text></g>}
          </g>)}
        </g>
      </svg>
      <div className={frame.corners}><span>滑标对应 publicVersion；档案与索引卡都保留</span><span>当前公开版本：{publicShort}</span></div>
    </div>
    <div className={frame.legend}><span>厚卷宗：skills</span><span>版本册：skillVersions</span><span>薄索引卡：skillSearchDigest</span><span>右侧页：公开目录条目</span></div>
    <fieldset className={styles.controls} disabled={!hydrated}>
      <legend>改变业务条件，观察索引与目录怎样变化</legend>
      <div className={styles.reviewOptions} role="radiogroup" aria-label="v2扫描与父状态">
        <label><input type="radio" name={`${id}-review`} checked={conditions.v2Review === 'pending'} onChange={() => change({v2Review: 'pending'}, 'v2-pending')} />v2 已发布，扫描待审</label>
        <label><input type="radio" name={`${id}-review`} checked={conditions.v2Review === 'public'} onChange={() => change({v2Review: 'public'}, 'v2-public')} />v2 满足公开条件（父状态同步）</label>
      </div>
      <div className={styles.toggles}>
        <label><input type="checkbox" checked={conditions.v1Withdrawn} onChange={event => change({v1Withdrawn: event.target.checked}, 'v1-withdrawn')} />v1 已撤下</label>
        <label><input type="checkbox" checked={conditions.hidden} onChange={event => change({hidden: event.target.checked}, 'skill-hidden')} />Skill 已隐藏</label>
        <Button size="sm" variant="ghost" onPress={() => change({...INITIAL_CONDITIONS}, 'reset')}>恢复待审条件</Button>
      </div>
    </fieldset>
    <div className={styles.playback}>
      <Button size="sm" variant="ghost" data-action="tour" aria-pressed={tour} isDisabled={!hydrated || reduced} onPress={toggleTour}>{tour ? '暂停播放' : '播放条件对照'}</Button>
      <span>{!hydrated ? '启用交互后可播放条件对照。' : reduced ? '已开启减少动画，可手动改变条件。' : '每 3 秒对照待审 v1、公开 v2、回到待审、撤下 v1，再恢复；手动操作会停止播放。'}</span>
    </div>
    <dl className={styles.fields}>
      <div><dt>skills.latestVersionId</dt><dd data-field="latest">v2 <small>2.0.0</small></dd></div>
      <div><dt>digest.publicVersion</dt><dd data-field="public">{state.digest.publicVersion.status === 'available' ? `available → ${publicShort}` : 'unavailable'}</dd></div>
      <div><dt>目录 latestVersion.version</dt><dd data-field="listed">{state.entry?.latestVersion.version ?? '不返回条目'}</dd></div>
    </dl>
    <div className={styles.result} data-catalog-result>
      <p className={styles.resultLabel}>listPublicPageV4 / 公开目录</p>
      {state.entry ? <article className={styles.entry}>
        <div className={styles.entryHeader}><strong>{state.entry.skill.displayName}</strong><span>{state.entry.latestVersion.version}</span></div>
        <p>{state.entry.skill.summary}</p><small>{state.entry.ownerDisplayName} · 标题和摘要来自父 Skill 的 digest</small>
        <p className={styles.hydration}>{state.entry.hydration === 'public-version-read' ? '公开指针与 latest 不同：按 publicVersion 回读 v1，取得该版本号和 changelog。' : '公开指针与 latest 一致：使用 digest.latestVersionSummary 的内联摘要。'}</p>
      </article> : <p className={styles.empty}>{state.outcome === 'hidden' ? 'Skill 公开性过滤阻断该条目。' : '没有可展示版本；待审 Hosted Skill 的 hydration 不返回该条目。'}<small>源档案与 digest 都仍存在。</small></p>}
    </div>
    <p className={`${frame.note} ${styles.status}`} role="status" aria-live={tour ? 'off' : 'polite'} data-machine-status>{state.explanation}</p>
    <p className={frame.note}>固定教学数据：Hosted Skill、非 suspicious、已有两个版本；v1 各扫描状态明确可公开，v2 为 <code>publicationStatus: published</code>。待审理由为 <code>pending.scan</code>，<code>moderationSourceVersionId</code> 指向 v2。它与等待首次发布的 pending publication 是不同分支。版本谓词按状态排除阻断项，不保证“所有扫描完成或绝对安全”。</p>
    <p className={frame.note}>抽屉与滑标解释持久投影和版本选择，动作不代表额外事务或缓存计数。<a target="_blank" rel="noopener noreferrer" href={`${SOURCE_ROOT}convex/lib/publicBrowse.ts#L123-L166`}>公开版本选择</a> · <a target="_blank" rel="noopener noreferrer" href={`${SOURCE_ROOT}convex/skills.ts#L6147-L6259`}>列表 hydration</a></p>
    <noscript><p className={frame.note}>当前静态图：latest v2 扫描待审，publicVersion 指向 v1，目录返回 1.0.0；父 Skill 的新版标题与摘要保留。</p></noscript>
  </section>;
}
