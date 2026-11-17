#!/usr/bin/env node
// Claude Ironworks and Claude Grimm: tails Claude Code session transcripts and streams them to a 3D view.
// Usage: node server.js [project-name-filter] [--no-open]
// Reads ~/.claude/projects/**.jsonl. No dependencies, no model calls. One network call: plan usage from
// api.anthropic.com once a minute with your Claude login (turn off with --no-live-usage).
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const PORT = +process.env.PORT || 4747;
const ROOT = path.join(os.homedir(), '.claude', 'projects');
const args = process.argv.slice(2);
const PIN = (args.find(a => !a.startsWith('--')) || '').toLowerCase();
const OPEN = !args.includes('--no-open');
const START = args.includes('--grimm') ? '/grimm' : args.includes('--kitchen') ? '/kitchen' : ''; // which page the shortcut lands on

const clients = new Set();
let history = [];
let current = null; // { file, projDir, sessionId, mtime }
const tails = new Map(); // file -> { offset, rem: Buffer }
let msgOut = new Map(); // message id -> output tokens counted so far
let msgUsd = new Map(); // message id -> estimated dollars counted so far
let jobLabel = new Map(); // tool call id -> what it's called, so a background job can be named when it starts
let spent = 0; // running total for this session, sent whole so the 8000-event history cap can't lose any of it

// $ per million tokens, API list prices as of 2026-10: [input, output, cache read]
// shortcut: Haiku 5.5's dearer rate past 100K, fast mode and web search fees are left out, add them if the estimate drifts from a real cost-state total
const PRICES = {
  'claude-fable-5-1': [10, 50, .25], 'claude-mythos-5-1': [10, 50, .25], 'claude-fable-5': [10, 50, 1],
  'claude-opus-5-5': [4, 20, .2], 'claude-opus-5': [5, 25, .5], 'claude-opus-4-8': [5, 25, .5], 'claude-opus-4-7': [5, 25, .5], 'claude-opus-4-6': [5, 25, .5],
  'claude-sonnet-5-5': [2, 10, .2], 'claude-sonnet-5': [2, 10, .2], 'claude-sonnet-4-6': [3, 15, .3],
  'claude-haiku-5-5': [.1, .5, .01], 'claude-haiku-4-5': [1, 5, .1],
};
function usdOf(model, u) {
  const p = PRICES[String(model).replace(/-\d{8}$/, '')];
  if (!p) return 0;
  const write = u.cache_creation_input_tokens || 0, hour = u.cache_creation?.ephemeral_1h_input_tokens || 0;
  return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] + (write - hour) * p[0] * 1.25 + hour * p[0] * 2) / 1e6;
}
// the token counts and dollar total of a real cost-state record
console.assert(Math.abs(usdOf('claude-opus-5-5', { input_tokens: 198, output_tokens: 60483, cache_read_input_tokens: 18521905, cache_creation_input_tokens: 819175, cache_creation: { ephemeral_1h_input_tokens: 819175 } }) - 11.468233) < .001, 'usdOf');
let cwd = '';
let followed = null; // a session the user picked to watch; null follows the newest

function send(ev) {
  history.push(ev);
  if (history.length > 8000) history.splice(0, 2000);
  const s = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) c.write(s);
}

const norm = p => p.replace(/\\/g, '/');
function rel(p) {
  if (!p || typeof p !== 'string') return null;
  const n = norm(p);
  const c = norm(cwd);
  if (c && n.toLowerCase().startsWith(c.toLowerCase() + '/')) return n.slice(c.length + 1);
  if (c && n.toLowerCase() === c.toLowerCase()) return null;
  return '⟂/' + n.split('/').filter(Boolean).slice(-2).join('/');
}
const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

