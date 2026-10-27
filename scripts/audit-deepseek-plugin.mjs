/** Recheck the Figure's actual slab geometry against the project's pinned Anatomy auditor.
 * BLOG_DIR=/path/to/Blog node scripts/audit-deepseek-plugin.mjs [--write]
 * Sampled poses verify painter order; this is not a proof of every continuous pose.
 */
import {build} from 'esbuild';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const blog=process.env.BLOG_DIR;
assert.ok(blog,'Set BLOG_DIR to the Blog checkout containing .agents/skills/anatomy');
const A=await import(pathToFileURL(resolve(blog,'.agents/skills/anatomy/kit/audit.mjs')));
const temp=await mkdtemp(join(tmpdir(),'dsh-geometry-'));
try {
  const output=join(temp,'art.mjs');
  await build({stdin:{contents:"export * from './src/components/demos/deepseek-plugin-geometry.ts'; export * from './src/components/demos/deepseek-plugin-model.ts'; export {solidSvg} from './src/components/demos/anatomy-iso-kit.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:output});
  const {DEEPSEEK_PARTS:parts,PLUGIN_CAMERA:P,pluginFrame,solidSvg}=await import(pathToFileURL(output));
  const R=A.recorder(P);
  for(const part of parts){
    const move=part.group==='service'||part.group==='backend'?[0,0,58]:part.group==='consumer'?[0,-12,36]:[0,0,0];
    const shape=R.solid(A.slab(part.plan,part.z,part.h,{name:part.id},4));
    R.put({name:part.id,key:part.key,piece:part.group,ride:part.group,move,shapes:[shape],svg:solidSvg(part.paths)});
  }
  const states=[];
  for(const scenario of ['service','backend','dispose'])for(let n=0;n<=40;n++){
    const s=pluginFrame(n/40,scenario);
    states.push({label:`${scenario}:${n/40}`,shares:{service:scenario==='service'?s.removed:0,backend:s.removed*(scenario==='service'?1:scenario==='backend'?28/58:0),consumer:s.cleaned}});
  }
  const before=A.depthOrder(R.items,P,{states,step:.5,tolerance:.2,least:.5,rest:states});
  if(process.argv.includes('--write')){
    const result=A.settle(R,P,{states,step:.5,tolerance:.2,least:.5});
    assert.equal(A.depthOrder(result.items,P,{overlaps:result.overlaps,solved:result.solved,rest:states}).problems.length,0);
    await writeFile('src/components/demos/deepseek-plugin-order.json',JSON.stringify(Object.fromEntries(result.items.map(i=>[i.name,Number(i.key.toFixed(6))])),null,2)+'\n');
  } else {
    assert.deepEqual(before.missing,[]);assert.deepEqual(before.problems,[],'Regenerate painter keys after changing geometry');
    const order=JSON.parse(await readFile('src/components/demos/deepseek-plugin-order.json','utf8'));
    assert.equal(Object.keys(order).length,parts.length);
  }
  console.log(`Anatomy painter order passed: ${parts.length} exact slab shapes, ${states.length} sampled poses, raster step 0.5.`);
} finally {await rm(temp,{recursive:true,force:true});}
