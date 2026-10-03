// MODULE 3 – TEACH. A voice tutor coaches the new hire on cases the expert never showed,
// asks them to predict, and stops a wrong decision BEFORE it is saved.
import { NEW_HIRE, TEACH_TICKETS } from './scenario.js';
import { $, el, fmt, postJson, toast, renderHelpdesk, sleep } from './common.js';
import { createVoice } from './voice.js';

const S = { session: null, wm: null, voice: null, started: false, log: [], stops: 0, oks: 0, pendingSave: null, awaitingWhy: false, perTicket: {} };
const expertFirst = () => (S.session?.expert?.name || 'The expert').split(' ')[0];

$('#hireName').textContent = `${NEW_HIRE.name}, ${NEW_HIRE.role}`;

function setMode(m) { $('#orb').className = `orb ${m}`; $('#mode').textContent = m; }
function addTranscript(source, message) {
  const box = $('#transcript');
  box.append(el('div', { class: `m ${source === 'user' ? 'user' : 'ai'}` }, el('span', { class: 'who' }, source === 'user' ? NEW_HIRE.name : 'Tutor'), message));
  box.scrollTop = box.scrollHeight;
}
function say(text) { addTranscript('ai', text); S.voice?.say(text); }

async function load() {
  const r = await fetch('/api/session/latest');
  S.session = r.ok ? await r.json() : null;
  S.wm = S.session?.workmap;
  $('#expertShort').textContent = expertFirst();
  if (!S.wm) { $('#pillState').textContent = 'no Work Map'; $('#app').innerHTML = '<p class="muted">No confirmed Work Map yet. <a href="/workmap.html">Finish the debrief first.</a></p>'; $('#btnStart').disabled = true; return; }
  $('#pillState').textContent = `Work Map: ${S.wm.steps.length} steps · ${S.wm.guardrails.length} guardrails`;
  $('#rules').replaceChildren(...S.wm.guardrails.map((g) => el('div', { class: 'card', style: 'padding:6px 9px;margin-top:6px' }, el('span', { class: `badge ${g.type}` }, g.id), ' ', g.rule)));
}

let hd;
function onEvent(e) {
  if (!S.started) return;
  S.log.push({ t: Date.now(), ...e });
  if (e.type === 'ticket_opened') predict(e.ticket);
}

async function predict(ticketId) {
  const ticket = TEACH_TICKETS.find((t) => t.id === ticketId);
  S.perTicket[ticketId] ||= { stops: [], oks: 0 };
  const r = await postJson('/api/tutor/predict', { workmap: S.wm, ticket });
  say(r.question);
}

// The key moment: check BEFORE the save is committed.
async function onBeforeSave(ticket, state) {
  const r = await postJson('/api/tutor/check', { expertName: S.session.expert.name, workmap: S.wm, ticket, state, trigger: 'save' });
  if (r.verdict === 'ok') {
    S.oks++; S.perTicket[ticket.id].oks++; $('#cOk').textContent = S.oks;
    showCoach('ok', `✔ ${r.ask}`, '');
    say(r.ask);
    return true;
  }
  // stop or unsure → block the save
  S.pendingSave = { ticket, state, r };
  if (r.verdict === 'stop') { S.stops++; S.perTicket[ticket.id].stops.push(r.guardrailId); $('#cStop').textContent = S.stops; $('#cStop').className = 'counter ok'; }
  const step = S.wm.steps.find((s) => s.id === r.stepId);
  const img = step?.snapshotId && S.session.snapshots?.[step.snapshotId];
  showCoach(r.verdict, r.ask, r.explain, step, img, r.guardrailId);
  say(r.ask); S.awaitingWhy = true;
  return false;
}

