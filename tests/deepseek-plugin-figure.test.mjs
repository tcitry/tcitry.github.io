import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const figure = readFileSync(new URL('../src/components/demos/DeepSeekPluginFigure.tsx', import.meta.url), 'utf8');

test('reader-facing Anatomy no longer offers the tool-web plugin figure', () => {
  assert.match(figure, /export default function DeepSeekPluginFigure/);
  assert.match(figure, /return\s*<><\/\s*>/);
  assert.equal(/\breturn null\b/.test(figure), false);
  assert.equal(/\b(window|document|localStorage)\b/.test(figure), false);
  assert.equal(figure.includes('tool-web'), false);
  assert.equal(figure.includes('对照条件'), false);
  assert.equal(figure.includes('移除 ctx.web'), false);
  assert.equal(figure.includes('只移除 HTTP provider'), false);
  assert.equal(figure.includes('显式 dispose consumer'), false);
  assert.equal(figure.includes('pluginFrame'), false);
  assert.equal(figure.includes('MechanismPlayer'), false);
});

test('tool-web figure geometry, model, styles, and painter fixtures are removed', () => {
  for (const path of [
    '../src/components/demos/deepseek-plugin-model.ts',
    '../src/components/demos/deepseek-plugin-geometry.ts',
    '../src/components/demos/deepseek-plugin-order.json',
    '../src/components/demos/DeepSeekPluginFigure.module.css',
    '../scripts/audit-deepseek-plugin.mjs',
  ]) {
    assert.throws(() => readFileSync(new URL(path, import.meta.url)), {code: 'ENOENT'}, path);
  }
});
