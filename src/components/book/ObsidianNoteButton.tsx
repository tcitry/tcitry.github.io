import FileText from '@gravity-ui/icons/FileText';
import {Button, Tooltip} from '@heroui/react';
import surfaceStyles from '../demos/DemoSurface.module.css';
import './obsidian-note-button.css';
import styles from './ObsidianNoteButton.module.css';

export default function ObsidianNoteButton({source}: {source: string}) {
  const href = `obsidian://open?vault=Blog&file=${encodeURIComponent(source)}`;
  const label = '在 Obsidian 打开笔记';

  return <div className={`${surfaceStyles.surface} ${styles.root}`} data-obsidian-note data-obsidian-href={href} data-book-island>
    <Tooltip delay={0}>
      <Button isIconOnly variant="secondary" size="lg" aria-label={label} className={styles.button}
        onPress={() => { window.location.assign(href); }}>
        <FileText />
      </Button>
      <Tooltip.Content className={`${surfaceStyles.surface} ${styles.tooltip}`} placement="left">{label}</Tooltip.Content>
    </Tooltip>
  </div>;
}
