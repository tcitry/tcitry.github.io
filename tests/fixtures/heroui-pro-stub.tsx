import {createContext, useContext, type ReactNode} from 'react';

function Passthrough({children}: {children?: ReactNode}) {
  return children ?? null;
}

export const EmptyState = Object.assign(function EmptyState({children}: {children?: ReactNode}) {
  return <div data-heroui-stub="empty-state">{children}</div>;
}, {
  Header: Passthrough,
  Title: ({children}: {children?: ReactNode}) => <h2>{children}</h2>,
  Description: ({children}: {children?: ReactNode}) => <p>{children}</p>,
  Content: Passthrough,
});

const SegmentContext = createContext<{
  selectedKey?: string;
  onSelectionChange?: (key: string) => void;
}>({});

export function Segment({children, selectedKey, onSelectionChange, 'aria-label': ariaLabel}: {
  children?: ReactNode; selectedKey?: string; onSelectionChange?: (key: string) => void; 'aria-label'?: string;
  size?: string; className?: string;
}) {
  return <SegmentContext.Provider value={{selectedKey, onSelectionChange}}>
    <div role="radiogroup" aria-label={ariaLabel}>{children}</div>
  </SegmentContext.Provider>;
}
Segment.Item = function Item({id, children}: {id: string; children?: ReactNode; className?: string}) {
  const {selectedKey, onSelectionChange} = useContext(SegmentContext);
  return <button type="button" role="radio" aria-checked={String(selectedKey) === String(id)}
    onClick={() => onSelectionChange?.(id)}>{children}</button>;
};

export function DropZone({children}: {children?: ReactNode}) {
  return <div data-heroui-stub="drop-zone">{children}</div>;
}
DropZone.Area = function Area({children, className}: {children?: ReactNode; className?: string; isDisabled?: boolean; onDrop?: (event: unknown) => void}) {
  return <div className={className}>{children}</div>;
};
DropZone.Trigger = function Trigger({children, ...props}: {children?: ReactNode; 'aria-label'?: string; 'aria-describedby'?: string; isDisabled?: boolean}) {
  return <button type="button" {...props}>{children}</button>;
};
