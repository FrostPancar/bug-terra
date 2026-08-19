import { chromium, devices } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--headless=new','--no-sandbox'],ignoreDefaultArgs:['--headless=old']});
const ctx = await b.newContext({viewport:{width:820,height:1180},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:devices['iPad Pro 11'].userAgent});
const p = await ctx.newPage();
await p.goto('http://localhost:8899/'); await p.waitForTimeout(4000);
console.log(await p.evaluate(()=>{
  const t=window.__terrarium;
  const c=document.querySelector('canvas').getBoundingClientRect();
  const a=document.querySelector('aside').getBoundingClientRect();
  const scale=c.height/t.WORLD.h;
  return {
    worldH: t.WORLD.h, inset: Math.round(t.scene.insetBottom), playH: Math.round(t.scene.playHeight),
    canvasTop: Math.round(c.top), canvasBottom: Math.round(c.bottom), canvasH: Math.round(c.height),
    asideTop: Math.round(a.top), asideH: Math.round(a.height),
    playBottomCss: Math.round(c.top + t.scene.playHeight*scale),
    gap: Math.round(a.top - (c.top + t.scene.playHeight*scale)),
  };
}));
await b.close();
