/**
 * Teaching subset of the TextChange wire format at Cloudflare OS ef34d8e.
 * Only [retain, [delete, one inserted line], retain] is evaluated here.
 * This is not the upstream ChangeSet implementation, OT mapping, or validation pipeline.
 */
export const CODE_CHANGE_SOURCE = 'https://github.com/cloudflare/cloudflare-os/blob/ef34d8edc977a73c7216fb4a83b7be0274f2e1be/packages/workshop-shared/src/code-change.ts';
export const SOURCE_TEXTS = {
  original: 'const limit = 10;\n',
  'extra-space': 'const limit =  10;\n',
} as const;
export type SourceVariant = keyof typeof SOURCE_TEXTS;
export type CellRole = 'keep' | 'delete' | 'insert' | 'uncovered';
export interface TextCell {index: number; char: string; glyph: string; role: CellRole}
export interface SpliceInput {variant: SourceVariant; replacement: number; prefix: 14 | 15}
export const INITIAL_SPLICE: SpliceInput = {variant: 'original', replacement: 25, prefix: 14};
export type TeachingEdit = [number, [number, string], number];

export function visibleText(text: string) {
  return text.replaceAll(' ', '·').replaceAll('\n', '↵');
}

export function replacementNumber(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(999, Math.trunc(value))) : 25;
}

/** Source changes keep the previous edit; regenerating is an explicit separate operation. */
export function prefixForSource(variant: SourceVariant): 14 | 15 {
  return variant === 'original' ? 14 : 15;
}

function cells(text: string, role: (index: number) => CellRole): TextCell[] {
  // String indexing counts UTF-16 code units, matching the upstream length convention.
  return Array.from({length: text.length}, (_, index) => ({
    index, char: text[index]!, glyph: visibleText(text[index]!), role: role(index),
  }));
}

export function spliceText(input: SpliceInput = INITIAL_SPLICE) {
  const source = SOURCE_TEXTS[input.variant];
  const inserted = String(replacementNumber(input.replacement));
  const prefix = input.prefix;
  const deletedLength = 2;
  const suffix = 2;
  const edit: TeachingEdit = [prefix, [deletedLength, inserted], suffix];
  const expectedBeforeLength = prefix + deletedLength + suffix;
  const beforeLength = source.length;
  const plannedAfterLength = prefix + inserted.length + suffix;
  const valid = expectedBeforeLength === beforeLength;
  const keptPrefix = source.slice(0, prefix);
  const deleted = source.slice(prefix, prefix + deletedLength);
  const keptSuffix = source.slice(prefix + deletedLength, expectedBeforeLength);
  // A failed length check has no output. It must not silently keep the unconsumed tail.
  const output = valid ? keptPrefix + inserted + keptSuffix : null;
  const change = {7: [['server.js', {edit}]]} as const;
  const wire = JSON.stringify(change);
  const sourceCells = cells(source, index => index < prefix ? 'keep'
    : index < prefix + deletedLength ? 'delete'
    : index < expectedBeforeLength ? 'keep' : 'uncovered');
  const outputCells = output === null ? [] : cells(output, index =>
    index >= prefix && index < prefix + inserted.length ? 'insert' : 'keep');
  const explanation = valid
    ? `保留前 ${prefix} 个 UTF-16 单元，删除 ${JSON.stringify(deleted)}，插入 ${JSON.stringify(inserted)}，保留末尾 ${suffix} 个。原文 ${beforeLength} → 结果 ${output!.length} 个单元。`
    : `拒绝应用：变更覆盖 ${prefix} + 2 + 2 = ${expectedBeforeLength} 个 UTF-16 单元，原文却有 ${beforeLength} 个；${beforeLength > expectedBeforeLength ? '末尾仍有未覆盖字符' : '变更超出了原文长度'}。没有生成结果，也没有修改原文。`;
  return {
    source, inserted, prefix, deletedLength, suffix, edit, change, wire,
    expectedBeforeLength, beforeLength, plannedAfterLength,
    valid, output, sourceCells, outputCells,
    insertedCells: cells(inserted, () => 'insert'),
    deletedCells: valid ? cells(deleted, () => 'delete') : [],
    keptPrefix, deleted, keptSuffix,
    uncovered: source.slice(expectedBeforeLength),
    explanation,
  };
}
export type SpliceState = ReturnType<typeof spliceText>;
