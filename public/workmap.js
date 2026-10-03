// MODULE 2 – MAP. Debrief closes the gaps, teach-back proves understanding, Work Map is the result.
import { $, el, fmt, postJson, toast, sleep } from './common.js';
import { createVoice } from './voice.js';

const S = { session: null, draft: null, final: null, voice: null, transcript: [], phase: 'idle', qIndex: 0, awaiting: false, activeStep: null };
const expertFirst = () => (S.session?.expert?.name || 'the expert').split(' ')[0];

function setMode(m) { $('#orb').className = `orb ${m}`; $('#mode').textContent = m; }
function addTranscript(source, message) {
  S.transcript.push({ t: Date.now(), source, message });
  const box = $('#transcript');
  box.append(el('div', { class: `m ${source === 'user' ? 'user' : 'ai'}` }, el('span', { class: 'who' }, source === 'user' ? expertFirst() : 'Apprentice'), message));
  box.scrollTop = box.scrollHeight;
}
function say(text) { addTranscript('ai', text); S.voice?.say(text); }

// ---------- load session & draft ----------
async function load() {
  const r = await fetch('/api/session/latest');
  if (!r.ok) { $('#pillState').textContent = 'no session'; $('#timeline').innerHTML = '<p class="muted">No captured session yet. <a href="/">Run Capture first.</a></p>'; $('#btnDebrief').disabled = true; return; }
  S.session = await r.json();
  if (S.session.workmap?.confirmed) { S.final = S.session.workmap; render(S.final); $('#pillState').textContent = 'confirmed'; $('#btnTeach').disabled = false; $('#tb').textContent = 'confirmed ✔'; $('#btnDebrief').textContent = '↻ Redo debrief'; return; }
  $('#pillState').textContent = 'drafting…';
  S.draft = await postJson('/api/workmap/draft', { expert: S.session.expert, events: S.session.events, transcript: S.session.transcript, questions: S.session.questions });
  render(S.draft);
  $('#pillState').textContent = `draft (${S.draft._source})`;
  if (new URLSearchParams(location.search).get('debrief')) $('#btnDebrief').click();
}

// ---------- render ----------
function render(wm) {
  $('#wmTitle').textContent = wm.title || 'Work Map';
  $('#sSteps').textContent = wm.steps.length; $('#sJ').textContent = wm.steps.filter((s) => s.isJudgmentCall).length; $('#sG').textContent = wm.guardrails.length;
  $('#timeline').replaceChildren(...wm.steps.map((s, i) => el('div', { class: `step ${s.isJudgmentCall ? 'judgment' : ''} ${S.activeStep === s.id ? 'active' : ''}`, onclick: () => showStep(wm, s) },
    el('div', { class: 't' }, `Step ${i + 1} of ${wm.steps.length} · ${s.t != null ? fmt(s.t) : '--:--'}`),
    el('div', { class: 'title' }, s.title, s.isJudgmentCall ? el('span', { class: 'tag' }, 'judgment call') : null),
    el('div', { class: 'small muted' }, s.decision))));
  $('#open').replaceChildren(...(wm.openQuestions || []).map((q) => el('li', {}, q)));
  if (!(wm.openQuestions || []).length) $('#open').append(el('li', {}, 'Nothing left unclear.'));
  if (S.activeStep) { const s = wm.steps.find((x) => x.id === S.activeStep); if (s) showStep(wm, s); }
}

function showStep(wm, s) {
  S.activeStep = s.id;
  document.querySelectorAll('.step').forEach((n, i) => n.classList.toggle('active', wm.steps[i].id === s.id));
  const img = s.snapshotId && S.session.snapshots?.[s.snapshotId];
  const grs = (s.guardrailIds || []).map((id) => wm.guardrails.find((g) => g.id === id)).filter(Boolean);
  $('#detail').replaceChildren(
    el('h3', { style: 'margin-top:0' }, s.title),
    img ? el('img', { src: img, alt: 'screen moment' }) : el('div', { class: 'noimg' }, 'no screen moment captured'),
    el('div', { class: 'card r' }, el('div', { class: 'small muted' }, `Screen moment · ${s.t != null ? fmt(s.t) : '--:--'}`), el('div', {}, s.screen || '')),
    el('div', { class: 'card' }, el('div', { class: 'small muted' }, 'Decision'), el('div', {}, s.decision)),
    el('div', { class: 'card' }, el('div', { class: 'small muted' }, `Reason · ${s.reasonSource || ''}`), el('div', { class: 'quote' }, s.reason ? `“${s.reason}”` : '— not yet explained —')),
    ...grs.map((g) => el('div', { class: 'card g' }, el('div', {}, el('span', { class: `badge ${g.type}` }, g.type.replace('_', ' ')), ' ', el('b', {}, g.rule)), g.quote ? el('div', { class: 'quote small' }, `“${g.quote}” — ${expertFirst()}${g.t != null ? ', ' + fmt(g.t) : ''}`) : el('div', { class: 'small muted' }, 'quote pending debrief'))),
  );
}

