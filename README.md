# AI Apprentice – IT Helpdesk edition

Hack-Nation 7th Global AI Hackathon · Challenge 01 (ElevenLabs)

An apprentice that **watches** a senior IT-support expert work tickets, **asks why** at natural pauses, turns the session into a clickable **Work Map**, and then **tutors** a new hire, stopping a risky decision *before* it is saved.

**Scenario:** Erik (22 years in IT support at fictional *Nordvik Industrier*) processes three tickets: a password reset, an admin-rights request, and an "urgent CFO MFA reset" phone call that is really social engineering. Lena, in her first week, then gets two cases Erik never showed.

## Run it in 2 minutes

```bash
npm install
cp .env.example .env     # add keys (or leave empty for offline mock mode)
npm start                # http://localhost:3000
```

Use **Chrome** (screen share + browser speech recognition work best).

| Mode | What you need | What happens |
|---|---|---|
| **Full** | `ANTHROPIC_API_KEY` + ElevenLabs key + agent ID | Claude picks questions / builds the Work Map; ElevenLabs agent speaks & listens |
| **Brain only** | `ANTHROPIC_API_KEY` (or Kimi) | Claude brain; browser speech synthesis + recognition for voice |
| **Offline** | nothing | Scripted mock brain + browser voice. Still demonstrates all 3 modules. Use as the **backup** if Wi-Fi dies |

If a live LLM call fails mid-demo, the server **automatically falls back to the mock** for that call, so the demo never freezes.

## ElevenLabs setup (10 min)
1. Create an agent → paste the system prompt from `agents/INTERVIEWER_AGENT_PROMPT.md`.
2. (Optional) a second agent with `agents/TUTOR_AGENT_PROMPT.md`.
3. Put API key + agent IDs in `.env`. Restart.

## How the three modules map to the brief

| Brief requirement | Where |
|---|---|
| Agent watches screen, asks ≥3 questions at pauses, ≥1 about a guardrail | `public/capture.js` pause detector → `POST /api/question` (prompt in `lib/prompts.js`) |
| Frames to a vision model every 1–2 s | "Share screen" → `POST /api/vision` (secondary to the app's own events) |
| Debrief: ≥3 follow-ups + teach-back the expert confirms | `public/workmap.js` → `/api/workmap/draft` then `/api/workmap/final` |
| Work Map: every step links to screen moment + expert's words | timeline UI, `snapshotId`/`t` on every step and guardrail |
| Tutor catches a wrong decision **before save**, on a case never shown | `public/teach.js` `onBeforeSave` → `POST /api/tutor/check`; Save is blocked until fixed |
| Off the record + personal-data protection | "Off the record" button; `redact()` client+server; frames never stored |

## The 5 Apprentice-Test questions – your answers
1. **When to ask:** the app tracks typing, clicks and speech. Only after `QUIET_MS` (3 s) of silence, a new meaningful screen event, and `MIN_GAP_MS` (20 s) since the last question does it ask. ElevenLabs gets `sendUserActivity()` while the expert is busy so it never interrupts.
2. **What to ask:** the question-picker gets the recent events, the transcript and the already-asked questions, and is told to prefer *reasons* and *guardrails* over anything visible on screen. Max 5 live questions; the rest waits for the debrief.
3. **When it has understood:** the draft Work Map lists "not yet explained" decisions as open questions; the debrief asks them, then reads the whole process back; it's done only when the expert says "yes, that's how it works" (corrections are applied first).
4. **Did the new hire learn:** a case the expert never saw (INC-2001 MFA via Teams, INC-2002 permanent admin). The tutor asks them to predict, blocks a bad save, replays Erik's screen moment, and the final report shows mastered vs. practise-next rules.
5. **Trust:** "Off the record" mutes mic and stops events; phone numbers, e-mails and IDs are redacted client- and server-side; screen frames are analysed and discarded, never stored; snapshots in the Work Map are of the app only.

## Demo script (≈6 min)
1. **Capture** (judge = Erik): Start session → Share screen. Open INC-1041 → look up HR directory → set *Callback: HR directory number* → Reset password → Resolved → Save. *Pause 3 s.* Apprentice: "You called the HR directory number, not the one in the ticket. Why?" Answer out loud. Continue: INC-1042 → *Grant local admin (24h)* → Save → question about the 24h limit. INC-1043 → *No action* → *Escalated to Security* → Save → guardrail question. Click **Task done**.
2. **Map:** the debrief asks 3 open questions (e.g. "what if there's no manager approval?"), then reads back the process. Judge says "Yes, that's right" (or corrects: "except on video call I do reset MFA"). Work Map appears: 7 steps, 3 judgment calls, 4–5 guardrails. Click a step → screen moment + Erik's quote.
3. **Teach** (judge = Lena): Start training → open INC-2001 (Sara, MFA, Teams) → tutor asks her to predict → she picks *Reset MFA* + *Resolved* → **Save is blocked**: "Erik would stop here. Why?" → show Erik's reasoning + replay → fix to *Escalated to Security* → Save OK. Finish → progress report.
4. **Moonshot slide** (make it yourself): "always-on apprentice" + "people first, then agents" – export the Work Map as agent guardrails.

## Project layout
```
server.js            Express API (question, vision, workmap, tutor, signed URL)
lib/llm.js           Claude / OpenAI-compatible / mock switch
lib/prompts.js       all prompts – tune here
lib/mock.js          offline brain (backup)
public/scenario.js   tickets, HR directory, answer key (mock only)
public/capture.js    Module 1
public/workmap.js    Module 2
public/teach.js      Module 3
public/voice.js      ElevenLabs ↔ browser-speech adapter
agents/*.md          ElevenLabs agent prompts
```

## Tuning knobs
`QUIET_MS`, `MIN_GAP_MS`, `MAX_LIVE_QUESTIONS`, `VISION_EVERY_MS` at the top of `public/capture.js`.
