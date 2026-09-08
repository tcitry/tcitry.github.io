import {useEffect, useState} from 'react';
import {Button, Dropdown, Kbd, Tooltip} from '@heroui/react';
import type {BookTheme} from '@tcitry/astro-book/types';
import surfaceStyles from '../demos/DemoSurface.module.css';
import styles from './BlogSearch.module.css';
import './sidebar-tools.css';

const themes = [
  {id: 'auto', label: '跟随系统'},
  {id: 'light', label: '浅色'},
  {id: 'dark', label: '深色'},
] as const;

function ThemeIcon({theme}: {theme: BookTheme}) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {theme === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
      : theme === 'dark' ? <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" />
        : <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>}
  </svg>;
}

export default function SidebarTools({label = '搜索博客'}: {label?: string}) {
  const [theme, setTheme] = useState<BookTheme>('auto');
  const [isOpen, setOpen] = useState(false);
  const [modifier, setModifier] = useState<'command' | 'ctrl'>('ctrl');

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      const value = root.dataset.bookTheme;
      setTheme(value === 'light' || value === 'dark' ? value : 'auto');
    };
    sync();
    setModifier(/Mac|iPhone|iPad/.test(navigator.platform) ? 'command' : 'ctrl');
    const observer = new MutationObserver(sync);
    observer.observe(root, {attributes: true, attributeFilter: ['data-book-theme']});
    return () => observer.disconnect();
  }, []);

  const themeLabel = `外观：${themes.find(({id}) => id === theme)!.label}`;

  return <div className={`${surfaceStyles.surface} ${styles.tools}`} data-sidebar-tools data-book-island>
    <Button variant="ghost" className={styles.trigger} data-blog-search-trigger
      aria-haspopup="dialog" aria-label={label}
      onPress={({target}) => document.dispatchEvent(new CustomEvent('blog:open-search', {detail: target}))}
      render={(props) => <button {...props} aria-keyshortcuts="Meta+K Control+K" />}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" />
      </svg>
      <span>Search</span>
      <Kbd variant="light" className={styles.shortcut} aria-hidden="true">
        <Kbd.Abbr keyValue={modifier} /><Kbd.Content>K</Kbd.Content>
      </Kbd>
    </Button>
    <Dropdown isOpen={isOpen} onOpenChange={setOpen}>
      <Tooltip isDisabled={isOpen}>
        <Button isIconOnly variant="ghost" aria-label={themeLabel} className={styles.appearance} data-blog-theme-trigger>
          <ThemeIcon theme={theme} />
        </Button>
        <Tooltip.Content className={`${surfaceStyles.surface} ${styles.tooltip}`} placement="bottom">{themeLabel}</Tooltip.Content>
      </Tooltip>
      <Dropdown.Popover placement="bottom end" className={`${surfaceStyles.surface} ${styles.themeMenu}`} data-blog-theme-popover>
        <Dropdown.Menu aria-label="外观" selectionMode="single" disallowEmptySelection selectedKeys={[theme]}
          onAction={(key) => {
            if (!themes.some(({id}) => id === key)) return;
            document.dispatchEvent(new CustomEvent('astro-book:set-theme', {detail: key}));
            setOpen(false);
          }}>
          {themes.map(({id, label: name}) => <Dropdown.Item key={id} id={id} textValue={name}>
            <Dropdown.ItemIndicator />{name}
          </Dropdown.Item>)}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  </div>;
}