function showCoach(kind, ask, explain, step, img, gid) {
  const g = S.wm.guardrails.find((x) => x.id === gid);
  const box = $('#coach'); box.className = `coach ${kind}`;
  box.replaceChildren(
    el('h4', {}, kind === 'ok' ? 'Tutor' : kind === 'stop' ? `⛔ Save blocked — ${expertFirst()} would stop here` : '⚠ Tutor is not sure'),
    el('div', {}, ask),
    kind === 'ok' ? null : el('details', { style: 'margin-top:8px', ontoggle: (e) => { if (e.target.open && explain) say(`${expertFirst()} said: ${explain}`); } },
      el('summary', {}, `Show ${expertFirst()}'s reasoning${g ? ` (${g.id})` : ''}`),
      g ? el('div', { style: 'margin-top:6px' }, el('span', { class: `badge ${g.type}` }, g.type.replace('_', ' ')), ' ', el('b', {}, g.rule)) : null,
      explain ? el('div', { class: 'quote', style: 'margin-top:6px' }, `“${explain}” — ${expertFirst()}${step?.t != null ? `, at ${fmt(step.t)}` : ''}`) : null,
      step ? el('div', { class: 'replay' }, el('div', { class: 'small muted', style: 'margin-top:8px' }, `Replay: ${step.title} · ${fmt(step.t || 0)}`), img ? el('img', { src: img }) : null) : null),
    kind === 'ok' ? null : el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { class: 'primary', onclick: () => { box.classList.add('hidden'); S.pendingSave = null; say('Go ahead and fix it, then save again.'); } }, 'Let me fix it')),
  );
  box.classList.remove('hidden');
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onUserSaid(text) {
  if (!text) return;
  addTranscript('user', text);
  if (S.awaitingWhy && S.pendingSave) {
    S.awaitingWhy = false;
    const { r } = S.pendingSave;
    const good = r.explain && text.split(/\W+/).filter((w) => w.length > 4).some((w) => r.explain.toLowerCase().includes(w.toLowerCase()));
    say(good ? `Exactly. ${expertFirst()} put it like this: ${r.explain} Fix it and save again.` : `Close. Here is how ${expertFirst()} explained it: ${r.explain} Fix it and save again.`);
  }
}

$('#btnStart').onclick = async () => {
  S.started = true; $('#btnStart').disabled = true; $('#btnReport').disabled = false;
  try { S.voice = await createVoice(); await S.voice.start({ role: 'tutor', onUserSaid, onModeChange: setMode }); } catch { toast('Voice unavailable – use the text box'); }
  setMode('listening');
  say(`Hi ${NEW_HIRE.name}. I learned this job from ${expertFirst()}. Work the tickets as you think is right – I'll ask you to predict decisions, and I'll stop you before anything risky gets saved.`);
  await sleep(500);
  hd = renderHelpdesk($('#app'), TEACH_TICKETS, { onEvent, onBeforeSave });
};

$('#btnReport').onclick = () => {
  const gIds = S.wm.guardrails.map((g) => g.id);
  const broken = new Set(Object.values(S.perTicket).flatMap((p) => p.stops));
  const mastered = gIds.filter((id) => !broken.has(id));
  const practise = gIds.filter((id) => broken.has(id));
  const rule = (id) => S.wm.guardrails.find((g) => g.id === id)?.rule;
  $('#reportBody').replaceChildren(
    el('p', {}, `${NEW_HIRE.name} handled ${Object.keys(S.perTicket).length} new case(s). ${S.stops} wrong decision(s) caught before save, ${S.oks} good save(s).`),
    el('h3', {}, '✅ Mastered'), el('ul', { class: 'mastery' }, ...(mastered.length ? mastered.map((id) => el('li', {}, rule(id))) : [el('li', { class: 'muted' }, 'Nothing confirmed yet')])),
    el('h3', {}, '📚 Practise next'), el('ul', { class: 'mastery' }, ...(practise.length ? practise.map((id) => el('li', {}, rule(id), ' ', el('span', { class: 'small muted' }, `(replay ${expertFirst()}'s moment)`))) : [el('li', { class: 'muted' }, 'No mistakes made')])),
  );
  $('#report').classList.remove('hidden');
  say(`Nice work. You've mastered ${mastered.length} of ${gIds.length} rules. ${practise.length ? 'Next time, practise: ' + practise.map(rule).join('. ') : 'Nothing left to practise.'}`);
};

$('#btnTyped').onclick = () => { const v = $('#typed').value.trim(); if (v) { onUserSaid(v); $('#typed').value = ''; } };
$('#typed').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnTyped').click(); });

load();
