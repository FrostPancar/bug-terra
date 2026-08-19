import { chromium, devices } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--headless=new','--no-sandbox'],ignoreDefaultArgs:['--headless=old']});
const ctx = await b.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:devices['iPhone 13'].userAgent});
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8899/'); await p.waitForTimeout(4000);
console.log(await p.evaluate(()=>{
  const t = window.__terrarium.scene;
  return t.bugs.map(b=>`${b.kind.padEnd(10)} r=${Math.round(b.radius)} frame=${b.sheet.frameW} size=${b.stats.size.toFixed(2)} legs=${b.genome.leg_count} wings=${b.genome.wing_count} eyes=${b.genome.eye_count}`).join('\n');
}));
await p.evaluate(()=>document.body.classList.add('sheet-collapsed'));
await p.waitForTimeout(900);
await p.screenshot({path:'shots/ingame-diverse.png'});
console.log('errors:', errs.join('|')||'none');
await b.close();
