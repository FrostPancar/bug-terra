import { chromium, devices } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--headless=new','--no-sandbox'],ignoreDefaultArgs:['--headless=old']});
const ctx = await b.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:devices['iPhone 13'].userAgent});
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('http://localhost:8899/'); await p.waitForTimeout(3500);
console.log(await p.evaluate(()=>{
  const btns=[...document.querySelectorAll('.glass-btn')];
  const f=document.getElementById('glass-filters');
  const b0=btns[0].getBoundingClientRect();
  return {
    count: btns.length,
    size: `${Math.round(b0.width)}x${Math.round(b0.height)}`,
    circular: btns.every(x=>{const r=x.getBoundingClientRect(); return Math.abs(r.width-r.height)<1;}),
    mode: btns.map(x=>x.dataset.glass).join(','),
    filters: f ? f.querySelectorAll('filter').length : 0,
    displacementPasses: f ? f.querySelectorAll('feDisplacementMap').length : 0,
    backdrop: getComputedStyle(btns[0]).backdropFilter,
    mapBytes: f ? (f.querySelector('feImage')?.getAttribute('href')||'').length : 0,
  };
}));
await p.tap('#pause'); await p.waitForTimeout(400);
console.log('pause ->', await p.evaluate(()=>{const b=document.getElementById('pause');
  return {pressed:b.getAttribute('aria-pressed'), label:b.querySelector('span').textContent, icon:b.querySelector('svg path').getAttribute('d').slice(0,10)};}));
await p.tap('#pause'); await p.waitForTimeout(300);
await p.tap('#breed'); await p.waitForTimeout(600);
console.log('breed -> gen', await p.textContent('#gen'));
await p.screenshot({path:'shots/glass-portrait.png'});
const el = await p.locator('.dial').boundingBox();
await p.screenshot({path:'shots/glass-dial.png', clip:{x:el.x-8,y:el.y-8,width:el.width+16,height:el.height+16}});
console.log('errors:', errs.slice(0,4).join(' | ')||'none');
await b.close();
