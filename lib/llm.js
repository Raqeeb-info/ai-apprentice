// LLM layer. Providers: "anthropic" (Claude), "openai-compatible" (e.g. Kimi), or "mock" (offline).
import Anthropic from '@anthropic-ai/sdk';

const provider = (process.env.LLM_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock')).toLowerCase();
const FAST = process.env.CLAUDE_FAST_MODEL || 'claude-haiku-4-5-20251001';
const SMART = process.env.CLAUDE_SMART_MODEL || 'claude-sonnet-5-5';

const anthropic = provider === 'anthropic' ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

export const llmInfo = () => ({ provider, fast: FAST, smart: SMART });
export const isMock = () => provider === 'mock';

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in model output: ' + text.slice(0, 200));
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Ask the model for JSON.
 * @param {object} o { system, user, smart?: boolean, imageBase64?: string, maxTokens?: number }
 */
export async function askJson({ system, user, smart = false, imageBase64 = null, maxTokens = 1500 }) {
  const userText = typeof user === 'string' ? user : JSON.stringify(user, null, 1);

  if (provider === 'anthropic') {
    const content = [];
    if (imageBase64) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } });
    }
    content.push({ type: 'text', text: userText });
    const res = await anthropic.messages.create({
      model: smart ? SMART : FAST,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    });
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return extractJson(text);
  }

  if (provider === 'openai-compatible') {
    // Works with Kimi (Moonshot), OpenAI, Groq, etc.
    const base = process.env.OPENAI_COMPAT_BASE_URL || 'https://api.moonshot.ai/v1';
    const model = smart ? process.env.OPENAI_COMPAT_SMART_MODEL : process.env.OPENAI_COMPAT_FAST_MODEL;
    const userContent = imageBase64
      ? [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }]
      : userText;
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_COMPAT_API_KEY}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.3,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
      }),
    });
    if (!r.ok) throw new Error(`LLM error ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return extractJson(j.choices[0].message.content);
  }

  throw new Error('askJson called in mock mode');
}
