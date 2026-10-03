// Simple PII redaction for transcripts and events (server side). Mirrors public/redact.js.
const PATTERNS = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\b\d{6,8}[-+]?\d{4}\b/g, '[personal id]'], // Swedish personnummer
  [/\+?\d[\d\s-]{7,}\d/g, '[phone]'],
  [/\bSE\d{2}[\s\d]{10,30}\b/gi, '[iban]'],
];

export function redact(text = '') {
  return PATTERNS.reduce((s, [re, rep]) => s.replace(re, rep), String(text));
}

export function redactDeep(obj) {
  if (typeof obj === 'string') return redact(obj);
  if (Array.isArray(obj)) return obj.map(redactDeep);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = k === 'snapshot' || k === 'image' ? v : redactDeep(v);
    return out;
  }
  return obj;
}
