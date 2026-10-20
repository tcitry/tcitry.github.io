import {useEffect, useId, useMemo, useState} from 'react';
import {Button} from '@heroui/react';
import {trackDemoStart} from '../../lib/analytics';
import {GATE_SCENARIOS, INITIAL_GATE, parseVersion, releaseGate, VERSION_OPTIONS, WAZA_SOURCE, type GateInput} from './waza-release-gate-model';
import demoSurface from './DemoSurface.module.css';
import styles from './WazaReleaseGateMachine.module.css';

const BUILD_COMPARISONS = ['build-mismatch', 'build-parity'] as const;

/** Show the strings being compared; the teaching model and public anchor stay stable. */
export default function WazaReleaseGateMachine() {
  const id = useId();
  const [input, setInput] = useState<GateInput>(INITIAL_GATE);
  const [hydrated, setHydrated] = useState(false);
  const state = useMemo(() => releaseGate(input), [input]);
  const unique = [...new Set(state.fields.flatMap(field => field.normalized === null ? [] : [field.normalized]))];
  const tag = input.tag ? parseVersion(input.tag) : null;
  const scenario = GATE_SCENARIOS.find(item => item.input.tag === input.tag && item.input.versions.every((value, index) => value === input.versions[index]))?.id ?? 'custom';
  useEffect(() => setHydrated(true), []);

  function change(next: GateInput, action: string) {
    setInput(next);
    trackDemoStart('waza-release-gate-machine', action);
  }
  function choose(scenarioId: string) {
    const selected = GATE_SCENARIOS.find(item => item.id === scenarioId);
    if (selected) change(selected.input, selected.id);
  }
  const comparison = !state.parsed
    ? '没有可比较的单一 SemVer，未进入 Tag 比较。'
    : !tag ? '没有稳定 Tag，本项不因此变成 WARN。'
    : state.comparison === 'same' ? 'core 与 prerelease 相同，比较结果为持平。'
    : state.comparison === 'behind' ? 'manifest 落后于稳定 Tag，结果为 FAIL。'
    : 'manifest 高于稳定 Tag，可表示准备中的版本。';

  return <section id="waza-release-gate-machine" className={`${demoSurface.surface} ${styles.demo}`}
    data-demo="waza-release-gate-machine" data-book-island data-status={state.status} data-hydrated={hydrated} aria-labelledby={`${id}-heading`}>
    <p className={styles.eyebrow}>Waza / 版本校验实验</p>
    <h3 id={`${id}-heading`}>同样的 build 后缀，为什么有时参与比较？</h3>
    <p className={styles.note}>先比较去掉前缀后的完整字符串，字段一致后再解析 SemVer、对照稳定 Tag。改一个输入，沿下方三步核对它在哪里改变结果。</p>

    <fieldset className={styles.controls} disabled={!hydrated}>
      <legend>输入字段与稳定 Tag</legend>
      <label className={styles.scenario}>条件对照
        <select data-control="scenario" value={scenario} onChange={event => choose(event.target.value)}>
          <option value="custom" disabled>自定义条件</option>
          {GATE_SCENARIOS.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className={styles.inputGrid}>
        {state.fields.map((field, index) => <label key={field.name}>{field.name}
          <select data-control={`field-${index}`} value={field.raw ?? ''} onChange={event => {
            const versions = [...input.versions] as GateInput['versions'];
            versions[index] = event.target.value || null;
            change({...input, versions}, `field-${index}`);
          }}>
            {VERSION_OPTIONS.map(value => <option key={value ?? 'absent'} value={value ?? ''}>{value ?? '没有 version 字段'}</option>)}
          </select>
        </label>)}
        <label>已选出的稳定可达 Tag
          <select data-control="tag" value={input.tag ?? ''} onChange={event => change({...input, tag: event.target.value || null}, 'tag')}>
            <option value="">没有</option>{['v3.39.0', 'v3.40.0', 'v3.41.0'].map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className={styles.compareButtons}>
        <span>对照 build metadata：</span>
        {BUILD_COMPARISONS.map(scenarioId => <Button key={scenarioId} size="sm" variant={scenario === scenarioId ? 'secondary' : 'outline'}
          isDisabled={!hydrated} aria-pressed={scenario === scenarioId} data-scenario={scenarioId} onPress={() => choose(scenarioId)}>
          {scenarioId === 'build-mismatch' ? '字段的 build 不同' : '统一 build，再比 Tag'}
        </Button>)}
      </div>
    </fieldset>

    <ol className={styles.trace} aria-label="version_sync 的转换与判断">
      <li>
        <h4>去前缀，再比较完整字符串</h4>
        <div className={styles.tableWrap}>
          <table className={styles.fields}>
            <thead><tr><th scope="col">字段</th><th scope="col">原始值</th><th scope="col">去掉开头一个 v / V</th></tr></thead>
            <tbody>{state.fields.map(field => <tr key={field.name}>
              <th scope="row">{field.name}</th><td><code>{field.raw ?? '未收集'}</code></td>
              <td><code data-normalized={field.name}>{field.normalized ?? '不参与比较'}</code></td>
            </tr>)}</tbody>
          </table>
        </div>
        <p>不同字符串 <strong data-field="unique-count">{unique.length}</strong> 个：
          <code data-field="unique">{JSON.stringify(unique)}</code>
        </p>
        <p className={styles.note} data-field="agreement">{unique.length === 0
          ? '没有收集到字段，本项为 N/A。'
          : state.agreement ? '字段一致，保留这一完整字符串作为 manifest。'
          : '字段不一致，结果为 FAIL；没有选出单一 manifest。'}
          {' '}此处仍保留 <code>+build</code>；<code>ci.1</code> 与 <code>ci.2</code> 是不同字符串。</p>
      </li>
      <li data-blocked={!state.parsed}>
        <h4>解析单一 manifest</h4>
        <p>manifest：<code data-field="manifest">{state.manifest ?? '无'}</code></p>
        {state.parsed ? <dl className={styles.parsed} data-field="parsed">
          <div><dt>core</dt><dd><code>{state.parsed.core.join('.')}</code></dd></div>
          <div><dt>prerelease</dt><dd><code>{state.parsed.prerelease ?? '无'}</code></dd></div>
          <div><dt>build metadata</dt><dd><code>{state.parsed.build ?? '无'}</code><small>可解析；不放入 Tag 比较值</small></dd></div>
        </dl> : <p className={styles.note} data-field="parse-result">{state.manifest
          ? '格式不符合脚本的精确 SemVer 规则，结果为 FAIL。'
          : '没有单一 manifest，不进入这一步。'}</p>}
        {state.parsed?.prerelease && <p className={styles.note}>存在 prerelease，此时至少为 WARN；若与稳定 Tag 比较发现回退，还会变成 FAIL。</p>}
      </li>
      <li data-blocked={!state.parsed}>
        <h4>对照稳定 Tag</h4>
        {state.parsed && tag && <div className={styles.comparison} data-field="comparison-values">
          <p><span>manifest</span><code>{state.parsed.core.join('.')}{state.parsed.prerelease ? `-${state.parsed.prerelease}` : ''}</code></p>
          <p><span>Tag</span><code>{tag.core.join('.')}{tag.prerelease ? `-${tag.prerelease}` : ''}</code></p>
        </div>}
        <p data-field="comparison">{comparison}</p>
        <p className={styles.note}>这一步只比较 core 与 prerelease，忽略 build metadata。可达 Tag 来自本地 Git，不能据此认定它是远端最新版本。</p>
      </li>
    </ol>

    <div className={styles.result} role="status" aria-live="polite" aria-atomic="true" data-machine-status>
      <strong data-field="status">{state.status}</strong>
      <div><p><code>VERSION FIELD SYNC</code></p>{state.reasons.map(reason => <p key={reason}>{reason}</p>)}</div>
    </div>
    <p className={styles.note}>这里只演示已收集的三类 manifest 字符串；实际脚本还读取 <code>pyproject.toml</code>，检查文件安全和格式。这个 PASS 是 <code>/check</code> 的一项证据，不表示允许发布；WARN / FAIL 也不改变脚本正常运行时的退出码 0。<a href={WAZA_SOURCE} target="_blank" rel="noopener noreferrer">核对固定版本源码</a></p>
    <noscript><p className={styles.note}>初始静态结果：三个字段仅 v/V 前缀不同，规范化后均为 3.40.0，与稳定 Tag 相同，因此为 PASS。启用 JavaScript 后可切换输入。</p></noscript>
  </section>;
}
