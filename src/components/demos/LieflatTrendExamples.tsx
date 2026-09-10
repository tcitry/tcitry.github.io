/**
 * Adapted from Lieflat Charts by 躺在废墟里, templates/basics-gallery.html:
 * F2 Hairline Line and F12 Dumbbell Queue.
 * Source commit eace082a317b696c5570c25826a53a7fa113e984.
 * Template-derived code retains PolyForm Noncommercial License 1.0.0:
 * https://polyformproject.org/licenses/noncommercial/1.0.0/
 */
import {useState} from 'react';
import Frame from './LieflatExampleFrame';
import {makeDumbbellData, makeLineData, TREND_SOURCE, trendRnd} from './lieflat-trend-data';

export interface LieflatTrendExamplesProps {kind: 'line' | 'dumbbell'}
const INK = '#1C1C1A', PAPER = '#F0EFEB', MUTED = '#6A6963', GRID = '#DEDDD6';
const svgStyle = {display: 'block', width: '100%', height: 'auto', maxHeight: 300, fontFamily: 'inherit'} as const;
const halo = {paintOrder: 'stroke', stroke: PAPER, strokeWidth: 4} as const;

function LineExample() {
  const [settings, setSettings] = useState([12, 1, 12]);
  const set = (index: number, value: string) => setSettings(current => current.map((item, i) => i === index ? Number(value) : item));
  const data = makeLineData(...settings as [number, number, number]);
  const x = (day: number) => 42 + day * (286 / 13), base = 214;
  const y = (value: number) => base - value / data.scale * 156;
  const delta = data.last - data.first;
  const title = data.maximum === 0 ? '14 天都没有新增人数' : delta === 0 ? `首日与末日均为 ${data.first} 人` : `末日比首日${delta > 0 ? `多 ${delta}` : `少 ${-delta}`} 人`;
  return <Frame typeId="F2" title={title} description="观察连续 14 天的教学人数。首日设为星期一；每日变化低于 0 人时按 0 计。"
    legend="每点 = 一天；空心 = 周末；底部每条细刻度 = 一天。滑块步长均为 1 人。"
    prompt={`请使用 lieflat-charts 的 F2 Hairline Line，把连续14天的每日人数画成细折线；首日星期一，周末点空心，保留日历刻度，不将0人当作缺测。全部采用Mono，并标明教学构造数据。当前每日人数：${JSON.stringify(data.values)}。`}
    source={`${TREND_SOURCE}#L250`} summary={`首日 ${data.first} 人，末日 ${data.last} 人，最高 ${data.maximum} 人。改变第 8 天增量只影响该天。`}
    fields={[{label: '起始人数', value: String(settings[0]), onChange: value => set(0, value), min: 0, max: 40, step: 1}, {label: '每日变化', value: String(settings[1]), onChange: value => set(1, value), min: -2, max: 3, step: 1}, {label: '第 8 天增量', value: String(settings[2]), onChange: value => set(2, value), min: 0, max: 30, step: 1}]}
    presets={[{label: '每天相同', onPress: () => setSettings([16, 0, 0])}, {label: '逐步下降', onPress: () => setSettings([20, -2, 0])}, {label: '全部为 0', onPress: () => setSettings([0, 0, 0])}]} onReset={() => setSettings([12, 1, 12])}>
    <svg data-example-kind="line" viewBox="0 0 360 260" style={svgStyle} role="img" aria-label={`十四天人数：${data.values.join('、')}。空心点表示周末。`}>
      <text x="30" y="28" fontSize="16" fill={MUTED}>人数</text>
      <text x="35" y={y(data.scale) + 5} textAnchor="end" fontSize="16" fill={MUTED}>{data.scale}</text>
      <text x="35" y={base + 5} textAnchor="end" fontSize="16" fill={MUTED}>0</text>
      <line x1="36" x2="334" y1={base} y2={base} stroke={GRID} strokeWidth=".8" />
      {data.values.map((_, day) => <line key={day} x1={x(day)} x2={x(day)} y1={base} y2={base - 7} stroke="#B0AFA9" strokeWidth=".6" data-reveal data-delay={day * 8} />)}
      <path d={data.values.map((value, day) => `${day === 0 ? 'M' : 'L'}${x(day)} ${y(value)}`).join(' ')} fill="none" stroke={INK} strokeWidth="1" pathLength="1" data-reveal data-motion="draw" data-duration="1200" />
      {data.values.map((value, day) => {
        const weekend = day % 7 >= 5, large = data.highlighted.includes(day);
        return <g key={day}><circle data-daily-point cx={x(day)} cy={y(value)} r={large ? 4.2 : 2.1} fill={weekend ? PAPER : INK} stroke={INK} strokeWidth={weekend ? 1 : 0} data-reveal data-motion="pop" data-delay={200 + day * 30}><title>{`第 ${day + 1} 天：${value} 人${weekend ? '（周末）' : ''}`}</title></circle>
          {large && <text x={x(day)} y={y(value) - 12} textAnchor="middle" fontSize="18" fontWeight="800" fill={INK} style={halo}>{value}</text>}</g>;
      })}
      {[[0, '第 1 天'], [6, '第 7 天'], [13, '第 14 天']].map(([day, label]) => <text key={day} x={x(Number(day))} y="244" textAnchor={day === 0 ? 'start' : day === 13 ? 'end' : 'middle'} fontSize="16" fill={MUTED}>{label}</text>)}
    </svg>
  </Frame>;
}

