<script lang="ts">
  import {onMount} from 'svelte';
  import styles from './DemoSurface.module.css';
  let count = $state(0);
  let step = $state(1);
  let hydrated = $state(false);
  const doubled = $derived(count * 2);
  onMount(() => { hydrated = true; });
</script>

<section class={`${styles.surface} @container demo-surface not-prose my-6 min-w-0 rounded-2xl border border-border bg-surface text-foreground`} aria-label="Svelte 响应式计数演示" data-demo="svelte-counter">
  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-separator px-5 py-4 sm:px-6">
    <div><div class="text-base font-semibold" role="heading" aria-level="3">一个状态，两个结果</div><div class="mt-1 text-xs leading-relaxed text-muted">计数变化时，派生值自动更新。</div></div>
    <span class="rounded-full bg-surface-secondary px-3 py-1 text-xs text-muted">Svelte 5</span>
  </div>
  <div class="grid grid-cols-2 gap-4 px-5 py-6 sm:px-6">
    <div><div class="mb-2 text-xs text-muted">当前计数</div><output class="text-5xl font-semibold tabular-nums tracking-tight" aria-live="polite" data-testid="svelte-count">{count}</output></div>
    <div class="border-l border-separator pl-5"><div class="mb-2 text-xs text-muted">派生值 · 计数 × 2</div><output class="text-5xl font-semibold tabular-nums tracking-tight text-accent" data-testid="svelte-derived">{doubled}</output></div>
  </div>
  <div class="flex flex-wrap items-center gap-3 border-t border-separator px-5 py-4 sm:px-6">
    <label class="flex items-center gap-2 text-sm">
      步长
      <select bind:value={step} disabled={!hydrated} class="rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">
        <option value={1}>1</option>
        <option value={2}>2</option>
        <option value={5}>5</option>
      </select>
    </label>
    <button type="button" disabled={!hydrated} class="cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50" onclick={() => count += step} data-testid="svelte-increment">增加 {step}</button>
    <button type="button" disabled={!hydrated} class="cursor-pointer rounded-lg border border-border bg-surface px-4 py-2 text-sm text-foreground hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50" onclick={() => count = 0}>归零</button>
  </div>
  <noscript><div class="px-5 pb-4 text-sm text-muted">此计数器需要 JavaScript。</div></noscript>
</section>
