import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askJson, isMock, llmInfo } from './lib/llm.js';
import * as P from './lib/prompts.js';
import * as M from './lib/mock.js';
import { redactDeep } from './lib/redact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// CORS: lets a Lovable-hosted frontend call this backend.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json({ limit: '60mb' }));
// If a built Lovable/Vite frontend exists in ./ui, serve it at / (SPA). The plain UI stays at /plain/.
const UI_DIR = path.join(__dirname, 'ui');
const hasUi = fsSync.existsSync(path.join(UI_DIR, 'index.html'));
if (hasUi) {
  app.use(express.static(UI_DIR));
  app.use('/plain', express.static(path.join(__dirname, 'public')));
} else {
  app.use(express.static(path.join(__dirname, 'public')));
}
app.get('/favicon.ico', (_req, res) => res.status(204).end());

const DATA = path.join(__dirname, 'data');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Run the real model; if it fails (or we're in mock mode) fall back to the offline brain,
// so a live demo never dies because of a network hiccup.
async function smartOrMock(name, real, mock) {
  if (isMock()) return { ...mock(), _source: 'mock' };
  try {
    const out = await real();
    return { ...out, _source: 'llm' };
  } catch (e) {
    log(`[${name}] LLM failed, using mock:`, e.message);
    return { ...mock(), _source: 'mock-fallback' };
  }
}

app.get('/api/config', (_req, res) => {
  res.json({
    llm: llmInfo(),
    elevenlabs: {
      configured: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_INTERVIEWER_AGENT_ID),
      interviewer: Boolean(process.env.ELEVENLABS_INTERVIEWER_AGENT_ID),
      tutor: Boolean(process.env.ELEVENLABS_TUTOR_AGENT_ID),
    },
  });
});

// Signed URL so the ElevenLabs API key never reaches the browser.
app.get('/api/elevenlabs/signed-url', async (req, res) => {
  const role = req.query.role === 'tutor' ? 'tutor' : 'interviewer';
  const agentId = role === 'tutor'
    ? process.env.ELEVENLABS_TUTOR_AGENT_ID || process.env.ELEVENLABS_INTERVIEWER_AGENT_ID
    : process.env.ELEVENLABS_INTERVIEWER_AGENT_ID;
  if (!process.env.ELEVENLABS_API_KEY || !agentId) return res.status(400).json({ error: 'ElevenLabs not configured' });
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`, {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const j = await r.json();
    res.json({ signedUrl: j.signed_url });
  } catch (e) {
    log('signed-url error', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 1. CAPTURE – pick the one question to ask at this pause.
app.post('/api/question', async (req, res) => {
  const body = redactDeep(req.body);
  const out = await smartOrMock(
    'question',
    () => askJson({
      system: P.QUESTION_SYSTEM,
      user: {
        expert: body.expert,
        recentEvents: (body.recentEvents || []).map((e) => `[${e.t}ms] ${e.summary}`),
        newSinceLastQuestion: (body.pending || []).map((e) => e.summary),
        recentTranscript: (body.transcript || []).slice(-10).map((m) => `${m.source}: ${m.message}`),
        alreadyAsked: (body.asked || []).map((q) => q.question),
        guardrailAskedYet: (body.asked || []).some((q) => q.kind === 'guardrail'),
      },
      maxTokens: 300,
    }),
    () => M.mockQuestion(body),
  );
  log('question:', out._source, out.skip ? '(skip)' : out.question);
  res.json(out);
});

// 1b. CAPTURE – vision on a shared-screen frame. The frame is never stored.
app.post('/api/vision', async (req, res) => {
  const { image, previous } = req.body;
  const out = await smartOrMock(
    'vision',
    () => askJson({ system: P.VISION_SYSTEM, user: `Previous: ${previous || '(none)'}`, imageBase64: image, maxTokens: 300 }),
    () => M.mockVision(),
  );
  res.json(out);
});

// 2. MAP – draft Work Map + open questions + teach-back script.
app.post('/api/workmap/draft', async (req, res) => {
  const body = redactDeep(req.body);
  const out = await smartOrMock(
    'workmap-draft',
    () => askJson({
      system: P.WORKMAP_DRAFT_SYSTEM,
      user: {
        expert: body.expert,
        events: (body.events || []).map(({ t, summary, snapshotId }) => ({ t, summary, snapshotId })),
        transcript: (body.transcript || []).map((m) => ({ t: m.t, who: m.source === 'user' ? 'expert' : 'apprentice', text: m.message })),
        liveQuestions: (body.questions || []).map(({ t, question, answer }) => ({ t, question, answer })),
      },
      smart: true,
      maxTokens: 4000,
    }),
    () => M.mockWorkmapDraft(body),
  );
  res.json(out);
});

app.post('/api/workmap/final', async (req, res) => {
  const body = redactDeep(req.body);
  const out = await smartOrMock(
    'workmap-final',
    () => askJson({
      system: P.WORKMAP_FINAL_SYSTEM,
      user: {
        draft: body.draft,
        debriefTranscript: (body.debriefTranscript || []).map((m) => `${m.source === 'user' ? 'expert' : 'apprentice'}: ${m.message}`),
      },
      smart: true,
      maxTokens: 4000,
    }),
    () => M.mockWorkmapFinal(body),
  );
  res.json(out);
});

// 3. TEACH – check the new hire's choices BEFORE they are saved.
app.post('/api/tutor/check', async (req, res) => {
  const body = req.body;
  const out = await smartOrMock(
    'tutor-check',
    () => askJson({
      system: P.TUTOR_CHECK_SYSTEM,
      user: { expertName: body.expertName, workMap: body.workmap, ticket: body.ticket, newHireChoices: body.state, trigger: body.trigger },
      maxTokens: 500,
    }),
    () => M.mockTutorCheckApi(body),
  );
  log('tutor-check:', out._source, out.verdict, out.guardrailId || '');
  res.json(out);
});

app.post('/api/tutor/predict', async (req, res) => {
  const body = req.body;
  const out = await smartOrMock(
    'tutor-predict',
    () => askJson({ system: P.TUTOR_PREDICT_SYSTEM, user: { workMap: body.workmap, ticket: body.ticket }, maxTokens: 200 }),
    () => M.mockPredict(body),
  );
  res.json(out);
});

// Persist the latest session (events, snapshots, Work Map) so Teach mode can load it.
app.post('/api/session', async (req, res) => {
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(path.join(DATA, 'session-latest.json'), JSON.stringify(req.body));
  res.json({ ok: true });
});

app.get('/api/session/latest', async (_req, res) => {
  try {
    res.type('json').send(await fs.readFile(path.join(DATA, 'session-latest.json'), 'utf8'));
  } catch {
    res.status(404).json({ error: 'No saved session yet' });
  }
});

// SPA fallback for the Lovable UI (client-side routes like /workmap).
if (hasUi) app.get(/^\/(?!api\/|plain\/).*/, (_req, res) => res.sendFile(path.join(UI_DIR, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const info = llmInfo();
  log(`AI Apprentice running on http://localhost:${PORT}`);
  log(`LLM: ${info.provider}${info.provider === 'anthropic' ? ` (fast=${info.fast}, smart=${info.smart})` : ''}`);
  log(`Voice: ${process.env.ELEVENLABS_API_KEY ? 'ElevenLabs' : 'browser fallback (no ElevenLabs key)'}`);
});