function DumbbellExample() {
  const [after, setAfter] = useState([7, 10, 16]);
  const rows = makeDumbbellData(after);
  const saved = rows.reduce((sum, row) => sum + row.saved, 0);
  const same = rows.every(row => row.saved === 0);
  const mapX = (value: number) => 104 + value / 40 * 218;
  return <Frame typeId="F12" title={same ? '三项用时都没变' : saved === 0 ? '变快与变慢的时间恰好抵消' : `三项合计${saved > 0 ? '少用' : '多用'} ${Math.abs(saved)} 分钟`}
    description="改前固定为 12、18、24 分钟。调节改后用时，比较每一项的变化。"
    legend="空心点 = 改前；实心点 = 改后；每颗珠子 = 差值 1 分钟。向左变快，向右变慢；步长 1 分钟。"
    prompt={`请使用 lieflat-charts 的 F12 Dumbbell Queue，比较三项流程的改前与改后分钟数。每珠代表绝对差值1分钟；改后更慢时向右画，不能把增加的分钟写成节省。保留空心改前点与实心改后点，采用Mono教学数据。当前数据：${JSON.stringify(rows.map(({name, before, after}) => ({name, before, after})))}。`}
    source={`${TREND_SOURCE}#L636`} summary={rows.map(row => `${row.name}：${row.before} → ${row.after} 分钟`).join('；') + '。'}
    fields={rows.map((row, index) => ({label: `${row.name}：改后`, value: String(after[index]), onChange: (value: string) => setAfter(current => current.map((item, i) => i === index ? Number(value) : item)), min: 0, max: 40, step: 1}))}
    presets={[{label: '用时不变', onPress: () => setAfter([12, 18, 24])}, {label: '全部变慢', onPress: () => setAfter([20, 26, 32])}, {label: '改后为 0', onPress: () => setAfter([0, 0, 0])}]} onReset={() => setAfter([7, 10, 16])}>
    <svg data-example-kind="dumbbell" viewBox="0 0 360 280" style={svgStyle} role="img" aria-label={rows.map(row => `${row.name}由${row.before}分钟变为${row.after}分钟`).join('；')}>
      {rows.map((row, i) => {
        const y = 52 + i * 72, xa = mapX(row.before), xb = mapX(row.after);
        return <g key={row.name}>
          <text x="90" y={y + 5} textAnchor="end" fontSize="16" fill={MUTED}>{row.name}</text>
          <line x1="98" x2="328" y1={y} y2={y} stroke={GRID} strokeWidth=".7" />
          {Array.from({length: row.beads}, (_, k) => <circle key={k} data-difference-bead cx={xb + (k + .5) / row.beads * (xa - xb)} cy={y + (trendRnd(k + 1, i + 3) - .5) * 2.6} r={1.5 + trendRnd(k + 2, i + 4) * .9} fill="#8F8E88" opacity=".85" data-reveal data-opacity=".85" data-motion="pop" data-delay={300 + i * 80 + k * 30} />)}
          <circle cx={xa} cy={y} r={row.saved === 0 ? 6.4 : 4.2} fill={PAPER} stroke={INK} strokeWidth="1.3" data-reveal data-delay={200 + i * 80} />
          <circle cx={xb} cy={y} r="4.6" fill={INK} data-reveal data-delay={600 + i * 80} />
          <text x={xa} y={y - 16} textAnchor="middle" fontSize="16" fill={MUTED}>{row.before}</text>
          <text x={xb} y={y + 26} textAnchor="middle" fontSize="18" fontWeight="800" fill={INK}>{row.after}</text>
        </g>;
      })}
      <text x="104" y="265" fontSize="16" fill={MUTED}>0</text><text x="213" y="265" fontSize="16" textAnchor="middle" fill={MUTED}>20</text><text x="328" y="265" fontSize="16" textAnchor="end" fill={MUTED}>40 分钟</text>
    </svg>
  </Frame>;
}

export default function LieflatTrendExamples({kind}: LieflatTrendExamplesProps) {
  return kind === 'line' ? <LineExample /> : <DumbbellExample />;
}
