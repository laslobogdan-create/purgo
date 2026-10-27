// Dev-only: renders the mobile UI with demo data in Chromium and saves phone-sized screenshots.
const { chromium } = require('playwright');
const path = require('path');
const steps = require(path.resolve(process.argv[2]));
const out = process.argv[3];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  for (const run of steps) {
    await page.addInitScript(s => { window.DEMO_SPEED = s.speed || 2; window.DEMO_ENV = s.env || null; try { if (s.onb) localStorage.setItem('purgo.onb', '1'); else localStorage.removeItem('purgo.onb'); } catch (e) {} }, run);
    await page.goto('file://' + path.resolve(__dirname, '../app/src/main/assets/www/index.html'));
    for (const s of run.steps) {
      if (s.js) { try { await page.evaluate(s.js); } catch (e) { console.log('JS ERR', s.js.slice(0, 60), e.message); } }
      if (s.tap) { try { await page.tap(s.tap, { timeout: 3000 }); } catch (e) { console.log('TAP ERR', s.tap, e.message.split('\n')[0]); } }
      if (s.wait) await page.waitForTimeout(s.wait);
      if (s.shot) { await page.screenshot({ path: path.join(out, s.shot + '.png') }); console.log('shot', s.shot); }
    }
  }
  await b.close();
})();
