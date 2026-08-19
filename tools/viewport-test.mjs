import { chromium, devices } from 'playwright';

const CASES = [
  { name: 'iphone-se-portrait',   vp:{width:375,height:667},  m:true },
  { name: 'iphone14-portrait',    vp:{width:393,height:852},  m:true },
  { name: 'pixel7-portrait',      vp:{width:412,height:915},  m:true },
  { name: 'iphone14-landscape',   vp:{width:852,height:393},  m:true },
  { name: 'ipad-portrait',        vp:{width:820,height:1180}, m:true },
  { name: 'desktop',              vp:{width:1440,height:900}, m:false },
];

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
  args:['--headless=new','--no-sandbox'], ignoreDefaultArgs:['--headless=old'] });

let fail = 0;
for (const c of CASES) {
  const ctx = await b.newContext({
    viewport: c.vp,
    deviceScaleFactor: c.m ? 3 : 1,
    isMobile: c.m,
    hasTouch: c.m,
    userAgent: c.m ? devices['iPhone 13'].userAgent : undefined,
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await p.goto('http://localhost:8899/');
  await p.waitForTimeout(3500);

  const info = await p.evaluate(() => {
    const cv = document.querySelector('canvas');
    const cr = cv.getBoundingClientRect();
    const st = document.getElementById("canvasHost").getBoundingClientRect();
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    // are all controls inside the viewport?
    const ids = ['breed','ff','reseed','pause','preset','pop','tscale'];
    const offscreen = ids.filter(id => {
      const r = document.getElementById(id).getBoundingClientRect();
      return r.width===0 || r.right > window.innerWidth+1 || r.left < -1;
    });
    // touch target sizes
    const small = ids.filter(id => {
      const r = document.getElementById(id).getBoundingClientRect();
      return r.height > 0 && r.height < 32;
    });
    return {
      canvas: `${Math.round(cr.width)}x${Math.round(cr.height)}`,
      stageBox: `${Math.round(st.width)}x${Math.round(st.height)}`,
      worldAspect: +(cr.width/cr.height).toFixed(2),
      stageAspect: +(st.width/st.height).toFixed(2),
      canvasFits: cr.width <= st.width+1 && cr.height <= st.height+1,
      fillsStage: +(((cr.width*cr.height)/(st.width*st.height))*100).toFixed(0),
      sheet: document.body.classList.contains('sheet-collapsed') ? 'collapsed' : 'expanded',
      // does the panel physically cover the canvas?
      occluded: (() => {
        const a = document.querySelector('aside').getBoundingClientRect();
        const ox = Math.max(0, Math.min(a.right, cr.right) - Math.max(a.left, cr.left));
        const oy = Math.max(0, Math.min(a.bottom, cr.bottom) - Math.max(a.top, cr.top));
        return +(((ox * oy) / (cr.width * cr.height)) * 100).toFixed(0);
      })(),
      handleVisible: getComputedStyle(document.getElementById('handle')).display !== 'none',
      hpageOverflow: overflow, offscreen, small,
      alive: document.getElementById('alive').textContent,
    };
  });

  // tap a bug in the middle of the canvas area
  const box = await p.locator('canvas').boundingBox();
  await p.mouse.click(box.x + box.width/2, box.y + box.height/2);
  await p.waitForTimeout(600);

  await p.screenshot({ path: `/root/bugsim/shots/${c.name}.png` });
  const bad = errs.length || !info.canvasFits || info.hpageOverflow
            || info.offscreen.length || info.small.length || info.fillsStage < 55
            || info.occluded > 2;
  if (bad) fail++;
  console.log(`${bad?'FAIL':'ok  '} ${c.name.padEnd(20)} canvas ${info.canvas.padEnd(10)} stage ${info.stageBox.padEnd(10)} fill ${String(info.fillsStage).padStart(3)}% aspect ${info.worldAspect}/${info.stageAspect} sheet=${info.sheet} occl ${String(info.occluded).padStart(3)}% alive=${info.alive}`);
  if (errs.length) console.log(`     errors: ${errs.slice(0,3).join(' | ')}`);
  if (info.offscreen.length) console.log(`     offscreen controls: ${info.offscreen}`);
  if (info.small.length) console.log(`     small targets: ${info.small}`);
  if (info.hpageOverflow) console.log('     horizontal page overflow');
  await ctx.close();
}
console.log(fail ? `\n${fail} case(s) failed` : '\nall viewports clean');
await b.close();
