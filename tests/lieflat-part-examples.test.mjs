import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({entryPoints: ['src/components/demos/lieflat-part-examples.ts'], bundle: true, platform: 'node', format: 'esm', write: false});
const {buildHundredField, HUNDRED_DEFAULTS} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('Hundred Field counts percentage points without inventing people or normalizing invalid shares', () => {
  const chart = buildHundredField(HUNDRED_DEFAULTS);
  assert.equal(chart.unit, 'percentage-point');
  assert.deepEqual(chart.clusters.map(cluster => cluster.dots.length), [41, 35, 12, 12]);
  assert.equal(chart.clusters.flatMap(cluster => cluster.dots).length, 100);
  assert.equal(chart.maximum, 41);
  assert.deepEqual(buildHundredField([25, 25, 25]).leaders, ['已完成', '进行中', '待开始', '已取消']);
  for (const shares of [[100, 0, 0], [0, 0, 0], [0, 100, 0], [0, 0, 100]]) {
    const result = buildHundredField(shares);
    assert.equal(result.clusters.flatMap(cluster => cluster.dots).length, 100);
    for (const cluster of result.clusters) {
      assert.equal(cluster.dots.length, cluster.value);
      assert.ok(cluster.labelY < 265);
      for (const dot of cluster.dots) {
        assert.ok(dot.x > 0 && dot.x < 360 && dot.y > 0 && dot.y < 270);
      }
    }
  }
  assert.deepEqual(buildHundredField(HUNDRED_DEFAULTS), chart, 'point texture must not move after SSR hydration');
  for (const shares of [[60, 60, 0], [-1, 50, 0], [33.3, 33.3, 33.4], [NaN, 0, 0], [50, 50]]) assert.throws(() => buildHundredField(shares));
});
