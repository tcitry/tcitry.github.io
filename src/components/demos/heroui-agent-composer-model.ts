/**
 * A local teaching model of data → component contract → JSONL → validated UI.
 * The protocol shape follows HeroUI's documented composeUI example; these
 * deliberately small component contracts are ours, not HeroUI's schemas.
 */
export type Presentation = 'bar-chart' | 'metric-grid' | 'data-table';
export type DatasetPreset = 'steady' | 'busy' | 'empty';
export interface SalesRow {day: string; quantity?: number}
export interface SalesData {period: string; unit: string; rows: SalesRow[]; total?: number}
export interface TeachingElement {type: string; props: Record<string, unknown>; children: string[]}
export interface TeachingSpec {root: string; elements: Record<string, TeachingElement>}
export interface SpecPatch {op: 'add'; path: string; value: unknown}
export interface ContractIssue {path: string; message: string}
export interface ComposerState {
  data: SalesData; presentation: Presentation; spec: TeachingSpec; specStream: string;
  issues: ContractIssue[]; accepted: boolean; values: Array<number | undefined>;
}
export const PRESENTATIONS: readonly Presentation[] = ['bar-chart', 'metric-grid', 'data-table'];
export const PRESENTATION_LABELS: Record<Presentation, string> = {
  'bar-chart': '柱状图', 'metric-grid': '指标卡', 'data-table': '数据表',
};
export const PRESETS: Record<DatasetPreset, {label: string; quantities: readonly number[]}> = {
  steady: {label: '平日', quantities: [24, 42, 30, 54]},
  busy: {label: '促销日', quantities: [72, 36, 60, 48]},
  empty: {label: '全为零', quantities: [0, 0, 0, 0]},
};
export const DAYS = ['周一', '周二', '周三', '周四'] as const;
export const MAX_QUANTITY = 100;
export const CONTRACT_SUMMARY: Record<Presentation, string> = {
  'bar-chart': 'data[].label: string · data[].value: 非负整数',
  'metric-grid': 'metrics[].label: string · metrics[].value: 非负整数',
  'data-table': 'rows[].day: string · rows[].quantity: 非负整数',
};

/** The data-tool layer calculates the total. The UI renderer does not infer it. */
export function salesToolResult(quantities: readonly number[], omitFirstQuantity = false): SalesData {
  const rows = DAYS.map((day, index) => ({day, ...(!omitFirstQuantity || index !== 0 ? {quantity: quantities[index] ?? 0} : {})}));
  return {
    period: '四日销量（教学数据）', unit: '件', rows,
    ...(!omitFirstQuantity ? {total: rows.reduce((sum, row) => sum + (row.quantity ?? 0), 0)} : {}),
  };
}

/** The model-selection step is a deterministic switch here; no LLM is called. */
export function buildTeachingSpec(data: SalesData, presentation: Presentation): TeachingSpec {
  const common = {title: data.period, unit: data.unit};
  const props: Record<string, unknown> = presentation === 'bar-chart'
    ? {...common, data: data.rows.map(row => ({label: row.day, ...(row.quantity !== undefined ? {value: row.quantity} : {})}))}
    : presentation === 'metric-grid'
      ? {...common, metrics: [{label: '四日合计', ...(data.total !== undefined ? {value: data.total} : {})}]}
      : {...common, rows: data.rows.map(row => ({...row}))};
  return {root: 'sales-layout', elements: {
    'sales-layout': {type: 'teaching-stack', props: {title: data.period}, children: ['sales-view']},
    'sales-view': {type: presentation, props, children: []},
  }};
}

export function patchesFor(spec: TeachingSpec): SpecPatch[] {
  return [
    {op: 'add', path: '/root', value: spec.root},
    {op: 'add', path: '/elements', value: {}},
    ...Object.entries(spec.elements).map(([name, element]): SpecPatch => ({op: 'add', path: `/elements/${name}`, value: element})),
  ];
}
export function jsonlFor(spec: TeachingSpec): string {
  return patchesFor(spec).map(patch => JSON.stringify(patch)).join('\n');
}

