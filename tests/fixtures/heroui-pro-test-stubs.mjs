import {access, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const cssNames = [
  'drop-zone.css',
  'chat-conversation.css',
  'chat-message.css',
  'chat-message-actions.css',
  'chat-source.css',
  'chat-loader.css',
  'prompt-input.css',
  'prompt-suggestion.css',
  'code-block.css',
  'segment.css',
  'empty-state.css',
  'chain-of-thought.css',
  'text-shimmer.css',
  'inline-select.css',
  'rating.css',
  'cell-slider.css',
  'command.css',
  'timeline.css',
  'native-select.css',
  'item-card.css',
];

export async function installHeroUiProCssStubs() {
  const dir = fileURLToPath(new URL('../../node_modules/@heroui-pro/react/css/components/', import.meta.url));
  await mkdir(dir, {recursive: true});
  await Promise.all(cssNames.map(async name => {
    const path = join(dir, name);
    try { await access(path); }
    catch { await writeFile(path, '/* test stub */\n'); }
  }));
}

export function herouiProAliases(stubFile) {
  return [
    {find: '@heroui-pro/react/empty-state', replacement: stubFile},
    {find: '@heroui-pro/react/segment', replacement: stubFile},
    {find: /^@heroui-pro\/react$/, replacement: stubFile},
  ];
}
