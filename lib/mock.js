// Offline mock brain: lets the whole demo run with NO API keys (great as a backup).
import { ANSWER_KEY, EXPERT, mockTutorCheck, TEACH_TICKETS } from '../public/scenario.js';

const g = (id) => ANSWER_KEY.guardrails.find((x) => x.id === id);

export function mockQuestion({ pending = [], asked = [] }) {
  const already = (q) => asked.some((a) => a.question === q);
  // Scan newest → oldest for the most revealing event (a judgment call beats a click).
  const candidates = [...pending].reverse().map((ev) => {
    const to = ev.to || '';
    if (ev.field === 'verification' && /HR directory/.test(to))
      return { q: `You called the HR directory number, not the one in ${ev.ticket}. Why not the ticket number?`, kind: 'guardrail', ev, score: 3 };
    if (ev.field === 'action' && /24h/.test(to))
      return { q: 'You picked 24 hours instead of permanent. Is there a limit you always stick to?', kind: 'guardrail', ev, score: 3 };
    if (ev.field === 'status' && /Escalated/.test(to))
      return { q: `On ${ev.ticket} you escalated instead of resetting the MFA. What made you stop?`, kind: 'guardrail', ev, score: 3 };
    if (ev.field === 'action' && /No action/.test(to))
      return { q: `On ${ev.ticket} you chose no action for an urgent CFO call. When would you stop and ask someone?`, kind: 'guardrail', ev, score: 2 };
    if (ev.type === 'directory_lookup')
      return { q: 'You checked the HR directory before anything else. What are you looking for there?', kind: 'why', ev, score: 1 };
    if (ev.field && !/choose|Not verified|Open/.test(to))
      return { q: `You changed ${ev.field} to "${to}" on ${ev.ticket}. What made you choose that?`, kind: 'why', ev, score: 1 };
    return null;
  }).filter(Boolean).filter((c) => !already(c.q)).sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return { skip: true };
  return { skip: false, question: best.q, kind: best.kind, about: best.ev.summary };
}

export function mockVision() {
  return { description: 'Helpdesk ticket view is open.', events: [] };
}

function findEvent(events, pred) {
  return events.find(pred) || null;
}

function answerFor(questions, re) {
  const q = questions.find((x) => re.test(x.question) && x.answer);
  return q ? q : null;
}

const fmt = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function mockWorkmapDraft({ events = [], questions = [] }) {
  const at = (ev) => ({ t: ev?.t ?? null, snapshotId: ev?.snapshotId ?? null });
  const e1 = findEvent(events, (e) => e.type === 'ticket_opened' && e.ticket === 'INC-1041');
  const e2 = findEvent(events, (e) => e.type === 'directory_lookup');
  const e3 = findEvent(events, (e) => e.field === 'verification' && /HR directory/.test(e.to || ''));
  const e4 = findEvent(events, (e) => e.type === 'save' && e.ticket === 'INC-1041');
  const e5 = findEvent(events, (e) => e.type === 'ticket_opened' && e.ticket === 'INC-1042');
  const e6 = findEvent(events, (e) => e.field === 'action' && /24h/.test(e.to || ''));
  const e7 = findEvent(events, (e) => e.field === 'status' && /Escalated/.test(e.to || ''));

  const live = (re, fallbackQuote) => {
    const a = answerFor(questions, re);
    return a
      ? { reason: a.answer, reasonSource: `live question at ${fmt(a.t)}` }
      : { reason: fallbackQuote, reasonSource: 'narration' };
  };

  const steps = [
    { id: 'S1', title: 'Open the ticket and read channel and urgency', ...at(e1), screen: 'Ticket INC-1041, email request', decision: 'Read who asked, how, and how urgent', isJudgmentCall: false, reason: 'The channel tells me how careful I need to be.', reasonSource: 'narration', guardrailIds: [] },
    { id: 'S2', title: 'Look up the requester in the HR directory', ...at(e2), screen: 'HR directory entry for the requester', decision: 'Get the trusted phone number', isJudgmentCall: false, reason: 'I only trust numbers from the HR directory.', reasonSource: 'narration', guardrailIds: ['G1'] },
    { id: 'S3', title: 'Verify identity by calling the HR directory number', ...at(e3), screen: 'Verification set to "Callback: HR directory number"', decision: 'Ignored the number written in the ticket', isJudgmentCall: true, ...live(/HR directory/, g('G1').quote), guardrailIds: ['G1'] },
    { id: 'S4', title: 'Reset the password and resolve', ...at(e4), screen: 'INC-1041 saved as Resolved', decision: 'Reset password only after verification', isJudgmentCall: false, reason: 'Only after I know it is really her.', reasonSource: 'narration', guardrailIds: ['G1'] },
    { id: 'S5', title: 'Check manager approval before any admin rights', ...at(e5), screen: 'INC-1042 with approval from manager attached', decision: 'Confirmed approval is attached', isJudgmentCall: false, reason: 'not yet explained', reasonSource: 'not yet explained', guardrailIds: ['G3'] },
    { id: 'S6', title: 'Grant local admin for 24 hours only', ...at(e6), screen: 'Action set to "Grant local admin (24h)"', decision: 'Chose 24h instead of permanent', isJudgmentCall: true, ...live(/24 hours/, g('G2').quote), guardrailIds: ['G2'] },
    { id: 'S7', title: 'Phone MFA request: do not reset, escalate to Security', ...at(e7), screen: 'INC-1043 set to "Escalated to Security"', decision: 'Refused MFA reset on a phone call from an unknown number', isJudgmentCall: true, ...live(/escalated/i, g('G4').quote), guardrailIds: ['G4'] },
  ];

  const guardrails = ANSWER_KEY.guardrails.map((gr) => {
    const step = steps.find((s) => s.guardrailIds.includes(gr.id) && s.isJudgmentCall) || steps.find((s) => s.guardrailIds.includes(gr.id));
    return { ...gr, quote: gr.id === 'G3' ? '' : gr.quote, t: step?.t ?? null, snapshotId: step?.snapshotId ?? null };
  });

  return {
    title: `IT helpdesk access & identity requests – ${EXPERT.name}`,
    steps,
    guardrails,
    openQuestions: [
      'On the Docker ticket, approval was attached. What do you do when a developer asks for admin WITHOUT manager approval?',
      'For the CFO call, who exactly in Security do you escalate to, and how fast?',
      'Is there ever a case where you WOULD reset MFA remotely, for example over a video call?',
    ],
    teachBack:
      "Here's how I understood it. Every ticket: check who is asking and through which channel. For passwords, you look the person up in the HR directory and call that number, never the number in the ticket, then reset. For admin rights, there must be manager approval, and you only give 24 hours, never permanent. And MFA resets never happen over phone or chat – if it's urgent and from an executive, that's a red flag, so you escalate to Security. Is that right?",
  };
}

