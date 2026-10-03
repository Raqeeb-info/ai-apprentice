// Small shared helpers: toast, redaction, helpdesk UI renderer, screen snapshots.
import { HR_DIRECTORY, VERIFICATION_OPTIONS, ACTION_OPTIONS, STATUS_OPTIONS } from './scenario.js';

export const $ = (s, el = document) => el.querySelector(s);
export const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
export const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

let toastEl;
export function toast(msg, ms = 2500) {
  toastEl ||= document.body.appendChild(el('div', { class: 'toast' }));
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('show'), ms);
}

// Client-side PII redaction (mirrors server). Applied to events before they leave the browser.
const PII = [[/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'], [/\b\d{6,8}[-+]?\d{4}\b/g, '[personal id]'], [/\+?\d[\d\s-]{7,}\d/g, '[phone]']];
export const redact = (s = '') => PII.reduce((x, [re, r]) => x.replace(re, r), String(s));

/**
 * Renders the fake helpdesk and emits structured events.
 * onEvent({type, ticket, field?, from?, to?, summary}), onBeforeSave(ticket, state) -> boolean|Promise<boolean>
 */
export function renderHelpdesk(root, tickets, { onEvent, onBeforeSave, onActivity, readOnly = false } = {}) {
  const state = Object.fromEntries(tickets.map((t) => [t.id, { verification: VERIFICATION_OPTIONS[0], action: ACTION_OPTIONS[0], status: 'Open', note: '', saved: false }]));
  let current = null;
  const emit = (e) => onEvent?.({ ...e, summary: redact(e.summary) });

  const listEl = el('div', { class: 'ticket-list' });
  const viewEl = el('div', { class: 'ticket' });
  root.replaceChildren(el('div', { class: 'tickets' }, listEl, viewEl));

  function renderList() {
    listEl.replaceChildren(
      el('h3', { style: 'margin:0 0 8px' }, 'Queue'),
      ...tickets.map((t) => el('div', { class: `t ${current?.id === t.id ? 'active' : ''} ${state[t.id].saved ? 'done' : ''}`, onclick: () => open(t) },
        el('div', { class: 'id' }, t.id, state[t.id].saved ? el('span', { class: 'st' }, state[t.id].status) : null),
        el('div', {}, t.title))),
    );
  }

  function open(t) {
    current = t; renderList();
    emit({ type: 'ticket_opened', ticket: t.id, summary: `Opened ticket ${t.id}: "${t.title}" (channel: ${t.channel}, requester: ${t.requester})` });
    renderView();
  }

  function select(name, options, value, onChange) {
    const s = el('select', { onchange: (e) => onChange(e.target.value), oninput: () => onActivity?.() }, ...options.map((o) => el('option', { selected: o === value ? '' : null }, o)));
    s.disabled = readOnly || state[current.id].saved;
    return s;
  }

  function renderView() {
    const t = current; if (!t) { viewEl.replaceChildren(el('p', { class: 'muted' }, 'Select a ticket from the queue.')); return; }
    const st = state[t.id];
    const dirName = Object.keys(HR_DIRECTORY).find((n) => t.requester.startsWith(n));
    let dirBox = null;
    const dirBtn = el('button', { onclick: () => {
      const d = HR_DIRECTORY[dirName];
      dirBox.replaceChildren(el('b', {}, `HR directory – ${dirName}`), el('div', {}, `Dept: ${d.dept} · Manager: ${d.manager}`), el('div', {}, `Phone on file: ${d.phone}`));
      dirBox.classList.remove('hidden');
      emit({ type: 'directory_lookup', ticket: t.id, summary: `Looked up ${dirName} in the HR directory (phone on file differs from ticket: ${t.contactInTicket ? 'yes' : 'n/a'})` });
    } }, '🔎 Look up in HR directory');
    dirBox = el('div', { class: 'directory hidden' });

    const change = (field, label) => (v) => {
      const from = st[field]; st[field] = v;
      emit({ type: 'field_changed', ticket: t.id, field, from, to: v, summary: `${t.id}: ${label} changed from "${from}" to "${v}"` });
    };

    const saveBtn = el('button', { class: 'primary', onclick: async () => {
      saveBtn.disabled = true;
      const ok = onBeforeSave ? await onBeforeSave(t, { ...st }) : true;
      if (ok) {
        st.saved = true;
        emit({ type: 'save', ticket: t.id, summary: `${t.id} saved: action="${st.action}", verification="${st.verification}", status="${st.status}"` });
        renderList(); renderView();
      } else saveBtn.disabled = false;
    } }, st.saved ? 'Saved' : 'Save ticket');
    saveBtn.disabled = readOnly || st.saved;

    viewEl.replaceChildren(
      el('div', { class: 'row' }, el('h2', { style: 'margin:0' }, `${t.id} · ${t.title}`), el('span', { class: `flag ${t.managerApproval ? 'yes' : 'no'}` }, t.managerApproval ? `Manager approval: ${t.approvalBy}` : 'No manager approval')),
      el('div', { class: 'meta' },
        el('div', {}, el('b', {}, 'Requester: '), t.requester), el('div', {}, el('b', {}, 'Channel: '), t.channel),
        el('div', {}, el('b', {}, 'Contact in ticket: '), t.contactInTicket || '—'), el('div', {}, el('b', {}, 'Status: '), st.saved ? st.status : 'Open')),
      el('div', { class: 'body' }, t.body),
      dirName ? el('div', { style: 'margin-top:10px' }, dirBtn) : null, dirBox,
      el('label', {}, 'Identity verification'), select('verification', VERIFICATION_OPTIONS, st.verification, change('verification', 'Identity verification')),
      el('label', {}, 'Action'), select('action', ACTION_OPTIONS, st.action, change('action', 'Action')),
      el('label', {}, 'Status'), select('status', STATUS_OPTIONS, st.status, change('status', 'Status')),
      el('label', {}, 'Internal note'), el('textarea', { rows: 2, oninput: (e) => { st.note = e.target.value; onActivity?.(); } }, st.note),
      el('div', { class: 'actions' }, saveBtn, el('span', { class: 'muted small' }, st.saved ? 'Ticket closed for editing.' : '')),
    );
  }

  renderList(); renderView();
  return { getState: () => state, getCurrent: () => current, open: (id) => open(tickets.find((t) => t.id === id)), rerender: renderView };
}

/** Snapshot of the app area (and optionally the shared screen) as a small JPEG data URL. */
export async function snapshotApp(areaEl, video) {
  try {
    const c = document.createElement('canvas');
    const w = 720; const h = Math.round(w * 9 / 16);
    c.width = w; c.height = h; const ctx = c.getContext('2d');
    if (video && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, w, h);
    } else {
      // Render a readable "wireframe" of the current app state (no html2canvas needed).
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#0b3d5c'; ctx.fillRect(0, 0, w, 28);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui'; ctx.fillText('Nordvik Helpdesk', 12, 19);
      ctx.fillStyle = '#14202b'; ctx.font = '12px system-ui';
      const lines = areaEl.innerText.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 26);
      lines.forEach((l, i) => ctx.fillText(redact(l).slice(0, 110), 12, 48 + i * 14));
    }
    return c.toDataURL('image/jpeg', 0.6);
  } catch { return null; }
}
