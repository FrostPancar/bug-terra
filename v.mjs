import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--headless=new','--no-sandbox'], ignoreDefaultArgs:['--headless=old'] });
for (const path of ['/','/dev.html']) {
  const p = await b.newPage({viewport:{width:1400,height:800}});
  const e=[]; p.on('pageerror',x=>e.push(x.message)); p.on('console',m=>{if(m.type()==='error')e.push(m.text())});
  await p.goto('http://localhost:8899'+path); await p.waitForTimeout(4000);
  console.log(path, JSON.stringify(await p.evaluate(()=>({alive:document.getElementById('alive').textContent}))), 'errors:', e.join('|')||'none');
  await p.close();
}
await b.close();
