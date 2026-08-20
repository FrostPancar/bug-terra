import { chromium, devices } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
  args:['--headless=new','--no-sandbox'], ignoreDefaultArgs:['--headless=old'] });
const ctx = await b.newContext({ viewport:{width:393,height:852}, deviceScaleFactor:3,
  isMobile:true, hasTouch:true, userAgent: devices['iPhone 13'].userAgent });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
const box = async () => p.evaluate(()=>{const c=document.querySelector('canvas').getBoundingClientRect();
  const h=document.getElementById('canvasHost').getBoundingClientRect();
  return {c:`${Math.round(c.width)}x${Math.round(c.height)}`, fill:+(((c.width*c.height)/(h.width*h.height))*100).toFixed(0)};});

await p.goto('http://localhost:8899/'); await p.waitForTimeout(3000);
console.log('start        ', JSON.stringify(await box()));

// collapse sheet
await p.tap('#handle'); await p.waitForTimeout(900);
console.log('collapsed    ', JSON.stringify(await box()), 'class=', await p.evaluate(()=>document.body.className||'expanded'));
await p.screenshot({path:'shots/dyn-collapsed.png'});

// expand again
await p.tap('#handle'); await p.waitForTimeout(900);
console.log('expanded     ', JSON.stringify(await box()));
await p.screenshot({path:'shots/dyn-expanded.png'});

// rotate to landscape
await p.setViewportSize({width:852,height:393}); await p.waitForTimeout(1400);
console.log('landscape    ', JSON.stringify(await box()));
await p.screenshot({path:'shots/dyn-landscape.png'});

// back to portrait
await p.setViewportSize({width:393,height:852}); await p.waitForTimeout(1400);
console.log('portrait     ', JSON.stringify(await box()));

// breed via tap
const g0 = await p.textContent('#gen');
await p.tap('#breed'); await p.waitForTimeout(700);
const g1 = await p.textContent('#gen');
console.log(`breed tap    gen ${g0} -> ${g1}`);

// pause toggles (the button is icon-only now, so read what it announces)
await p.tap('#pause'); await p.waitForTimeout(300);
console.log('pause label  ', await p.getAttribute('#pause','aria-label'));
await p.tap('#pause'); await p.waitForTimeout(300);

// build -> place a burrow entrance -> go under -> come back up
await p.tap('#build'); await p.waitForTimeout(400);
await p.tap('.tile.feature'); await p.waitForTimeout(300);
const cb = await p.locator('canvas').boundingBox();
await p.tap('canvas', { position:{ x: cb.width*0.5, y: cb.height*0.4 } }); await p.waitForTimeout(400);
await p.tap('#modeDone'); await p.waitForTimeout(300);
await p.tap('#burrow'); await p.waitForTimeout(600);
console.log('burrow mode  ', await p.evaluate(()=>window.__terrarium.scene.mode));
await p.screenshot({path:'shots/burrow.png'});
await p.tap('#surface'); await p.waitForTimeout(500);
console.log('surfaced     ', await p.evaluate(()=>window.__terrarium.scene.mode));

// run a while to catch leaks / late errors
await p.waitForTimeout(4000);
const stats = await p.evaluate(()=>({ textures: Object.keys(window.game?.textures?.list||{}).length }));
console.log('errors       ', errs.slice(0,5).join(' | ')||'none');
await b.close();
