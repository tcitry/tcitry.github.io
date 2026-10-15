/** A CSS contract model, not a replacement for either headless runtime. */
export interface StyleBridgeInput {
  checked: boolean;
  indeterminate: boolean;
  mapping: boolean;
  ancestor: boolean;
}

export const INITIAL_STYLE_BRIDGE: StyleBridgeInput = {
  checked: true, indeterminate: false, mapping: true, ancestor: true,
};

export function styleBridgeAt(input: StyleBridgeInput) {
  // Base UI suppresses both checked/unchecked attributes while mixed is true.
  const effectiveChecked = input.checked && !input.indeterminate;
  const selected = input.mapping && effectiveChecked ? 'true' : undefined;
  // Base UI emits an empty attribute, while HeroUI compares its string value.
  const mixed = input.indeterminate ? (input.mapping ? 'true' : '') : undefined;
  const selectedMatch = input.ancestor && selected === 'true';
  const mixedMatch = input.ancestor && mixed === 'true';
  const matched = selectedMatch || mixedMatch;
  const explanation = !effectiveChecked && !input.indeterminate
    ? '输入未选中且不是 mixed；没有选中背景是正确结果。'
    : !input.mapping
      ? '原始属性未适配：data-checked 名称不同，空值 data-indeterminate 也不等于字符串 true。'
      : !input.ancestor
        ? '属性值已转换，但放在 Control 上；CSS 要求状态位于它的 .checkbox 祖先。'
        : '状态名称、字符串值与祖先层级均匹配，HeroUI 的选中或 mixed 背景规则生效。';
  return {
    ...input,
    effectiveChecked,
    selected,
    mixed,
    selectedMatch,
    mixedMatch,
    matched,
    activeInputs: Number(effectiveChecked) + Number(input.indeterminate),
    matches: Number(selectedMatch) + Number(mixedMatch),
    source: [input.indeterminate ? null : input.checked ? 'data-checked=""' : 'data-unchecked=""', input.indeterminate ? 'data-indeterminate=""' : null].filter(Boolean).join(' '),
    target: [selected !== undefined ? `data-selected="${selected}"` : null, mixed !== undefined ? `data-indeterminate="${mixed}"` : null].filter(Boolean).join(' ') || '无匹配状态属性',
    explanation: explanation + (input.indeterminate ? ' mixed 模式屏蔽 data-checked 和 data-unchecked；原始 checked 值仍保留在输入控件中。' : ''),
  };
}

export type StyleBridgeState = ReturnType<typeof styleBridgeAt>;
