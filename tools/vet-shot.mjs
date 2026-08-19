import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
  args:['--headless=new','--no-sandbox'], ignoreDefaultArgs:['--headless=old'] });
const ctx = await b.newContext({ viewport:{width:412,height:915}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto('http://localhost:8899/');
await p.waitForTimeout(3000);

// expand the sheet and select a bug through the scene API
await p.evaluate(() => document.body.classList.remove('sheet-collapsed'));
await p.evaluate(() => {
  const s = window.__terrarium.scene;
  s.selected = s.bugs[0];
  // buy some knowledge so the panel has something to say
  for (const bug of s.bugs) s.knowledge.observe(bug.genome, 900);
  s.knowledge.fought(s.bugs[0].genome, { won: true });
  for (let i=0;i<8;i++) s.knowledge.fought(s.bugs[0].genome, { won: i%2===0 });
  s.emitState();
});
await p.waitForTimeout(700);
await p.locator('#inspect').scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
await p.locator('#inspect').screenshot({ path: 'shots/panel-observed.png' });

const before = await p.evaluate(() => window.__terrarium.scene.bugs.length);
await p.click('#vetSend');
await p.waitForTimeout(900);
const after = await p.evaluate(() => window.__terrarium.scene.bugs.length);
await p.locator('#vetBlock').screenshot({ path: 'shots/vet-station.png' });
console.log('bugs before/after vet:', before, after);
console.log('away:', await p.evaluate(() => window.__terrarium.scene.atVet.length));
console.log('panel has a stat number?',
  await p.evaluate(() => /\b\d{2,3}\.\d\b/.test(document.querySelector('#inspect').textContent)));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