// ---------- debrief flow ----------
$('#btnDebrief').onclick = async () => {
  if (!S.draft && S.final) S.draft = S.final;
  $('#btnDebrief').disabled = true; S.phase = 'questions'; S.qIndex = 0; S.transcript = [];
  try {
    S.voice = await createVoice();
    await S.voice.start({ role: 'interviewer', onUserSaid, onModeChange: setMode });
  } catch { toast('Voice unavailable – use the text box'); }
  setMode('listening');
  say(`Thanks ${expertFirst()}. I have ${S.draft.openQuestions.length} things I'm still not sure about.`);
  await sleep(2500);
  nextQuestion();
};

function nextQuestion() {
  const qs = S.draft.openQuestions || [];
  if (S.qIndex < qs.length) {
    const q = qs[S.qIndex];
    say(q); S.awaiting = true;
    $('#cF').textContent = S.qIndex + 1; $('#cF').className = `counter ${S.qIndex + 1 >= 3 ? 'ok' : ''}`;
  } else teachBack();
}

function onUserSaid(text) {
  if (!text) return;
  addTranscript('user', text);
  if (S.phase === 'questions' && S.awaiting) {
    S.awaiting = false; S.qIndex++;
    setTimeout(nextQuestion, 800);
  } else if (S.phase === 'teachback') {
    if (/\b(yes|right|correct|exactly|that's it|thats it)\b/i.test(text) && !/\b(no|not|but|except|actually)\b/i.test(text)) finish(true);
    else { say('Got it, I\'ll correct that. Anything else?'); S.corrections = true; }
  }
}

async function teachBack() {
  S.phase = 'teachback'; $('#tb').textContent = 'in progress…';
  say(`Let me explain the whole process back to you, and tell me if I got anything wrong. ${S.draft.teachBack}`);
  $('#btnConfirm').classList.remove('hidden'); $('#btnCorrect').classList.remove('hidden');
}
$('#btnConfirm').onclick = () => { addTranscript('user', 'Yes, that is how it works.'); finish(true); };
$('#btnCorrect').onclick = () => { const v = prompt('What did the expert correct?'); if (v) { addTranscript('user', v); S.corrections = true; say('Thanks, I\'ll fix that. Is the rest right?'); } };

async function finish() {
  S.phase = 'done'; $('#tb').textContent = 'confirmed ✔'; $('#btnConfirm').classList.add('hidden'); $('#btnCorrect').classList.add('hidden');
  say(`Perfect. I've got it. I'll turn this into the Work Map now.`);
  $('#pillState').textContent = 'finalising…';
  S.final = await postJson('/api/workmap/final', { draft: S.draft, debriefTranscript: S.transcript });
  S.final.confirmed = true;
  render(S.final);
  $('#pillState').textContent = `confirmed (${S.final._source})`; $('#btnTeach').disabled = false; $('#btnDebrief').disabled = false; $('#btnDebrief').textContent = '↻ Redo debrief';
  await postJson('/api/session', { ...S.session, debriefTranscript: S.transcript, workmap: S.final });
  await S.voice?.stop();
  toast('Work Map confirmed and saved. Ready to train a new hire.');
}

$('#btnTyped').onclick = () => { const v = $('#typed').value.trim(); if (v) { onUserSaid(v); $('#typed').value = ''; } };
$('#typed').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnTyped').click(); });
$('#btnExport').onclick = () => {
  const wm = S.final || S.draft; if (!wm) return;
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(wm, null, 2)], { type: 'application/json' })), download: 'workmap.json' }); a.click();
};

load();