export function mockWorkmapFinal({ draft, debriefTranscript = [] }) {
  const userLines = debriefTranscript.filter((m) => m.source === 'user').map((m) => m.message);
  const wm = JSON.parse(JSON.stringify(draft));
  const g3 = wm.guardrails.find((x) => x.id === 'G3');
  if (g3) g3.quote = userLines[0] || g('G3').quote;
  const s5 = wm.steps.find((s) => s.id === 'S5');
  if (s5) { s5.reason = g3.quote; s5.reasonSource = 'debrief'; }
  const extra = userLines.find((l) => /video/i.test(l));
  wm.guardrails.push({
    id: 'G5', type: 'exception',
    rule: 'Remote MFA reset is only allowed after a video call ID check with the employee\'s ID card.',
    quote: extra || 'Only on a video call where they show their ID card, and I compare it with the HR photo.',
    t: wm.steps.find((s) => s.id === 'S7')?.t ?? null, snapshotId: wm.steps.find((s) => s.id === 'S7')?.snapshotId ?? null,
  });
  wm.steps.find((s) => s.id === 'S7')?.guardrailIds.push('G5');
  wm.openQuestions = [];
  wm.confirmed = true;
  wm.corrections = userLines.find((l) => /no|actually|correct|wrong|except/i.test(l))
    ? ['Expert corrected the teach-back: ' + userLines.find((l) => /no|actually|correct|wrong|except/i.test(l))]
    : [];
  return wm;
}

export function mockTutorCheckApi({ ticket, state, workmap }) {
  const hit = mockTutorCheck(ticket, state);
  if (!hit) return { verdict: 'ok', guardrailId: null, stepId: null, ask: 'Good call – that matches how Erik works.', explain: '' };
  const gr = (workmap?.guardrails || ANSWER_KEY.guardrails).find((x) => x.id === hit.guardrail) || g(hit.guardrail);
  const step = (workmap?.steps || []).find((s) => s.guardrailIds?.includes(hit.guardrail) && s.isJudgmentCall)
    || (workmap?.steps || []).find((s) => s.guardrailIds?.includes(hit.guardrail));
  return { verdict: 'stop', guardrailId: hit.guardrail, stepId: step?.id || null, ask: hit.ask, explain: gr?.quote || gr?.rule || '' };
}

export function mockPredict({ ticket }) {
  const t = TEACH_TICKETS.find((x) => x.id === ticket?.id);
  if (t?.id === 'INC-2001') return { question: 'Before you start: look at the channel. What would Erik check first on a request like this?' };
  if (t?.id === 'INC-2002') return { question: 'Before you start: what must be on this ticket before anyone gets admin rights?' };
  return { question: 'Before you start: what is the first thing Erik would check here?' };
}