function describe(name, input = {}) {
  const n = name || '';
  if (/^(Read)$/.test(n)) return { cat: 'read', label: 'Read', file: rel(input.file_path) };
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n))
    return { cat: 'edit', label: n, file: rel(input.file_path || input.notebook_path) };
  if (/^(Bash|PowerShell|Monitor)$/.test(n))
    return { cat: 'shell', label: clip(input.description || input.command, 70), cmd: clip(input.command, 90) };
  if (/^(Grep|Glob)$/.test(n))
    return { cat: 'search', label: `${n} ${clip(input.pattern, 50)}`, dir: input.path ? rel(input.path) : null };
  if (/^(ToolSearch)$/.test(n)) return { cat: 'search', label: 'ToolSearch ' + clip(input.query, 40) };
  if (/^(WebFetch|WebSearch)$/.test(n) || /firecrawl/i.test(n))
    return { cat: 'web', label: clip(input.url || input.query || n, 70) };
  if (/^(Agent|Task)$/.test(n))
    return { cat: 'agent', label: clip(input.description || input.subagent_type || 'subagent', 50), spawn: true };
  if (/^(SendMessage)$/.test(n)) return { cat: 'agent', label: 'message ' + clip(input.to, 30) };
  if (n === 'Skill') return { cat: 'other', label: 'skill · ' + clip(input.skill, 40), skill: clip(input.skill, 40) }; // the library shelf
  if (n.startsWith('mcp__')) {
    const parts = n.split('__');
    return { cat: 'other', label: `${parts[1]} · ${parts.slice(2).join(' ')}`.replace(/claude_ai_/i, '') };
  }
  return { cat: 'other', label: n };
}

// a finished background job or subagent, from the notice Claude Code queues for the main session
function jobsDone(text) {
  if (typeof text !== 'string' || !/^\s*<task-notification>/.test(text)) return [];
  const status = /<status>(\w+)/.exec(text)?.[1];
  if (!status) return []; // Monitor events have no status: the job is still going
  return [...text.matchAll(/<task-id>(\w+)/g)].map(m => ({ k: 'bgdone', id: m[1], status }));
}
console.assert(jobsDone('<task-notification>\n<task-id>b1</task-id>\n<status>failed</status>\n</task-notification>')[0].status === 'failed' && !jobsDone('<task-notification><task-id>b1</task-id><event>x</event></task-notification>').length && !jobsDone('hello').length, 'jobsDone');

