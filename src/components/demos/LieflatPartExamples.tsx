/**
 * Lieflat Charts L14 Hundred Field, adapted from its original gallery renderer.
 * By 躺在废墟里; source commit eace082a317b696c5570c25826a53a7fa113e984.
 * Template-derived code: PolyForm Noncommercial License 1.0.0.
 * https://polyformproject.org/licenses/noncommercial/1.0.0/
 */
import {Fragment, useId, useState} from 'react';
import Frame from './LieflatExampleFrame';
import {buildHundredField, HUNDRED_DEFAULTS} from './lieflat-part-examples';

const upstream = 'https://github.com/larashero3-dotcom/lieflat-charts/blob/eace082a317b696c5570c25826a53a7fa113e984/templates/';
const ink = '#1C1C1A', grid = '#DEDDD6';
const svgStyle = {display: 'block', width: '100%', height: 'auto'} as const;

function useNumbers(defaults: number[]) {
  const [values, setValues] = useState(() => [...defaults]);
  const change = (index: number, text: string) => {
    const number = Number(text);
    if (text !== '' && Number.isFinite(number) && Number.isInteger(number)) setValues(previous => previous.map((value, i) => i === index ? number : value));
  };
  return {values, setValues, change, reset: () => setValues([...defaults])};
}

function HundredExample() {
  const id = useId();
  const {values, setValues, change, reset} = useNumbers(HUNDRED_DEFAULTS);
  const chart = buildHundredField(values);
  const names = chart.clusters.slice(0, 3).map(cluster => cluster.name);
  const description = '三个占比可以修改，第四项自动补足。这里展示百分比构成，样本人数未知。';
  const legend = '一个实点 = 1 个百分点；簇内位置、点的大小和连线不表示额外数据。';
  const summary = `${chart.leaders.join('、')}${chart.leaders.length > 1 ? '并列最高' : '占比最高'}：${chart.maximum}%。四项合计 100%；不能据此推断有 100 个真实个体。`;
  return <Frame typeId="L14" title="100 个百分点，怎样分成四份？" description={description} legend={legend} source={`${upstream}lupi-gallery.html`} summary={summary}
    prompt={`使用 Lieflat Charts L14 Hundred Field，沿用真实模板。教学构成数据：${chart.clusters.map(cluster => `${cluster.name} ${cluster.value}%`).join('、')}。四类互斥且穷尽，总和100%。样本人数未知，每点只能标为1个百分点，不得说成1个人。使用Mono，保留点簇与直接标签。`}
    fields={names.map((label, index) => ({label: `${label}（%）`, value: String(values[index]), min: 0, max: 100 - values.reduce((sum, value, i) => sum + (i === index ? 0 : value), 0), step: 1, onChange: (value: string) => change(index, value)}))}
    presets={[{label: '平均四份', onPress: () => setValues([25, 25, 25])}, {label: '全部完成', onPress: () => setValues([100, 0, 0])}, {label: '全部取消', onPress: () => setValues([0, 0, 0])}]} onReset={reset}>
    <svg viewBox="0 0 360 270" style={svgStyle} role="img" aria-labelledby={`${id}-title ${id}-desc`} data-chart="hundred" data-unit="percentage-point">
      <title id={`${id}-title`}>四类占比的 100 个百分点</title><desc id={`${id}-desc`}>{chart.clusters.map(cluster => `${cluster.name}${cluster.value}%`).join('，')}。每个点只代表一个百分点，不代表一个人。零占比不画点。</desc>
      {[[0, 1], [0, 2], [1, 3], [2, 3]].map(([a, b]) => <line key={`${a}-${b}`} x1={chart.clusters[a].cx} y1={chart.clusters[a].cy} x2={chart.clusters[b].cx} y2={chart.clusters[b].cy} stroke={grid} strokeWidth="0.7" strokeDasharray="2 5" />)}
      {chart.clusters.map(cluster => <g key={cluster.name} data-cluster data-value={cluster.value}>
        {cluster.dots.map((dot, index) => <Fragment key={index}>
          {dot.spoke && <line x1={cluster.cx} y1={cluster.cy} x2={dot.x} y2={dot.y} stroke="#CDCCC5" strokeWidth="0.6" />}
          <circle data-unit-dot data-reveal data-delay={dot.delay} data-opacity="0.9" cx={dot.x} cy={dot.y} r={dot.radius} fill={cluster.shade} opacity="0.9"><title>{cluster.name}：第 {index + 1} 个百分点</title></circle>
        </Fragment>)}
        <text x={cluster.cx} y={cluster.labelY} textAnchor="middle" fill={ink} fontSize="18" fontWeight="700" paintOrder="stroke" stroke="#F0EFEB" strokeWidth="4">{cluster.name} {cluster.value}%</text>
      </g>)}
    </svg>
  </Frame>;
}

export default function LieflatPartExamples() {
  return <HundredExample />;
}
