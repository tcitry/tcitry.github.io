import {Button, Dropdown} from '@heroui/react';
import type {Doc} from '../../../convex/_generated/dataModel';
import surface from '../demos/DemoSurface.module.css';
import './reader.css';

export type ReadingStatus = Doc<'readingMarks'>['status'];
export const readingLabels: Record<ReadingStatus, string> = {
  later: '稍后读', skimmed: '已粗读', read: '已细读', studied: '已精读',
};

export default function ReadingStatusMenu({value, emptyLabel, label, onChange, disabled, pending, container}: {
  value: ReadingStatus | null; emptyLabel: string; label: string;
  onChange: (status: ReadingStatus | null) => void; disabled?: boolean; pending?: boolean;
  container?: HTMLElement | null;
}) {
  const options = [{id: 'none', label: emptyLabel}, ...Object.entries(readingLabels).map(([id, label]) => ({id, label}))];
  return <Dropdown>
    <Button size="sm" variant="outline" isDisabled={disabled} isPending={pending}
      aria-label={`${label}：${value ? readingLabels[value] : emptyLabel}`}>
      {value ? readingLabels[value] : emptyLabel}
    </Button>
    <Dropdown.Popover className={surface.surface} placement="bottom end" UNSTABLE_portalContainer={container ?? undefined} data-sentry-mask data-pagefind-ignore>
      <Dropdown.Menu aria-label={label} selectionMode="single" disallowEmptySelection selectedKeys={[value ?? 'none']}
        onAction={key => {
          if (key === 'none') onChange(null);
          else if (Object.hasOwn(readingLabels, key)) onChange(key as ReadingStatus);
        }}>
        {options.map(option => <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
          <Dropdown.ItemIndicator />{option.label}
        </Dropdown.Item>)}
      </Dropdown.Menu>
    </Dropdown.Popover>
  </Dropdown>;
}