function parse(line, agentFromFile) {
  if (line.length < 2 || line.slice(0, 40).includes('"type":"api-request')) return [];
  let o;
  try { o = JSON.parse(line); } catch { return []; }
  const out = [];
  if (o.cwd && !o.isSidechain && o.cwd !== cwd) {
    cwd = o.cwd;
    out.push({ k: 'project', name: path.basename(norm(cwd)) });
  }
  const ag = o.isSidechain ? o.agentId || agentFromFile || 'agent' : null;
  switch (o.type) {
    case 'ai-title': out.push({ k: 'title', text: o.aiTitle }); break;
    case 'queue-operation':
      if (o.operation === 'enqueue' && !agentFromFile) out.push(...jobsDone(o.content));
      break;
    case 'assistant': {
      const m = o.message || {};
      if (m.id && m.usage) {
        const prev = msgOut.get(m.id) || 0;
        const now = m.usage.output_tokens || 0;
        if (now > prev) { msgOut.set(m.id, now); out.push({ k: 'usage', out: now - prev }); }
        const usd = usdOf(m.model, m.usage), was = msgUsd.get(m.id) || 0;
        if (usd > was) { msgUsd.set(m.id, usd); spent += usd - was; out.push({ k: 'cost', usd: spent }); }
      }
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === 'thinking') out.push({ k: 'think' });
        else if (b.type === 'text' && b.text?.trim()) out.push({ k: 'say', text: clip(b.text.replace(/[*_`#>|]+/g, ''), 120) });
        else if (b.type === 'tool_use') { const d = describe(b.name, b.input); if (!ag) jobLabel.set(b.id, d.label); out.push({ k: 'tool', id: b.id, name: b.name, ...d }); }
      }
      if (!o.isSidechain && m.stop_reason === 'end_turn') out.push({ k: 'end' }); // turn really finished: now waiting for the user
      break;
    }
    case 'user': {
      const c = o.message?.content;
      if (Array.isArray(c)) {
        for (const b of c) if (b.type === 'tool_result') {
          out.push({ k: 'result', id: b.tool_use_id, err: !!b.is_error });
          const txt = typeof b.content === 'string' ? b.content : b.content?.[0]?.text || '', job = /^Command running in background with ID: (\w+)|^Async agent launched[\s\S]*?agentId: (\w+)/.exec(txt);
          if (job && !ag) out.push({ k: 'bg', id: job[1] || job[2], agent: !!job[2], label: jobLabel.get(b.tool_use_id) || 'background job' });
        }
      }
      if (o.origin?.kind === 'task-notification' && !ag) out.push(...jobsDone(typeof c === 'string' ? c : c?.[0]?.text));
      if (o.origin?.kind === 'human' && !o.isSidechain) {
        const texts = typeof c === 'string' ? [c] : (c || []).filter(b => b.type === 'text').map(b => b.text);
        const t = texts.find(t => t && !t.trim().startsWith('<'));
        if (t) out.push({ k: 'prompt', text: clip(t, 140) });
      }
      break;
    }
  }
  const ts = o.timestamp ? Date.parse(o.timestamp) : Date.now();
  for (const e of out) { if (ag) e.ag = ag; e.t = ts; }
  return out;
}

function readNew(file, replay, agentId) {
  let st = tails.get(file);
  if (!st) { st = { offset: 0, rem: Buffer.alloc(0) }; tails.set(file, st); }
  let size;
  try { size = fs.statSync(file).size; } catch { return; }
  if (size < st.offset) { st.offset = 0; st.rem = Buffer.alloc(0); }
  if (size === st.offset) return;
  const buf = Buffer.alloc(size - st.offset);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, st.offset); } finally { fs.closeSync(fd); }
  st.offset = size;
  const all = Buffer.concat([st.rem, buf]);
  const nl = all.lastIndexOf(10);
  if (nl < 0) { st.rem = all; return; }
  st.rem = all.subarray(nl + 1);
  for (const line of all.subarray(0, nl).toString('utf8').split('\n')) {
    for (const ev of parse(line.trim(), agentId)) { if (replay) ev.r = 1; send(ev); }
  }
}

function subagentFiles(s) {
  const dir = path.join(s.projDir, s.sessionId, 'subagents');
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => ({
      file: path.join(dir, f), agentId: f.replace(/^agent-/, '').replace(/\.jsonl$/, ''),
    }));
  } catch { return []; }
}

function listSessions() {
  const res = [];
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT); } catch { return res; }
  for (const d of dirs) {
    if (PIN && !d.toLowerCase().includes(PIN)) continue;
    const pd = path.join(ROOT, d);
    let fl;
    try { fl = fs.readdirSync(pd); } catch { continue; }
    for (const f of fl) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const st = fs.statSync(path.join(pd, f));
        res.push({ file: path.join(pd, f), projDir: pd, sessionId: f.slice(0, -6), mtime: st.mtimeMs });
      } catch {}
    }
  }
  return res;
}

function switchTo(s) {
  current = s;
  history = [];
  tails.clear();
  msgOut = new Map();
  msgUsd = new Map();
  jobLabel = new Map();
  spent = 0;
  cwd = '';
  send({ k: 'reset', session: s.sessionId, t: Date.now() });
  readNew(s.file, true);
  for (const a of subagentFiles(s)) readNew(a.file, true, a.agentId);
  send({ k: 'live', t: Date.now() });
  console.log(`[ironworks] following session ${s.sessionId} (${path.basename(s.projDir)})`);
}

function scan() {
  const all = listSessions();
  if (!all.length) return;
  if (followed) { const f = all.find(x => x.sessionId === followed); if (f) { if (!current || current.file !== f.file) switchTo(f); return; } followed = null; }
  const newest = all.reduce((a, b) => (b.mtime > a.mtime ? b : a));
  if (!current) return switchTo(newest);
  const cur = all.find(x => x.file === current.file);
  const curM = cur ? cur.mtime : 0;
  // Only jump to another session once the current one has been quiet for 20s.
  if (newest.file !== current.file && newest.mtime > curM && Date.now() - curM > 20000) switchTo(newest);
}

function tick() {
  if (!current) return;
  readNew(current.file, false);
  for (const a of subagentFiles(current)) readNew(a.file, false, a.agentId);
}

// Plan usage: Claude Code caches it in ~/.claude.json (undocumented field, so every read is guarded).
// Only the percentages and reset times leave this function, never the account id.
const CONFIG = path.join(os.homedir(), '.claude.json');
let limits = null;
const pick = w => w && typeof w.utilization === 'number' ? { used: w.utilization, resets: w.resets_at || null } : null;
function publishLimits(u, at) {
  const next = { k: 'limits', five: pick(u?.five_hour), week: pick(u?.seven_day), at };
  if (!next.five && !next.week) return;
  if (limits && limits.at && at && at < limits.at) return; // never replace fresher numbers with an older cache
  const s = JSON.stringify(next);
  if (s === JSON.stringify(limits)) return;
  limits = next;
  for (const c of clients) c.write(`data: ${s}\n\n`);
}
function readLimits() {
  try {
    const u = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).cachedUsageUtilization;
    publishLimits(u?.utilization, u?.fetchedAtMs || null);
  } catch {} // file missing or mid-write: keep the last value
}
// Live usage: ask the same endpoint Claude Code uses, with the user's own Claude login (approved by the user).
// The token is read per request, sent only to api.anthropic.com, never logged or forwarded to the page.
// Undocumented endpoint: any failure just leaves the cached numbers in place.
const CREDS = path.join(os.homedir(), '.claude', '.credentials.json');
let liveDelay = 60000;
function fetchLimits() {
  let token;
  try {
    const o = JSON.parse(fs.readFileSync(CREDS, 'utf8')).claudeAiOauth;
    if (o?.accessToken && (!o.expiresAt || o.expiresAt > Date.now() + 30000)) token = o.accessToken;
  } catch {}
  if (!token) return setTimeout(fetchLimits, liveDelay); // logged out or token expired: Claude Code refreshes it, we just wait
  const req = https.request({ host: 'api.anthropic.com', path: '/api/oauth/usage', method: 'GET', timeout: 10000,
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-orbit', Accept: 'application/json' } }, res => {
    let body = '';
    res.on('data', d => { body += d; if (body.length > 1e6) req.destroy(); });
    res.on('end', () => {
      if (res.statusCode === 200) { liveDelay = 60000; try { publishLimits(JSON.parse(body), Date.now()); } catch {} }
      else { liveDelay = Math.min(liveDelay * 2, 15 * 60000); console.log(`[ironworks] usage endpoint answered ${res.statusCode}; retrying in ${liveDelay / 1000}s`); }
      setTimeout(fetchLimits, liveDelay);
    });
  });
  req.on('timeout', () => req.destroy());
  req.on('error', () => { liveDelay = Math.min(liveDelay * 2, 15 * 60000); setTimeout(fetchLimits, liveDelay); });
  req.end();
}

// ---- the Casebook: every past session, parsed on demand with the live parser
function fileEvents(file, agentId) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = []; let last = 0;
  for (const line of text.split('\n')) for (const ev of parse(line.trim(), agentId)) { if (ev.k === 'cost') { ev.d = ev.usd - last; last = ev.usd; } out.push(ev); }
  return out;
}
function sessionEvents(s) { // the parser keeps per-session state in globals, so park the live session's and put it back
  const live = { cwd, msgOut, msgUsd, jobLabel, spent };
  const fresh = () => { cwd = ''; msgOut = new Map(); msgUsd = new Map(); jobLabel = new Map(); spent = 0; };
  try {
    fresh(); const evs = fileEvents(s.file);
    for (const a of subagentFiles(s)) { const keep = cwd; fresh(); cwd = keep; evs.push(...fileEvents(a.file, a.agentId)); }
    return evs.sort((a, b) => a.t - b.t);
  } finally { ({ cwd, msgOut, msgUsd, jobLabel, spent } = live); }
}
function summarize(s, evs) {
  const r = { id: s.sessionId, project: '', title: '', start: evs[0]?.t || s.mtime, end: evs[evs.length - 1]?.t || s.mtime, active: 0, cost: 0, tools: 0, edits: 0, fails: 0, agents: 0, cats: {}, files: {}, turns: [] };
  let prev = null, turn = null; const tools = new Map();
  for (const e of evs) {
    if (prev != null && e.t - prev < 5 * 60e3) r.active += e.t - prev; prev = e.t;
    if (e.k === 'project') r.project = e.name; if (e.k === 'title') r.title = e.text;
    if (e.k === 'prompt') { turn = { text: e.text, t: e.t, dur: 0, cost: 0, tools: 0, edits: 0, fails: 0 }; r.turns.push(turn); }
    if (turn) turn.dur = e.t - turn.t;
    if (e.k === 'cost') { r.cost += e.d; if (turn) turn.cost += e.d; }
    if (e.k === 'tool') {
      r.tools++; if (turn) turn.tools++; r.cats[e.cat] = (r.cats[e.cat] || 0) + 1; if (e.spawn) r.agents++; tools.set(e.id, e);
      if (e.file) { const f = r.files[e.file] ??= { r: 0, e: 0 }; if (e.cat === 'edit') { f.e++; r.edits++; if (turn) turn.edits++; } else f.r++; }
    }
    if (e.k === 'result' && e.err) { r.fails++; if (turn) turn.fails++; }
  }
  return r;
}
{ const t = summarize({ sessionId: 'x', mtime: 0 }, [{ k: 'prompt', text: 'a', t: 0 }, { k: 'cost', d: 1.5, t: 10 }, { k: 'tool', id: '1', cat: 'edit', file: 'f', t: 20 }, { k: 'result', id: '1', err: true, t: 30 }]); console.assert(t.cost === 1.5 && t.edits === 1 && t.fails === 1 && t.turns[0].dur === 30 && t.turns[0].cost === 1.5, 'summarize'); }
const cases = new Map(); // file -> { size, row }
let casebookBusy = false;
function buildCases() {
  if (casebookBusy) return; casebookBusy = true;
  const todo = listSessions().sort((a, b) => b.mtime - a.mtime).slice(0, 400).filter(s => { const c = cases.get(s.file); return !c || c.mtime !== s.mtime; });
  const step = () => { // one file per tick so the live view keeps moving
    const s = todo.shift(); if (!s) { casebookBusy = false; return; }
    try { const evs = sessionEvents(s); if (evs.some(e => e.k === 'prompt')) cases.set(s.file, { mtime: s.mtime, row: summarize(s, evs) }); else cases.set(s.file, { mtime: s.mtime, row: null }); } catch (e) { console.log('[ironworks] skipped a transcript:', e.message); }
    setImmediate(step);
  };
  step();
}
const LOCAL_HOST = new RegExp(`^(localhost|127\\.0\\.0\\.1):${PORT}$`); // these routes show prompts from every project, so a page on another site can't reach them through a rebinding DNS name
const sendJson = (res, o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
function api(req, res) {
  if (!LOCAL_HOST.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/sessions') {
    buildCases();
    const rows = [...cases.values()].map(c => c.row).filter(Boolean).sort((a, b) => b.start - a.start);
    return sendJson(res, { rows, done: casebookBusy ? cases.size : Math.max(cases.size, 0), total: casebookBusy ? cases.size + 1 : cases.size, followed, current: current?.sessionId });
  }
  if (u.pathname === '/api/replay') {
    const s = listSessions().find(x => x.sessionId === u.searchParams.get('id')); // looked up in the real list, never joined into a path
    if (!s) return sendJson(res, { error: 'not found' }, 404);
    return sendJson(res, sessionEvents(s));
  }
  if (u.pathname === '/api/hook' && req.method === 'POST') { // Claude Code's Notification hook (curl from this machine): a permission prompt just opened
    if (req.headers.origin || !LOCAL_HOST.test(req.headers.host || '')) { res.writeHead(403); return res.end(); } // never from a web page
    let body = ''; req.on('data', d => { body += d; if (body.length > 20000) req.destroy(); });
    return req.on('end', () => {
      let h = null; try { h = JSON.parse(body); } catch { return sendJson(res, { error: 'bad body' }, 400); }
      const ask = h.notification_type ? /permission|elicitation/.test(h.notification_type) : /permission/i.test(h.message || '');
      if (ask && current && h.session_id === current.sessionId) { const s = `data: ${JSON.stringify({ k: 'ask', text: clip(h.message, 90), t: Date.now() })}\n\n`; for (const c of clients) c.write(s); } // live only, not kept in history: a reload shouldn't replay an old prompt
      sendJson(res, { ok: true });
    });
  }
  if (u.pathname === '/api/follow' && req.method === 'POST') {
    const origin = req.headers.origin; if (origin && !LOCAL_HOST.test(origin.replace(/^https?:\/\//, ''))) { res.writeHead(403); return res.end(); }
    let body = ''; req.on('data', d => { body += d; if (body.length > 2000) req.destroy(); });
    return req.on('end', () => { let id = null; try { id = JSON.parse(body).id; } catch { return sendJson(res, { error: 'bad body' }, 400); } if (id !== null && !listSessions().some(x => x.sessionId === id)) return sendJson(res, { error: 'not found' }, 404); followed = id; sendJson(res, { followed }); });
  }
  res.writeHead(404); res.end();
}
const INDEX = path.join(__dirname, 'public', 'index.html');
const openUrl = url => exec(process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`);
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/events')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ k: 'batch', events: history })}\n\n`);
    if (limits) res.write(`data: ${JSON.stringify(limits)}\n\n`);
    clients.add(res);
    const ka = setInterval(() => res.write(': ka\n\n'), 15000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }
  if (req.url.split('?')[0] === '/favicon.ico') { // ?v= busts the browser's icon cache
    res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'max-age=86400' });
    return fs.createReadStream(path.join(__dirname, 'public', 'favicon.ico')).pipe(res);
  }
  if (req.url.startsWith('/api/')) return api(req, res);
  if (req.url === '/extras.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return fs.createReadStream(path.join(__dirname, 'public', 'extras.js')).pipe(res); }
  if (req.url === '/casebook') { if (!LOCAL_HOST.test(req.headers.host || '')) { res.writeHead(403); return res.end(); } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return fs.createReadStream(path.join(__dirname, 'public', 'casebook.html')).pipe(res); }
  if (req.url.startsWith('/models/')) { // only plain file names from public/models, never a path
    const name = req.url.slice(8).split('?')[0], type = { gltf: 'model/gltf+json', bin: 'application/octet-stream', glb: 'model/gltf-binary', png: 'image/png' }[name.split('.').pop()];
    if (!/^[\w-]+\.(gltf|bin|glb|png)$/.test(name) || !type || !fs.existsSync(path.join(__dirname, 'public', 'models', name))) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'max-age=3600' }); return fs.createReadStream(path.join(__dirname, 'public', 'models', name)).pipe(res);
  }
  if (req.url.split('?')[0] === '/grimm.ico') {
    res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'max-age=86400' });
    return fs.createReadStream(path.join(__dirname, 'public', 'grimm.ico')).pipe(res);
  }
  if (req.url.split('?')[0] === '/kitchen.ico') {
    res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'max-age=86400' });
    return fs.createReadStream(path.join(__dirname, 'public', 'kitchen.ico')).pipe(res);
  }
  if (req.url === '/kitchen' || req.url.startsWith('/kitchen?')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'public', 'kitchen.html')).pipe(res);
  }
  if (req.url === '/grimm' || req.url.startsWith('/grimm?')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'public', 'grimm.html')).pipe(res);
  }
  if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(INDEX).pipe(res);
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`[ironworks] ${url}  (watching ${ROOT}${PIN ? `, filter "${PIN}"` : ''})`);
  scan();
  setInterval(scan, 2500);
  setInterval(tick, 350);
  // re-read as soon as Claude Code rewrites its config (it refreshes usage on its own schedule)
  readLimits(); fs.watchFile(CONFIG, { interval: 2000 }, readLimits);
  if (!args.includes('--no-live-usage')) fetchLimits();
  if (OPEN) openUrl(url + START);
});
server.on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  // Already running: just open the page and exit.
  console.log(`[ironworks] already running on port ${PORT}, opening it`);
  if (OPEN) openUrl(`http://localhost:${PORT}${START}`);
  setTimeout(() => process.exit(0), 500);
});