/** Only the four documented teaching patch positions are accepted. */
export function compileTeachingStream(stream: string): TeachingSpec {
  let root: string | undefined;
  let elements: Record<string, TeachingElement> | undefined;
  for (const line of stream.split('\n').filter(line => line.trim())) {
    const patch = JSON.parse(line) as SpecPatch;
    if (patch.op !== 'add') throw new Error('教学编译器只接受 add patch。');
    if (patch.path === '/root' && typeof patch.value === 'string') root = patch.value;
    else if (patch.path === '/elements' && patch.value && typeof patch.value === 'object' && !Array.isArray(patch.value)) elements = {...patch.value} as Record<string, TeachingElement>;
    else if (/^\/elements\/[a-z0-9-]+$/.test(patch.path) && elements) {
      elements[patch.path.slice('/elements/'.length)] = patch.value as TeachingElement;
    } else throw new Error(`不支持的教学 patch 路径：${patch.path}`);
  }
  if (!root || !elements) throw new Error('spec 缺少 root 或 elements。');
  return {root, elements};
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const quantityIsValid = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Fail closed on the teaching registry, child references and required fields. */
export function validateTeachingSpec(spec: TeachingSpec): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const reject = (path: string, message: string) => issues.push({path, message});
  if (!spec.elements[spec.root]) reject('/root', 'root 必须指向已存在的 element。');
  for (const [name, element] of Object.entries(spec.elements)) {
    const path = `/elements/${name}`;
    if (!isRecord(element) || typeof element.type !== 'string' || !isRecord(element.props) || !Array.isArray(element.children)) {
      reject(path, 'element 必须有 type、props 和 children。');continue;
    }
    for (const child of element.children) if (typeof child !== 'string' || !spec.elements[child]) reject(`${path}/children`, 'children 引用必须存在。');
    if (element.type === 'teaching-stack') continue;
    if (!PRESENTATIONS.includes(element.type as Presentation)) {reject(`${path}/type`, '组件不在教学 registry 内。');continue;}
    if (typeof element.props.title !== 'string' || typeof element.props.unit !== 'string') reject(`${path}/props`, '需要 title 与 unit。');
    const field = element.type === 'bar-chart' ? 'data' : element.type === 'metric-grid' ? 'metrics' : 'rows';
    const valueKey = element.type === 'data-table' ? 'quantity' : 'value';
    const labelKey = element.type === 'data-table' ? 'day' : 'label';
    const items = element.props[field];
    if (!Array.isArray(items) || items.length === 0) {reject(`${path}/props/${field}`, '至少需要一行。');continue;}
    items.forEach((item: unknown, index: number) => {
      const at = `${path}/props/${field}/${index}`;
      if (!isRecord(item)) {reject(at, '需要结构化行。');return;}
      if (typeof item[labelKey] !== 'string' || !(item[labelKey] as string).trim()) reject(`${at}/${labelKey}`, '标签是必需的非空字符串。');
      if (!quantityIsValid(item[valueKey])) reject(`${at}/${valueKey}`, '数值是必需的非负整数；不会把缺失值补成零。');
    });
  }
  const visit = (name: string, ancestors: Set<string>) => {
    if (ancestors.has(name)) {reject(`/elements/${name}/children`, 'children 不能形成循环。');return;}
    const element = spec.elements[name];
    if (!element || !Array.isArray(element.children)) return;
    const next = new Set(ancestors);next.add(name);
    element.children.forEach(child => {if (typeof child === 'string') visit(child, next);});
  };
  visit(spec.root, new Set());
  return issues;
}

export function composerState(quantities: readonly number[] = PRESETS.steady.quantities, presentation: Presentation = 'bar-chart', omitFirstQuantity = false): ComposerState {
  const data = salesToolResult(quantities, omitFirstQuantity);
  const specStream = jsonlFor(buildTeachingSpec(data, presentation));
  const spec = compileTeachingStream(specStream);
  const issues = validateTeachingSpec(spec);
  return {data, presentation, spec, specStream, issues, accepted: issues.length === 0, values: data.rows.map(row => row.quantity)};
}

/** A fixed 0–100 scale keeps comparisons true when the dataset changes. */
export function quantityWidth(quantity: number | undefined, maximumWidth: number): number {
  return typeof quantity === 'number' && Number.isFinite(quantity) ? Math.max(0, Math.min(quantity, MAX_QUANTITY)) / MAX_QUANTITY * maximumWidth : 0;
}
