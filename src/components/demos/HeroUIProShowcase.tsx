import {useEffect, useState} from 'react';
import {Button, Chip, ListBox} from '@heroui/react';
import {InlineSelect, Rating} from '@heroui-pro/react';
import '../../styles/demos.css';
import styles from './DemoSurface.module.css';

const views = [
  {id: 'reading', label: '阅读体验', detail: '用更少的操作，让文章更容易读完。'},
  {id: 'interaction', label: '交互反馈', detail: '每次选择，都能在界面上看到回应。'},
  {id: 'accessibility', label: '键盘与无障碍', detail: '试试 Tab、方向键、Enter 和 Escape。'},
];

export default function HeroUIProShowcase() {
  const [view, setView] = useState('reading');
  const [rating, setRating] = useState(4);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const selected = views.find(item => item.id === view) ?? views[0];

  return (
    <section className={`${styles.surface} my-6 min-w-0 rounded-2xl border border-border bg-surface`} data-demo="heroui-pro-showcase" data-hydrated={hydrated} aria-label="HeroUI Pro 选择与评价演示">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-separator px-5 py-4 sm:px-6">
        <div>
          <div className="text-base font-semibold">留一点反馈</div>
          <div className="mt-1 text-xs text-muted">选择关注点，再为这个示例打个分。</div>
        </div>
        <Chip size="sm" variant="soft" color="accent"><Chip.Label>HeroUI Pro</Chip.Label></Chip>
      </div>
      <div className="space-y-6 p-5 sm:p-6">
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span>这次更关注</span>
            <InlineSelect aria-label="体验关注点" value={view} onChange={value => {if (typeof value === 'string') setView(value);}} isDisabled={!hydrated}>
              <InlineSelect.Trigger><InlineSelect.Value /><InlineSelect.Indicator /></InlineSelect.Trigger>
              <InlineSelect.Popover className={`${styles.surface} min-w-48 max-w-[calc(100vw-2rem)]`} data-demo="heroui-pro-select-popover">
                <ListBox>
                  {views.map(item => <ListBox.Item key={item.id} id={item.id} textValue={item.label}>{item.label}<ListBox.ItemIndicator /></ListBox.Item>)}
                </ListBox>
              </InlineSelect.Popover>
            </InlineSelect>
          </div>
          <p className="mt-2! mb-0! text-sm text-muted" data-testid="pro-selection-description">{selected.detail}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-separator pt-5">
          <div className="space-y-2">
            <div className="text-sm font-medium">你的体验评分</div>
            <Rating aria-label="体验评分" value={rating} onValueChange={setRating} isDisabled={!hydrated}>
              {[1, 2, 3, 4, 5].map(value => <Rating.Item key={value} value={value} aria-label={`${value} 星`} />)}
            </Rating>
          </div>
          <Button size="sm" variant="ghost" isDisabled={!hydrated} onPress={() => {setView('reading'); setRating(4);}}>重置反馈</Button>
        </div>
        <div className="rounded-xl bg-surface-secondary px-4 py-3 text-sm" role="status" aria-live="polite">{selected.label} · {rating} / 5 星<span className="mt-1 block text-xs text-muted">仅在本页演示，不会提交或保存。</span></div>
      </div>
      <noscript><p className="px-5 text-sm text-muted">启用 JavaScript 后可选择和评分。</p></noscript>
    </section>
  );
}
