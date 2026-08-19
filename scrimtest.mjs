import { chromium, devices } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--headless=new','--no-sandbox'],ignoreDefaultArgs:['--headless=old']});
const ctx = await b.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:devices['iPhone 13'].userAgent});
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('http://localhost:8899/'); await p.waitForTimeout(3500);

const info = await p.evaluate(()=>{
  const sc = document.getElementById('scrim');
  const cs = getComputedStyle(sc);
  const as = getComputedStyle(document.querySelector('aside'));
  return { blend: cs.mixBlendMode, scrimH: Math.round(sc.getBoundingClientRect().height),
           asideBg: as.backgroundColor, asideBorder: as.borderTopWidth, asideShadow: as.boxShadow,
           blocks: [...document.querySelectorAll('.block')].map(b=>getComputedStyle(b).borderTopWidth).join(',') };
});
console.log('scrim  ', JSON.stringify(info));

// swipe up from the collapsed state
await p.evaluate(()=>document.body.classList.add('sheet-collapsed'));
await p.waitForTimeout(500);
const before = await p.evaluate(()=>document.body.className);
const cx = 196, cy = 800;
await p.touchscreen.tap(cx, cy);
await p.evaluate(()=>{ 
  const el=document.querySelector('aside');
  const mk=(t,y)=>new TouchEvent(t,{bubbles:true,cancelable:true,touches:[new Touch({identifier:1,target:el,clientX:196,clientY:y})]});
  el.dispatchEvent(mk('touchstart',820));
  el.dispatchEvent(mk('touchmove',770));
  el.dispatchEvent(mk('touchmove',700));
  el.dispatchEvent(mk('touchend',700));
});
await p.waitForTimeout(700);
console.log('swipe up  ', before, '->', await p.evaluate(()=>document.body.className||'expanded'));
await p.screenshot({path:'shots/scrim-expanded.png'});

await p.evaluate(()=>{
  const el=document.querySelector('aside');
  const mk=(t,y)=>new TouchEvent(t,{bubbles:true,cancelable:true,touches:[new Touch({identifier:1,target:el,clientX:196,clientY:y})]});
  el.dispatchEvent(mk('touchstart',560));
  el.dispatchEvent(mk('touchmove',610));
  el.dispatchEvent(mk('touchmove',680));
  el.dispatchEvent(mk('touchend',680));
});
await p.waitForTimeout(700);
console.log('swipe down->', await p.evaluate(()=>document.body.className||'expanded'));
await p.screenshot({path:'shots/scrim-collapsed.png'});
console.log('errors:', errs.slice(0,3).join('|')||'none');
await b.close();
