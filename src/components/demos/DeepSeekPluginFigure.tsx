// Article MDX still imports this island. The plugin-lifetime figure is not shown.
// An empty fragment is a real React element. null/undefined fails Astro SSR
// when React and Svelte are both installed ("Unable to render").
export default function DeepSeekPluginFigure() {
  return <></>;
}
