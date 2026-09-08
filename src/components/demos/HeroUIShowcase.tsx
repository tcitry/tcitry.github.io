import {useEffect, useState} from 'react';
import {Accordion, Button, Card, Chip, Description, Input, Label, ListBox, Select, Switch, Tabs, TextField} from '@heroui/react';
import {trackDemoStart} from '../../lib/analytics';
import '../../styles/demos.css';
import styles from './DemoSurface.module.css';

const initialTitle = '把前端实验写进一篇博客';
const topics = [
  {id: 'frontend', label: '前端开发'},
  {id: 'reading', label: '阅读体验'},
  {id: 'ai', label: 'AI 与 Agent'},
];

export default function HeroUIShowcase() {
  const [title, setTitle] = useState(initialTitle);
  const [topic, setTopic] = useState('frontend');
  const [showTags, setShowTags] = useState(true);
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState('修改上方内容，预览会立即更新。');
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const category = topics.find((item) => item.id === topic)?.label ?? topics[0].label;

  function reset() {
    trackDemoStart('heroui-showcase', 'reset');
    setTitle(initialTitle);
    setTopic('frontend');
    setShowTags(true);
    setSaved(false);
    setFeedback('已恢复初始示例。');
  }

  function showButtonFeedback(message: string) {
    setFeedback(message);
    trackDemoStart('heroui-showcase', 'button');
  }

  return (
    <section className={`${styles.surface} @container my-6 min-w-0 rounded-2xl border border-border bg-surface text-foreground`} data-demo="heroui-showcase" aria-label="HeroUI 组件交互演示" data-hydrated={hydrated}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-separator px-5 py-4 sm:px-6">
        <div>
          <div className="text-base font-semibold">一张会回应的文章卡片</div>
          <div className="mt-1 text-xs leading-relaxed text-muted">修改标题、切换分类，再看预览如何变化。</div>
        </div>
        <Chip size="sm" variant="soft" color="accent"><Chip.Label>HeroUI OSS</Chip.Label></Chip>
      </div>

      <Tabs className="min-w-0 gap-0" defaultSelectedKey="compose" variant="secondary">
        <Tabs.ListContainer className="mx-5 mt-3 sm:mx-6">
          <Tabs.List aria-label="HeroUI 展示内容">
            <Tabs.Tab id="compose">编辑与预览<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="states">样式与状态<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="compose" className="min-w-0 space-y-6 p-5 sm:p-6">
          <div className="grid min-w-0 gap-4 @min-[38rem]:grid-cols-[1.2fr_1fr]">
            <TextField className="min-w-0" value={title} onChange={value => {setTitle(value); trackDemoStart('heroui-showcase', 'title');}} isDisabled={!hydrated}>
              <Label>文章标题</Label>
              <Input className="min-w-0 w-full" maxLength={60} placeholder="为这篇文章起个名字" />
              <Description>最多 60 个字符，仅更新这张演示卡片。</Description>
            </TextField>
            <Select fullWidth className="min-w-0" value={topic} onChange={(value) => {setTopic(String(value)); trackDemoStart('heroui-showcase', 'topic');}} isDisabled={!hydrated}>
              <Label>文章分类</Label>
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover className={`${styles.surface} max-w-[calc(100vw-2rem)]`} data-demo="heroui-select-popover">
                <ListBox>
                  {topics.map((item) => <ListBox.Item key={item.id} id={item.id} textValue={item.label}>{item.label}<ListBox.ItemIndicator /></ListBox.Item>)}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Switch size="sm" isSelected={showTags} onChange={value => {setShowTags(value); trackDemoStart('heroui-showcase', 'tags');}} isDisabled={!hydrated}>
              <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>显示技术标签</Switch.Content>
            </Switch>
            <Button size="sm" variant="ghost" onPress={reset} isDisabled={!hydrated}>恢复示例</Button>
          </div>

          <Card className="min-w-0 gap-4 rounded-xl border border-border p-5 shadow-none" variant="secondary" data-testid="article-preview">
            <Card.Header className="gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><span>{category}</span><span aria-hidden="true">·</span><span>约 4 分钟阅读</span></div>
              <Card.Title className="m-0 text-xl leading-snug font-semibold wrap-anywhere" data-testid="preview-title">{title.trim() || '未命名文章'}</Card.Title>
              <Card.Description className="m-0 leading-relaxed">正文静态生成，交互按需加载。一个组件，既能嵌入文章，也能作为独立页面继续生长。</Card.Description>
            </Card.Header>
            <Card.Content>
              {showTags && <div className="flex flex-wrap gap-2" data-testid="preview-tags"><Chip size="sm" variant="soft"><Chip.Label>Astro</Chip.Label></Chip><Chip size="sm" variant="soft"><Chip.Label>React</Chip.Label></Chip><Chip size="sm" variant="soft"><Chip.Label>MDX</Chip.Label></Chip></div>}
            </Card.Content>
            <Card.Footer className="flex-wrap justify-between gap-3 border-t border-separator pt-4">
              <span className="text-xs text-muted">交互预览 · 未写入博客</span>
              <Button size="sm" variant={saved ? 'secondary' : 'primary'} isDisabled={!hydrated} aria-pressed={saved} onPress={() => {setSaved(!saved); setFeedback(saved ? '已取消本次收藏。' : '已在本次演示中收藏。'); trackDemoStart('heroui-showcase', 'save');}}>{saved ? '已收藏' : '收藏这篇'}</Button>
            </Card.Footer>
          </Card>
          <div className="text-xs leading-relaxed text-muted" role="status" aria-live="polite">{feedback}</div>
        </Tabs.Panel>

        <Tabs.Panel id="states" className="min-w-0 space-y-6 p-5 sm:p-6">
          <div>
            <div className="mb-3 text-sm font-medium">同一按钮，不同操作层级</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" isDisabled={!hydrated} onPress={() => showButtonFeedback('主操作：继续编辑。')}>继续编辑</Button>
              <Button size="sm" variant="secondary" isDisabled={!hydrated} onPress={() => showButtonFeedback('次要操作：已查看预览。')}>查看预览</Button>
              <Button size="sm" variant="outline" isDisabled={!hydrated} onPress={() => showButtonFeedback('描边操作：已选择导出示例。')}>导出示例</Button>
              <Button size="sm" variant="ghost" isDisabled={!hydrated} onPress={() => showButtonFeedback('轻量操作：稍后再看。')}>稍后再看</Button>
              <Button size="sm" variant="danger-soft" isDisabled={!hydrated} onPress={() => showButtonFeedback('危险操作样式演示，没有删除任何内容。')}>移除草稿</Button>
              <Button size="sm" isDisabled>暂不可用</Button>
            </div>
            <div className="mt-3 text-xs leading-relaxed text-muted" role="status" aria-live="polite">{feedback}</div>
          </div>
          <div className="border-t border-separator pt-5">
            <div className="mb-3 text-sm font-medium">有含义的状态标记</div>
            <div className="flex flex-wrap gap-2"><Chip size="sm" color="success" variant="soft"><Chip.Label>已就绪</Chip.Label></Chip><Chip size="sm" color="warning" variant="soft"><Chip.Label>待检查</Chip.Label></Chip><Chip size="sm" color="danger" variant="soft"><Chip.Label>需修复</Chip.Label></Chip><Chip size="sm" variant="soft"><Chip.Label>草稿</Chip.Label></Chip></div>
          </div>
          <Accordion className="min-w-0 border-t border-separator" allowsMultipleExpanded defaultExpandedKeys={['composition']}>
            <Accordion.Item id="composition">
              <Accordion.Heading><Accordion.Trigger>这些控件如何组合？<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
              <Accordion.Panel><Accordion.Body className="text-sm leading-relaxed text-muted">输入框、选择器与开关共用这棵 React 组件树的状态；Card 负责展示，Tabs 和 Accordion 组织内容，按钮与标签表达操作和状态。</Accordion.Body></Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item id="isolation">
              <Accordion.Heading><Accordion.Trigger>会改变其他文章的样式吗？<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
              <Accordion.Panel><Accordion.Body className="text-sm leading-relaxed text-muted">演示按需引入所用组件样式，局部样式读取 Book 的颜色变量；没有引入全局 Preflight。选择器的浮层也使用同一组颜色与间距。</Accordion.Body></Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Tabs.Panel>
      </Tabs>
      <noscript><div className="px-5 pb-4 text-sm text-muted">启用 JavaScript 后可以修改示例；初始预览仍可阅读。</div></noscript>
    </section>
  );
}
