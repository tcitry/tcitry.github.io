import test from 'node:test';
import assert from 'node:assert/strict';
import {composerState, PRESETS, PRESENTATIONS, compileTeachingStream, validateTeachingSpec, quantityWidth} from './heroui-agent-composer-model.ts';

test('changing actual data preserves each value through tool result, patches and component payload', () => {
  for (const presentation of PRESENTATIONS) for (const preset of Object.values(PRESETS)) {
    const state = composerState(preset.quantities, presentation);
    assert.equal(state.accepted, true);
    assert.deepEqual(state.values, preset.quantities);
    assert.equal(state.data.total, preset.quantities.reduce((sum, value) => sum + value, 0));
    assert.deepEqual(compileTeachingStream(state.specStream), state.spec);
    const props = state.spec.elements['sales-view']!.props;
    const actual = presentation === 'bar-chart' ? (props.data as Array<{value: number}>).map(row => row.value)
      : presentation === 'metric-grid' ? [(props.metrics as Array<{value: number}>)[0]!.value]
      : (props.rows as Array<{quantity: number}>).map(row => row.quantity);
    assert.deepEqual(actual, presentation === 'metric-grid' ? [state.data.total] : preset.quantities);
  }
});

test('missing required quantity is rejected for all three teaching contracts and never displayed as zero', () => {
  for (const presentation of PRESENTATIONS) {
    const state = composerState(PRESETS.steady.quantities, presentation, true);
    assert.equal(state.accepted, false);
    assert.equal(state.data.rows[0]!.quantity, undefined);
    assert.equal(state.data.total, undefined);
    assert.equal(state.issues.length, 1);
    assert.match(state.issues[0]!.path, /\/(value|quantity)$/);
  }
});

test('zero is valid and fixed chart scale reflects values rather than rescaling every preset', () => {
  assert.equal(composerState([0, 0, 0, 0]).accepted, true);
  assert.equal(quantityWidth(24, 200), 48);
  assert.equal(quantityWidth(72, 200), 144);
  assert.equal(quantityWidth(0, 200), 0);
  for (const bad of [-1, 1.2, NaN, Infinity]) assert.equal(composerState([bad, 10, 20, 30]).accepted, false);
});

test('unregistered components, broken children, cyclic graphs and unsupported patches fail closed', () => {
  const spec = structuredClone(composerState().spec);
  spec.elements['sales-view']!.type = 'customer-react-component';
  assert.match(validateTeachingSpec(spec)[0]!.message, /registry/);
  const broken = structuredClone(composerState().spec);
  broken.elements['sales-layout']!.children = ['absent'];
  assert.match(validateTeachingSpec(broken)[0]!.message, /引用/);
  const cyclic = structuredClone(composerState().spec);
  cyclic.elements['sales-view']!.children = ['sales-layout'];
  assert.match(validateTeachingSpec(cyclic)[0]!.message, /循环/);
  assert.throws(() => compileTeachingStream('{"op":"remove","path":"/root"}'), /只接受 add/);
  assert.throws(() => compileTeachingStream('{"op":"add","path":"/unsupported","value":1}'), /不支持/);
});
