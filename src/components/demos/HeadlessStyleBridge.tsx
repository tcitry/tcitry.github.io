import {useEffect, useId, useState} from 'react';
import {Button} from '@heroui/react';
import {checkboxVariants} from '@heroui/styles';
import {INITIAL_STYLE_BRIDGE, styleBridgeAt, type StyleBridgeInput} from './headless-style-bridge-model';
import surface from './DemoSurface.module.css';
import styles from './HeadlessStyleBridge.module.css';
import './headless-style-bridge.css';

const slots = checkboxVariants();
const SOURCE = 'https://github.com/heroui-inc/heroui/blob/v3/packages/styles/components/checkbox.css';

/** Reconstructs a documented DOM/CSS boundary; it does not run Base UI. */
export default function HeadlessStyleBridge() {
  const uid = useId();
  const [input, setInput] = useState<StyleBridgeInput>({...INITIAL_STYLE_BRIDGE});
  const [ready, setReady] = useState(false);
  const state = styleBridgeAt(input);
  const update = (patch: Partial<StyleBridgeInput>) => setInput(value => ({...value, ...patch}));
  useEffect(() => setReady(true), []);
  const ancestorAttributes = state.ancestor ? {'data-selected': state.selected, 'data-indeterminate': state.mixed} : {};
  const controlAttributes = !state.ancestor ? {'data-selected': state.selected, 'data-indeterminate': state.mixed} : {};

  return <section className={`${surface.surface} ${styles.root}`} data-book-island data-demo="headless-style-bridge" data-hydrated={ready} data-matches={state.matches} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <span className={styles.eyebrow}>状态与 CSS 匹配实验</span>
      <h3 id={`${uid}-title`}>状态值一样，为什么 CSS 没命中？</h3>
      <p>将状态名称与值转换成 HeroUI 选择器要求的形式，再改变属性所在的 DOM 层级。下方 Control 直接使用真实 HeroUI CSS，可对照哪些背景选择器命中。</p>
    </header>

    <div className={styles.controls}>
      <fieldset><legend>① 输入状态</legend><div className={styles.buttons}>
        <Button size="sm" variant={state.checked ? 'secondary' : 'outline'} aria-pressed={state.checked} onPress={() => update({checked: !state.checked})} isDisabled={!ready} data-action="checked">checked：{state.checked ? 'true' : 'false'}</Button>
        <Button size="sm" variant={state.indeterminate ? 'secondary' : 'outline'} aria-pressed={state.indeterminate} onPress={() => update({indeterminate: !state.indeterminate})} isDisabled={!ready} data-action="indeterminate">indeterminate：{state.indeterminate ? 'true' : 'false'}</Button>
      </div></fieldset>
      <fieldset><legend>② 状态适配</legend><div className={styles.buttons}>
        <Button size="sm" variant={state.mapping ? 'secondary' : 'outline'} aria-pressed={state.mapping} onPress={() => update({mapping: !state.mapping})} isDisabled={!ready} data-action="mapping">{state.mapping ? '已转换名称和值' : '保留原始属性'}</Button>
      </div></fieldset>
      <fieldset><legend>③ DOM 层级</legend><div className={styles.buttons}>
        <Button size="sm" variant={state.ancestor ? 'secondary' : 'outline'} aria-pressed={state.ancestor} onPress={() => update({ancestor: !state.ancestor})} isDisabled={!ready} data-action="ancestor">{state.ancestor ? '状态在 .checkbox 祖先' : '状态误放在 Control'}</Button>
      </div></fieldset>
    </div>

    <dl className={styles.contract}>
      <div><dt>原始属性</dt><dd><code data-source-attributes>{state.source}</code></dd></div>
      <div><dt>送往视觉层</dt><dd><code data-target-attributes>{state.target}</code></dd></div>
    </dl>

    <p className={styles.matchCount}><strong data-readout>{state.matches} / 2</strong> 条背景选择器命中</p>
    <div className={styles.output}>
      <div><span className={styles.outputLabel}>真实 CSS 预览 · 仅 Control 背景</span>
        <div className={styles.preview} role="img" aria-label={`HeroUI control：${state.matched ? '选中或 mixed 背景命中' : '默认背景'}`}>
          <div className={slots.base()} {...ancestorAttributes} data-preview-checkbox>
            <span className={slots.content()}>
              <span className={slots.control()} {...controlAttributes} data-checked={state.effectiveChecked ? '' : undefined} data-unchecked={!state.checked && !state.indeterminate ? '' : undefined} data-preview-control />
              <span>{state.matched ? '选中 / mixed 背景' : '默认背景'}</span>
            </span>
          </div>
        </div>
      </div>
      <div className={styles.rules}>
        <code data-selector="selected" data-hit={state.selectedMatch}>.checkbox[data-selected="true"] .checkbox__control</code>
        <code data-selector="indeterminate" data-hit={state.mixedMatch}>.checkbox[data-indeterminate="true"] .checkbox__control</code>
      </div>
    </div>
    <p className={styles.status} role="status" aria-live="polite">{state.explanation}</p>
    <details className={styles.source}><summary>模型、源码与适用边界</summary>
      <p>输入属性依据 <a href="https://base-ui.com/react/components/checkbox">Base UI Checkbox</a>；选择器与四个 slot 类来自 <a href={SOURCE}>HeroUI Checkbox CSS</a>，当前站点使用 <code>@heroui/styles 3.2.6</code>。预览直接渲染该包的 <code>.checkbox</code>、<code>.checkbox__content</code> 和 <code>.checkbox__control</code>，没有用自定义颜色模拟命中。</p>
      <p>这是状态和 CSS 的教学重建，没有加载 Base UI runtime，也没有模拟键盘、隐藏表单 input、validation、disabled、焦点或图标动画。上方操作控件本身使用 HeroUI。真实跨库组件仍须由一种 headless 内核独占交互，并逐项适配 DOM、状态和样式。</p>
    </details>
  </section>;
}
