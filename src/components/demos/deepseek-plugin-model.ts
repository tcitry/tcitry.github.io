export type PluginScenario = 'service' | 'backend' | 'dispose';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (p: number, a: number, b: number) => {const v = clamp((p-a)/(b-a));return v*v*(3-2*v);};

/** Teaching timeline: settled states follow the pinned Cordis smoke; seconds are illustrative. */
export function pluginFrame(p: number, scenario: PluginScenario) {
  const removed = ease(p,.12,.24) * (scenario === 'dispose' ? 0 : 1-ease(p,.62,.74));
  const cleaned = scenario === 'backend' ? 0 : ease(p,.27,.39) * (scenario === 'dispose' ? 1 : 1-ease(p,.77,.89));
  const lost = p >= .24 && (scenario === 'dispose' || p < .74);
  const consumer = scenario === 'backend' ? 'ACTIVE'
    : p < .24 ? 'ACTIVE'
    : p < .39 ? 'UNLOADING'
    : scenario === 'dispose' ? 'DISPOSED'
    : p < .74 ? 'PENDING' : p < .89 ? 'LOADING' : 'ACTIVE';
  const tools = scenario === 'backend' || p < .39 || (scenario !== 'dispose' && p >= .89) ? 2 : 0;
  return {removed, cleaned, consumer, tools, webService: scenario !== 'service' || !lost,
    fetchBackend: (scenario !== 'service' || !lost) && (scenario !== 'backend' || !lost),
    call: tools === 0 ? '无工具定义' : consumer !== 'ACTIVE' ? '等待生命周期完成'
      : scenario === 'backend' && lost ? 'fetch provider 不可用' : '可执行（假设 provider 已配置）'};
}
