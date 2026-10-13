import type {SolidPaths, Tone} from './anatomy-iso-kit';
import '../../styles/demos.css';
import styles from './AnatomyFrame.module.css';

/** Server-safe SVG primitives for the MIT Anatomy kit. */
export function AnatomySolid({paths, tone = 'mid', lit = false, name}: {paths: SolidPaths; tone?: Tone; lit?: boolean; name?: string}) {
  return <g className={styles.solid} data-tone={tone} data-lit={lit || undefined} data-anatomy-part={name}>
    <path className={styles.fill} d={paths.fill} />
    {paths.shades.map((d, i) => d ? <path key={i} className={styles.shade} data-shade={i} d={d} /> : null)}
    <path className={styles.top} d={paths.top} />
    {paths.crease ? <path className={styles.crease} d={paths.crease} /> : null}
    {paths.bevel ? <path className={styles.crease} d={paths.bevel} /> : null}
    <path className={styles.edge} d={paths.outline} />
  </g>;
}

export function AnatomyLine({d, faint = false, free = false}: {d: string; faint?: boolean; free?: boolean}) {
  return <path className={faint ? styles.faint : styles.line} d={d} data-free={free || undefined} />;
}

export function AnatomyDots({points, size = 0.6}: {points: Array<[number, number]>; size?: number}) {
  return <g className={styles.dots}>{points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={size} />)}</g>;
}
