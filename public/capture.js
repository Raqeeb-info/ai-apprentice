// MODULE 1 – CAPTURE. The expert works; the apprentice watches, waits for a pause, asks why.
import { EXPERT, CAPTURE_TICKETS } from './scenario.js';
import { $, el, fmt, postJson, toast, renderHelpdesk, snapshotApp, sleep } from './common.js';
import { createVoice } from './voice.js';

// ---- tunables (the "when to ask" policy) ----
const QUIET_MS = 3000;          // no typing/clicking/speaking for this long = a pause
const MIN_GAP_MS = 20000;       // never ask more often than this
const MAX_LIVE_QUESTIONS = 5;   // the rest waits for the debrief
const VISION_EVERY_MS = 2000;   // frame cadence when screen is shared

const S = {
  started: false, t0: 0, events: [], transcript: [], questions: [], snapshots: {},
  lastActivity: 0, lastUserSpeech: 0, lastQuestionAt: -1e9, pending: [], offRecord: false,
  awaitingAnswer: null, voice: null, shareStream: null, visionPrev: '', busy: false,
};
const now = () => performance.now() - S.t0;

$('#expertName').textContent = `${EXPERT.name}, ${EXPERT.role} (${EXPERT.years} yrs)`;

fetch('/api/config').then((r) => r.json()).then((c) => {
  $('#pillLlm').textContent = `brain: ${c.llm.provider}`;
  $('#pillVoice').textContent = `voice: ${c.elevenlabs.configured ? 'ElevenLabs' : 'browser'}`;
});

// ---- UI helpers ----
function setMode(m) {
  $('#orb').className = `orb ${S.offRecord ? 'offrecord' : m}`;
  $('#mode').textContent = S.offRecord ? 'off the record' : m === 'speaking' ? 'asking…' : m === 'listening' ? 'listening, watching' : m;
}
function addTranscript(source, message, t = now()) {
  S.transcript.push({ t, source, message });
  const box = $('#transcript');
  box.append(el('div', { class: `m ${source === 'user' ? 'user' : 'ai'}` }, el('span', { class: 'who' }, `${fmt(t)} · ${source === 'user' ? EXPERT.name.split(' ')[0] : 'Apprentice'}`), message));
  box.scrollTop = box.scrollHeight;
}
function addEventLine(text, cls = '') {
  const box = $('#events'); box.append(el('div', { class: cls }, text)); box.scrollTop = box.scrollHeight;
}
function counters() {
  $('#cQ').textContent = S.questions.length; $('#cQ').className = `counter ${S.questions.length >= 3 ? 'ok' : ''}`;
  const g = S.questions.filter((q) => q.kind === 'guardrail').length;
  $('#cG').textContent = g; $('#cG').className = `counter ${g >= 1 ? 'ok' : ''}`;
}

// ---- events from the helpdesk ----
async function onEvent(e) {
  if (!S.started || S.offRecord) return;
  const t = now();
  const snapshotId = `snap-${S.events.length + 1}`;
  const img = await snapshotApp($('#app'), S.shareStream ? $('#shareVideo') : null);
  if (img) S.snapshots[snapshotId] = img;
  const ev = { ...e, t, snapshotId };
  S.events.push(ev); S.pending.push(ev);
  S.lastActivity = t;
  addEventLine(`${fmt(t)}  ${e.summary}`);
  S.voice?.context(`Screen event: ${e.summary}`);
}
const onActivity = () => { S.lastActivity = now(); S.voice?.activity(); };

// ---- the pause detector: decides WHEN the apprentice may speak ----
async function tick() {
  if (!S.started) return;
  const t = now();
  const quietFor = t - Math.max(S.lastActivity, S.lastUserSpeech);
  const sinceQ = t - S.lastQuestionAt;
  const state = S.offRecord ? 'off the record' : S.voice?.isSpeaking ? 'apprentice speaking' : S.awaitingAnswer ? 'waiting for the answer' : quietFor < QUIET_MS ? 'expert is busy, staying quiet' : S.pending.length === 0 ? 'quiet, nothing new to ask about' : sinceQ < MIN_GAP_MS ? `holding the question ${Math.round((MIN_GAP_MS - sinceQ) / 1000)}s` : 'pause detected, asking';
  $('#pause').textContent = state;
  // Timing ring: fills over the 3 s of silence that counts as a pause.
  const ring = $('#ring');
  if (ring) {
    const frac = S.offRecord || S.awaitingAnswer ? 0 : Math.min(1, quietFor / QUIET_MS);
    ring.style.strokeDashoffset = String(182 - 182 * frac);
    ring.style.stroke = frac >= 1 && S.pending.length ? 'var(--amber)' : 'var(--teal)';
  }

  const may = !S.offRecord && !S.busy && !S.voice?.isSpeaking && !S.awaitingAnswer && quietFor >= QUIET_MS && S.pending.length > 0 && sinceQ >= MIN_GAP_MS && S.questions.length < MAX_LIVE_QUESTIONS;
  if (may) await maybeAsk();
}
setInterval(tick, 500);

