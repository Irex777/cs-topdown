// Native Chrome suites run sequentially so pointer lock and frame-rate checks
// have exclusive access to the browser/GPU during this graphics revision.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
const results=[];
for (const suite of ['browsercheck','vehiclebrowser','crew-browser','verticalbrowser','elevationbrowser','artreview','modelreview']) {
  console.log('Running',suite);
  const log=createWriteStream(`output/qa/world-final-${suite}.log`);
  const child=spawn(process.execPath,[`tools/${suite}.mjs`],{stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log);child.stderr.pipe(log);
  const exit=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});
  log.end();results.push({suite,exit});
  await writeFile('output/qa/world-final-suites.json',JSON.stringify(results,null,2));
  if(exit!==0) {console.error('Failed',suite,`See output/qa/world-final-${suite}.log`);process.exitCode=1;break;}
  console.log('Passed',suite);
}
