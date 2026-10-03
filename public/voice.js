// Voice adapter. Uses ElevenLabs Agents when configured, otherwise the browser's own
// speech synthesis + recognition, so the demo always works.
//
// Both implementations expose the same interface:
//   await voice.start({ role, onUserSaid, onAgentSaid, onModeChange })
//   voice.say(text)                 – make the agent speak this now (apprentice question)
//   voice.context(text)             – silent context for the agent (screen events)
//   voice.activity()                – "user is busy, don't interrupt"
//   voice.setMuted(bool), voice.stop(), voice.isSpeaking

export async function createVoice() {
  const cfg = await fetch('/api/config').then((r) => r.json());
  if (cfg.elevenlabs.configured) {
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@elevenlabs/client@latest/+esm');
      return new ElevenVoice(mod.Conversation, cfg);
    } catch (e) {
      console.warn('ElevenLabs SDK failed to load, using browser voice', e);
    }
  }
  return new BrowserVoice();
}

class ElevenVoice {
  constructor(Conversation, cfg) { this.Conversation = Conversation; this.cfg = cfg; this.kind = 'elevenlabs'; this.isSpeaking = false; }
  async start({ role = 'interviewer', onUserSaid, onAgentSaid, onModeChange, clientTools = {} } = {}) {
    const { signedUrl } = await fetch(`/api/elevenlabs/signed-url?role=${role}`).then((r) => r.json());
    this.conv = await this.Conversation.startSession({
      signedUrl,
      connectionType: 'websocket',
      clientTools,
      onMessage: ({ source, message }) => {
        if (!message) return;
        // Our own injected instructions echo back as "user" messages – never treat them as the expert speaking.
        if (message.startsWith('[APPRENTICE_SAY]')) return;
        // Ignore transcripts captured while the agent itself is talking (echo).
        if (source === 'user' && this.isSpeaking) return;
        if (source === 'user') onUserSaid?.(message);
        else onAgentSaid?.(message);
      },
      onModeChange: ({ mode }) => { this.isSpeaking = mode === 'speaking'; onModeChange?.(mode); },
      onError: (e) => console.error('ElevenLabs error', e),
    });
  }
  say(text) {
    // The agent is instructed to speak verbatim whatever arrives with this prefix.
    this.conv?.sendUserMessage(`[APPRENTICE_SAY] ${text}`);
  }
  context(text) { this.conv?.sendContextualUpdate(text); }
  activity() { this.conv?.sendUserActivity(); }
  setMuted(m) { this.conv?.setMicMuted(m); }
  async stop() { await this.conv?.endSession(); this.conv = null; }
}

class BrowserVoice {
  constructor() { this.kind = 'browser'; this.isSpeaking = false; this.muted = false; }
  async start({ onUserSaid, onAgentSaid, onModeChange } = {}) {
    this.onUserSaid = onUserSaid; this.onAgentSaid = onAgentSaid; this.onModeChange = onModeChange;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      this.rec = new SR();
      this.rec.continuous = true; this.rec.interimResults = false; this.rec.lang = 'en-US';
      this.rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal && !this.muted && !this.isSpeaking) this.onUserSaid?.(e.results[i][0].transcript.trim());
        }
      };
      this.rec.onend = () => { if (this.running) try { this.rec.start(); } catch {} };
      this.running = true;
      try { this.rec.start(); } catch {}
    } else {
      console.warn('No SpeechRecognition in this browser – type answers in the transcript box.');
    }
  }
  say(text) {
    if (!('speechSynthesis' in window)) { this.onAgentSaid?.(text); return; }
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => /en-GB|en-US/.test(v.lang) && /Google|Samantha|Daniel/.test(v.name)) || voices.find((v) => v.lang.startsWith('en')) || null;
    u.rate = 1.0;
    u.onstart = () => { this.isSpeaking = true; this.onModeChange?.('speaking'); };
    u.onend = () => { this.isSpeaking = false; this.onModeChange?.('listening'); };
    this.onAgentSaid?.(text);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  context() {}
  activity() {}
  setMuted(m) { this.muted = m; }
  async stop() { this.running = false; try { this.rec?.stop(); } catch {} speechSynthesis?.cancel(); }
}