async function maybeAsk() {
  S.busy = true;
  try {
    const res = await postJson('/api/question', {
      expert: EXPERT, recentEvents: S.events.slice(-12), pending: S.pending, transcript: S.transcript.slice(-10), asked: S.questions,
    });
    S.pending = [];
    if (res.skip || !res.question) return;
    const q = { t: now(), question: res.question, kind: res.kind || 'why', about: res.about || '', answer: '', snapshotId: S.events.at(-1)?.snapshotId || null };
    S.questions.push(q); S.lastQuestionAt = now(); S.awaitingAnswer = q;
    addEventLine(`${fmt(q.t)}  ❓ ${q.kind.toUpperCase()}: ${q.question}`, 'q');
    addTranscript('ai', q.question, q.t);
    S.voice?.say(q.question);
    counters();
    // If no answer within 25s, stop waiting (the debrief will pick it up).
    setTimeout(() => { if (S.awaitingAnswer === q) S.awaitingAnswer = null; }, 25000);
  } catch (e) { console.error(e); } finally { S.busy = false; }
}

function onUserSaid(text) {
  if (S.offRecord || !text) return;
  const t = now(); S.lastUserSpeech = t;
  addTranscript('user', text, t);
  if (S.awaitingAnswer) { S.awaitingAnswer.answer = (S.awaitingAnswer.answer + ' ' + text).trim(); S.awaitingAnswer = null; }
}

// ---- screen share + vision (secondary layer on top of app events) ----
async function startShare() {
  try {
    S.shareStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false });
    const v = $('#shareVideo'); v.srcObject = S.shareStream; await v.play();
    $('#btnShare').textContent = '🖥 Sharing'; $('#btnShare').disabled = true;
    S.shareStream.getVideoTracks()[0].onended = () => { S.shareStream = null; $('#btnShare').textContent = '🖥 Share screen'; $('#btnShare').disabled = false; };
    visionLoop();
  } catch (e) { toast('Screen share cancelled'); }
}
async function visionLoop() {
  while (S.started && S.shareStream) {
    await sleep(VISION_EVERY_MS);
    if (S.offRecord || S.voice?.isSpeaking) continue;
    const img = await snapshotApp($('#app'), $('#shareVideo'));
    if (!img) continue;
    try {
      const r = await postJson('/api/vision', { image: img.split(',')[1], previous: S.visionPrev });
      S.visionPrev = r.description || S.visionPrev;
      for (const text of r.events || []) {
        const ev = { type: 'vision', summary: `👁 ${text}`, t: now(), snapshotId: null };
        S.events.push(ev); S.pending.push(ev); addEventLine(`${fmt(ev.t)}  ${ev.summary}`);
      }
    } catch {}
  }
}

// ---- session control ----
$('#btnStart').onclick = async () => {
  if (S.started) return;
  S.started = true; S.t0 = performance.now(); S.lastActivity = 0;
  $('#btnStart').disabled = true; $('#btnShare').disabled = false; $('#btnOff').disabled = false; $('#btnFinish').disabled = false;
  setMode('listening');
  try {
    S.voice = await createVoice();
    await S.voice.start({
      role: 'interviewer', onUserSaid, onModeChange: setMode,
      // Agent's own short acknowledgements. Skip anything we already logged (our injected questions).
      onAgentSaid: (m) => { if (!S.transcript.some((x) => x.source === 'ai' && m.includes(x.message.slice(0, 40)))) addTranscript('ai', m); },
    });
    $('#pillVoice').textContent = `voice: ${S.voice.kind}`;
    S.voice.context(`You are watching ${EXPERT.name}, ${EXPERT.role}, work helpdesk tickets. Stay silent unless asked to speak.`);
  } catch (e) { console.error(e); toast('Voice failed to start – continuing with text'); }
  const greet = `Hi ${EXPERT.name.split(' ')[0]}, I'm your apprentice. Just work as usual, I'll stay quiet and ask a question now and then.`;
  addTranscript('ai', greet); S.voice?.say(greet);
  S.lastQuestionAt = now() - MIN_GAP_MS + 8000; // first question allowed after ~8s of real work
};

$('#btnShare').onclick = startShare;

$('#btnOff').onclick = () => {
  S.offRecord = !S.offRecord;
  $('#btnOff').textContent = S.offRecord ? '▶ Back on record' : '⏸ Off the record';
  S.voice?.setMuted(S.offRecord);
  addEventLine(`${fmt(now())}  ${S.offRecord ? '⏸ OFF THE RECORD – capture paused' : '▶ back on record'}`);
  setMode(S.voice?.isSpeaking ? 'speaking' : 'listening');
  toast(S.offRecord ? 'Off the record: nothing is captured until you resume.' : 'Back on record.');
};

$('#btnTyped').onclick = () => { const v = $('#typed').value.trim(); if (v) { onUserSaid(v); $('#typed').value = ''; } };
$('#typed').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnTyped').click(); });

$('#btnFinish').onclick = async () => {
  if (!S.started) return;
  $('#btnFinish').disabled = true;
  const bye = 'Thanks, that was clear. Give me a moment to go through what I saw, then I have a few questions for you.';
  addTranscript('ai', bye); S.voice?.say(bye);
  await sleep(1500);
  try { S.shareStream?.getTracks().forEach((t) => t.stop()); } catch {}
  await S.voice?.stop();
  const session = { expert: EXPERT, startedAt: Date.now(), events: S.events, transcript: S.transcript, questions: S.questions, snapshots: S.snapshots, tickets: CAPTURE_TICKETS };
  localStorage.setItem('apprentice.session', JSON.stringify({ ...session, snapshots: {} })); // light copy
  await postJson('/api/session', session);
  location.href = '/workmap.html?debrief=1';
};

renderHelpdesk($('#app'), CAPTURE_TICKETS, { onEvent, onActivity });
