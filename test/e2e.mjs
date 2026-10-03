// End-to-end smoke test in mock mode: Capture → Map → Teach. Run: node test/e2e.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
const errors = [];
const check = (c, msg) => { console.log(c ? '  ✔' : '  ✘', msg); if (!c) errors.push(msg); };

// speed up the pause detector for the test
await page.addInitScript(() => { window.speechSynthesis = { speak() {}, cancel() {}, getVoices: () => [] }; });

// ---------- CAPTURE ----------
console.log('CAPTURE');
await page.goto(BASE + '/');
await page.click('#btnStart');
await page.waitForTimeout(500);
const selectByLabel = async (label, value) => {
  const idx = { 'Identity verification': 0, Action: 1, Status: 2 }[label];
  await page.locator('#app select').nth(idx).selectOption(value);
};
const workTicket = async (id, verification, action, status, directory = false) => {
  await page.click(`.ticket-list .t:has-text("${id}")`);
  if (directory) await page.click('text=Look up in HR directory');
  await selectByLabel('Identity verification', verification);
  await selectByLabel('Action', action);
  await selectByLabel('Status', status);
  await page.click('text=Save ticket');
  // simulate the pause (QUIET_MS 3s) + answer
  await page.waitForTimeout(3600);
  await page.evaluate(() => {});
};
await workTicket('INC-1041', 'Callback: HR directory number', 'Reset password', 'Resolved', true);
await page.waitForTimeout(7000);
await page.fill('#typed', 'Attackers put their own number in the ticket. The HR directory is the only number I trust.');
await page.press('#typed', 'Enter');
await page.waitForTimeout(16000); // respect MIN_GAP
await workTicket('INC-1042', 'Manager confirmed in writing', 'Grant local admin (24h)', 'Resolved');
await page.waitForTimeout(1500);
await page.fill('#typed', 'Permanent admin is how malware spreads. 24 hours, then it expires.');
await page.press('#typed', 'Enter');
await page.waitForTimeout(17000);
await workTicket('INC-1043', 'Not verified', 'No action', 'Escalated to Security');
await page.waitForTimeout(1500);
await page.fill('#typed', 'Urgent, a big title, a strange number: that is exactly what an attacker sounds like. I never reset MFA on the phone.');
await page.press('#typed', 'Enter');
await page.waitForTimeout(800);

const q = +(await page.textContent('#cQ'));
const g = +(await page.textContent('#cG'));
check(q >= 3, `asked ${q} live questions (need ≥3)`);
check(g >= 1, `asked ${g} guardrail questions (need ≥1)`);
const evCount = await page.locator('#events div').count();
check(evCount > 8, `${evCount} screen events logged`);

await page.click('#btnFinish');
await page.waitForURL('**/workmap.html*', { timeout: 15000 });

// ---------- MAP ----------
console.log('MAP');
await page.waitForSelector('.step', { timeout: 15000 });
await page.waitForTimeout(3500);
for (let i = 0; i < 3; i++) {
  await page.fill('#typed', ['No approval from their manager, no admin. I put it on hold and ask the manager.', 'I call the Security on-call number within five minutes.', 'Only on a video call where they show their ID card.'][i]);
  await page.press('#typed', 'Enter');
  await page.waitForTimeout(1200);
}
const f = +(await page.textContent('#cF'));
check(f >= 3, `debrief asked ${f} follow-up questions (need ≥3)`);
await page.waitForSelector('#btnConfirm:not(.hidden)', { timeout: 10000 });
await page.click('#btnConfirm');
await page.waitForFunction(() => document.querySelector('#tb').textContent.includes('confirmed'), null, { timeout: 15000 });
const steps = +(await page.textContent('#sSteps')); const judg = +(await page.textContent('#sJ')); const grs = +(await page.textContent('#sG'));
check(steps >= 5, `${steps} steps`); check(judg >= 3, `${judg} judgment calls`); check(grs >= 4, `${grs} guardrails`);
await page.click('.step.judgment >> nth=0');
const hasImg = await page.locator('#detail img').count();
const hasQuote = (await page.textContent('#detail')).includes('“');
check(hasImg > 0, 'judgment step links to a screen moment (snapshot)');
check(hasQuote, 'step shows reason in expert\'s own words');
await page.waitForTimeout(1500);

// ---------- TEACH ----------
console.log('TEACH');
await page.goto(BASE + '/teach.html');
await page.waitForSelector('#btnStart:not([disabled])');
await page.click('#btnStart');
await page.waitForSelector('.ticket-list .t');
await page.click('.ticket-list .t:has-text("INC-2001")');
await page.waitForTimeout(800);
const predicted = (await page.textContent('#transcript')).includes('Before you start');
check(predicted, 'tutor asks new hire to predict');
await page.locator('#app select').nth(0).selectOption('Not verified');
await page.locator('#app select').nth(1).selectOption('Reset MFA');
await page.locator('#app select').nth(2).selectOption('Resolved');
await page.click('text=Save ticket');
await page.waitForSelector('.coach.stop', { timeout: 8000 });
const blocked = !(await page.locator('.ticket-list .t:has-text("INC-2001")').getAttribute('class')).includes('done');
check(blocked, 'wrong decision blocked BEFORE save');
check((await page.textContent('.coach')).includes('would stop here'), 'tutor says "<expert> would stop here"');
await page.click('text=Let me fix it');
await page.locator('#app select').nth(1).selectOption('No action');
await page.locator('#app select').nth(2).selectOption('Escalated to Security');
await page.click('text=Save ticket');
await page.waitForTimeout(800);
const saved = (await page.locator('.ticket-list .t:has-text("INC-2001")').getAttribute('class')).includes('done');
check(saved, 'corrected decision saves OK');
await page.click('#btnReport');
const rep = await page.textContent('#reportBody');
check(rep.includes('Mastered') && rep.includes('Practise'), 'progress report shows mastered / practise next');
await page.screenshot({ path: 'test/teach.png' });

console.log(errors.length ? `\n${errors.length} FAILED` : '\nALL PASSED');
await browser.close();
process.exit(errors.length ? 1 : 0);
