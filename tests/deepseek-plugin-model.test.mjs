import test from 'node:test';
import assert from 'node:assert/strict';
import {pluginFrame} from '../src/components/demos/deepseek-plugin-model.ts';

test('required service loss cleans registrations and returns the retained consumer to pending',()=>{
  const absent=pluginFrame(.5,'service');
  assert.equal(absent.consumer,'PENDING');assert.equal(absent.webService,false);assert.equal(absent.tools,0);
  const restored=pluginFrame(1,'service');
  assert.equal(restored.consumer,'ACTIVE');assert.equal(restored.tools,2);
});
test('provider removal preserves service and definitions but changes execution availability',()=>{
  const absent=pluginFrame(.5,'backend');
  assert.equal(absent.consumer,'ACTIVE');assert.equal(absent.webService,true);assert.equal(absent.tools,2);
  assert.equal(absent.fetchBackend,false);assert.match(absent.call,/不可用/);
  assert.equal(pluginFrame(1,'backend').fetchBackend,true);
});
test('explicit disposal remains terminal even after the restoration phase',()=>{
  for(const p of [.5,.75,1]){const disposed=pluginFrame(p,'dispose');assert.equal(disposed.consumer,'DISPOSED');assert.equal(disposed.tools,0);assert.equal(disposed.webService,true);}
});
