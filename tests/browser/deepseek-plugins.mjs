import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';

const output=process.env.BLOG_SCREENSHOT_DIR;
if(output)await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const errors=[];
const path='/docs/AI/Agents/deepseek-harness-plugin-architecture/';
async function open(options={}){
  const context=await browser.newContext({viewport:{width:1280,height:1100},reducedMotion:'no-preference',...options});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL(path,process.env.BLOG_TEST_URL??'http://127.0.0.1:4321').href,{waitUntil:'domcontentloaded'});
  const root=page.locator('[data-demo="deepseek-plugins"]');
  const stage=root.locator('[data-mechanism-stage]');
  await stage.scrollIntoViewIfNeeded();await root.locator('[data-hydrated="true"]').waitFor();
  await page.mouse.move(1,1);
  return {context,page,root,stage};
}
async function seek(scene,p){
  await scene.root.locator('[data-motion-seek]').evaluate((node,value)=>{node.value=String(value*1000);node.dispatchEvent(new Event('input',{bubbles:true}));},p);
}
async function shot(scene,name){if(output)await scene.root.screenshot({path:join(output,`${name}.png`)});}
try{
  const s=await open(output?{recordVideo:{dir:join(output,'video'),size:{width:1280,height:1100}}}:{});
  await s.page.waitForFunction(()=>document.querySelector('[data-demo="deepseek-plugins"] [data-mechanism-stage]')?.dataset.playing==='true');
  const start=Number(await s.stage.getAttribute('data-progress'));
  await s.page.waitForTimeout(5800);
  assert.ok(Number(await s.stage.getAttribute('data-progress'))>start+.25,'normal animation must advance');
  assert.notEqual(await s.root.locator('[data-part="sled-1"]').getAttribute('transform'),'translate(0 0)');
  await s.root.locator('select').selectOption('0.25');
  const slowStart=Number(await s.stage.getAttribute('data-progress'));
  await s.page.mouse.move(1,1);await s.page.waitForTimeout(1200);
  const slowAdvance=Number(await s.stage.getAttribute('data-progress'))-slowStart;
  assert.ok(slowAdvance>0 && slowAdvance<.05,'quarter speed moves continuously');
  await seek(s,.5);assert.equal(await s.stage.getAttribute('data-consumer'),'PENDING');
  assert.equal(await s.stage.getAttribute('data-tools'),'0');await shot(s,'service-missing-light');
  // Inspect a contact and its withdrawal at a real intermediate position.
  await seek(s,.32);await shot(s,'cleanup-intermediate');
  await seek(s,1);assert.equal(await s.stage.getAttribute('data-consumer'),'ACTIVE');
  assert.equal(await s.stage.getAttribute('data-tools'),'2');
  await s.root.getByRole('button',{name:'只移除 HTTP provider',exact:true}).click();
  await seek(s,.5);assert.equal(await s.stage.getAttribute('data-consumer'),'ACTIVE');
  assert.equal(await s.stage.getAttribute('data-tools'),'2');assert.equal(await s.stage.getAttribute('data-fetch-backend'),'false');
  assert.match(await s.root.locator('[data-motion-caption]').textContent(),/定义仍在 registry/);
  await s.page.evaluate(()=>document.dispatchEvent(new CustomEvent('astro-book:set-theme',{detail:'dark'})));
  await shot(s,'provider-missing-dark');
  await s.root.getByRole('button',{name:'显式 dispose consumer',exact:true}).click();
  await seek(s,1);assert.equal(await s.stage.getAttribute('data-consumer'),'DISPOSED');
  assert.equal(await s.stage.getAttribute('data-tools'),'0');
  // Keyboard control acts on the same model, and offscreen animation stops.
  await s.stage.focus();await s.page.keyboard.press('Home');
  assert.equal(await s.stage.getAttribute('data-progress'),'0.0000');
  await s.page.keyboard.press('End');assert.equal(await s.stage.getAttribute('data-progress'),'1.0000');
  await s.root.getByRole('button',{name:'移除 ctx.web',exact:true}).click();
  await seek(s,.1);await s.root.locator('[data-motion-toggle]').click();
  await s.page.evaluate(()=>scrollTo(0,0));await s.page.waitForTimeout(400);
  const parked=await s.stage.getAttribute('data-progress');await s.page.waitForTimeout(400);
  assert.equal(await s.stage.getAttribute('data-progress'),parked);
  assert.equal(await s.page.locator('.mermaid svg').count(),4);
  assert.equal(await s.page.locator('.mermaid-error').count(),0);
  await s.context.close();

  const small=await open({viewport:{width:390,height:844},reducedMotion:'reduce',colorScheme:'light'});
  assert.equal(await small.stage.getAttribute('data-motion'),'reduced');
  await seek(small,.5);assert.equal(await small.stage.getAttribute('data-consumer'),'PENDING');
  await small.page.waitForTimeout(200);assert.equal(await small.stage.getAttribute('data-progress'),'0.5000');
  assert.ok(await small.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phone has no horizontal overflow');
  await shot(small,'mobile-reduced');await small.context.close();
  assert.deepEqual(errors,[]);
  console.log('DeepSeek Figure: normal motion, intermediate pose, three counterexamples, keyboard, offscreen pause, reduced motion, phone, themes and four Mermaid figures passed.');
}finally{await browser.close();}
