import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../..',import.meta.url));
const cacheDir=await mkdtemp(join(tmpdir(),'lieflat-ui-'));
const server=await createServer({root,configFile:false,envDir:false,publicDir:false,cacheDir,plugins:[react(),tailwind()],optimizeDeps:{entries:['tests/fixtures/lieflat-examples.html']},server:{host:'127.0.0.1',port:0},logLevel:'warn'});
let browser;
try {
  await server.listen();
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1000,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('/tests/fixtures/lieflat-examples.html',server.resolvedUrls.local[0]).href);
  for(const id of ['tick-rows','f2','l14','f12'])await page.locator(`[data-demo="lieflat-${id}"][data-hydrated="true"]`).waitFor();
  const ticks=page.locator('[data-demo="lieflat-tick-rows"]');
  const count=ticks.getByRole('slider',{name:'内容校对',exact:true});
  await count.focus();await count.press('Home');await count.press('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('[data-chart-total]').textContent==='23');
  await ticks.getByRole('button',{name:'重置',exact:true}).click();
  const line=page.locator('[data-demo="lieflat-f2"]');
  await line.getByRole('button',{name:'全部为 0',exact:true}).click();
  assert.equal(await line.locator('[data-daily-point]').count(),14);
  assert.match(await line.locator('[data-example-summary]').textContent(),/最高 0 人/);
  await line.getByRole('slider',{name:'起始人数',exact:true}).focus();
  await line.getByRole('slider',{name:'起始人数',exact:true}).press('ArrowRight');
  assert.match(await line.locator('[data-example-summary]').textContent(),/首日 1 人/);
  await line.getByRole('button',{name:'重置',exact:true}).click();
  const hundred=page.locator('[data-demo="lieflat-l14"]');
  await hundred.getByRole('button',{name:'全部完成',exact:true}).click();
  assert.equal(await hundred.locator('[data-unit-dot]').count(),100);
  assert.deepEqual(await hundred.locator('[data-cluster]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.value))),[100,0,0,0]);
  assert.ok(!(await hundred.innerHTML()).includes('NaN'));
  await hundred.getByRole('button',{name:'平均四份',exact:true}).click();
  assert.deepEqual(await hundred.locator('[data-cluster]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.value))),[25,25,25,25]);
  const dumbbell=page.locator('[data-demo="lieflat-f12"]');
  await dumbbell.getByRole('button',{name:'用时不变',exact:true}).click();
  assert.equal(await dumbbell.locator('[data-difference-bead]').count(),0);
  await dumbbell.getByRole('button',{name:'全部变慢',exact:true}).click();
  assert.equal(await dumbbell.locator('[data-difference-bead]').count(),24);
  for(const demo of [line,hundred,dumbbell])await demo.getByRole('button',{name:'重置',exact:true}).click();
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile page overflow');
    for(const demo of [ticks,line,hundred,dumbbell]) {
      await demo.scrollIntoViewIfNeeded();
      assert.ok(await demo.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'component overflow');
    }
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await line.getByRole('button',{name:'重播动画',exact:true}).click();
  assert.equal(await line.locator('svg').evaluate(svg=>svg.getAnimations({subtree:true}).length),0);
  assert.deepEqual(errors,[]);
  await page.setViewportSize({width:390,height:900});
  await hundred.scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/lieflat-cellslider-mobile.png'});
  console.log('Lieflat browser checks passed: CellSlider keyboard controls, 4 diagrams, presets, 320/390px layout, reduced motion and no browser errors.');
} finally {await browser?.close();await server.close();await rm(cacheDir,{recursive:true,force:true});}
