import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await p.addInitScript(() => { window.speechSynthesis = { speak() {}, cancel() {}, getVoices: () => [] }; });
await p.goto('http://localhost:3000/'); await p.click('#btnStart'); await p.click('.ticket-list .t:has-text("INC-1043")'); await p.waitForTimeout(400);
await p.screenshot({ path: 'test/capture.png' });
await p.goto('http://localhost:3000/workmap.html'); await p.waitForSelector('.step'); await p.click('.step.judgment >> nth=2'); await p.waitForTimeout(400);
await p.screenshot({ path: 'test/workmap.png' });
await b.close();
