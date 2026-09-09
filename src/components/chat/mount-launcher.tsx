import {createRoot} from 'react-dom/client';
import ChatLauncherFace from './ChatLauncherFace';

export function mountLauncher(target: HTMLElement, launcher: HTMLElement) {
  const root = createRoot(target);
  root.render(<ChatLauncherFace launcher={launcher} />);
  return {destroy: () => root.unmount()};
}
