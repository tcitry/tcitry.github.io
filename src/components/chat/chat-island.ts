import type {ReactNode} from 'react';

type ChatIslandPanel = {node: ReactNode; target: HTMLElement | null};

type ChatIsland = {
  mount(target: HTMLElement, node: ReactNode): void;
};

let island: ChatIsland | undefined;
let panel: ChatIslandPanel = {node: null, target: null};
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function registerChatIsland(next: ChatIsland) {
  island = next;
  return () => {
    if (island !== next) return;
    island = undefined;
    panel = {node: null, target: null};
    emit();
  };
}

export function chatIsland() {
  return island;
}

export function subscribeChatIsland(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChatIslandPanel() {
  return panel;
}

export function setChatIslandPanel(next: ChatIslandPanel) {
  panel = next;
  emit();
}
