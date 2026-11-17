// Shared tools for both scenes: alerts, budget, usage forecast, session picker, replay, wallpaper mode. No model calls.
(() => {
  const params = new URLSearchParams(location.search), replayId = params.get('replay'), demo = params.has('demo');
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('extras-' + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('extras-' + k, JSON.stringify(v)); } catch {} } };
  const css = document.createElement('style');
  css.textContent = `#xt{position:fixed;z-index:9;right:0;top:46%;transform:translateY(-50%);display:flex;align-items:flex-start;font:12px ui-monospace,Consolas,monospace;color:#eee}
  #xt button,#xt select,#xt input{font:inherit;color:#eee;background:#1b1b1e;border:1px solid #555;padding:3px 6px}#xt button{cursor:pointer}#xt button:hover{background:#2b2b30}#xt button[aria-pressed=true]{background:#c8623c;border-color:#c8623c}
  #xt :focus-visible{outline:2px solid #e8a84a;outline-offset:1px}#xtTab{writing-mode:vertical-rl;padding:8px 3px!important;border-right:0!important}#xtBody{background:rgba(12,12,14,.93);border:1px solid #444;padding:10px;width:250px;display:grid;gap:8px}#xtBody[hidden]{display:none}
  #xtBody a{color:#e8a84a}#xtBody label{display:flex;gap:6px;align-items:center;justify-content:space-between}#xtBody select{max-width:150px}#xtBody input{width:70px}#xtFc{color:#bbb;line-height:1.35}
  #xtReplay{position:fixed;z-index:9;left:50%;top:14px;transform:translateX(-50%);display:flex;gap:6px;align-items:center;background:rgba(12,12,14,.93);border:1px solid #444;padding:5px 9px;font:12px ui-monospace,Consolas,monospace;color:#eee}#xtReplay button{font:inherit;color:#eee;background:#1b1b1e;border:1px solid #555;padding:2px 7px;cursor:pointer}#xtReplay button[aria-pressed=true]{background:#c8623c}#xtBar{width:150px;height:6px;background:#333}#xtBar i{display:block;height:100%;width:0;background:#e8a84a}
  body.kiosk .hud,body.kiosk #tl,body.kiosk #tr,body.kiosk #xt{display:none!important}`;
  document.head.append(css);
  const el = document.createElement('div'); el.id = 'xt';
  el.innerHTML = `<button id="xtTab" type="button" aria-expanded="false">TOOLS</button><div id="xtBody" hidden>
    <a href="/casebook" target="_blank" rel="noopener">Open the Casebook</a>
    <label>Follow <select id="xtSess" aria-label="Session to follow"><option value="">newest (auto)</option></select></label>
    <label>Desktop alerts <button id="xtAlert" type="button" aria-pressed="false">off</button></label>
    <label>Chime <button id="xtChime" type="button" aria-pressed="false">off</button></label>
    <label>Session budget $ <input id="xtBudget" type="number" min="0" step="0.5" aria-label="Session budget in dollars"></label>
    <div id="xtFc" role="status">5 h forecast: waiting for data</div>
    <div>H hides everything (wallpaper mode)</div></div>`;
  document.body.append(el);
  const $ = s => document.querySelector(s), S = { alert: store.get('alert', false), chime: store.get('chime', false), budget: store.get('budget', 0) };
  $('#xtTab').onclick = () => { const b = $('#xtBody'); b.hidden = !b.hidden; $('#xtTab').setAttribute('aria-expanded', String(!b.hidden)); if (!b.hidden) loadSessions(); };
  const paint = () => { for (const [id, on] of [['#xtAlert', S.alert], ['#xtChime', S.chime]]) { $(id).textContent = on ? 'on' : 'off'; $(id).setAttribute('aria-pressed', String(on)); } }; paint();
  $('#xtBudget').value = S.budget || '';
  $('#xtBudget').onchange = e => { S.budget = Math.max(0, +e.target.value || 0); store.set('budget', S.budget); budgetHit = false; };
  $('#xtAlert').onclick = async () => { if (!S.alert && 'Notification' in window && Notification.permission !== 'granted') { if (await Notification.requestPermission() !== 'granted') return alert('Desktop alerts are blocked for this page in the browser settings.'); } S.alert = !S.alert; store.set('alert', S.alert); paint(); };
  let ac; $('#xtChime').onclick = () => { S.chime = !S.chime; store.set('chime', S.chime); paint(); if (S.chime) { ac ??= new AudioContext(); ac.resume(); chime(); } };
  function chime() { if (!S.chime || !ac) return; [523, 784].forEach((f, i) => { const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * .16; o.frequency.value = f; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .4); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + .42); }); }
  function shout(title, body) { chime(); if (S.alert && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body: String(body || '').slice(0, 120), icon: location.pathname.startsWith('/grimm') ? '/grimm.ico' : '/favicon.ico', tag: title }); }
  addEventListener('keydown', e => { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('kiosk'); });
  if (params.has('kiosk')) document.body.classList.add('kiosk');

  // ---- session picker
  async function loadSessions() {
    try {
      const d = await (await fetch('/api/sessions')).json(), sel = $('#xtSess'); sel.length = 1;
      d.rows.slice(0, 15).forEach(r => { const o = document.createElement('option'); o.value = r.id; o.textContent = `${r.project || '?'}: ${(r.title || r.id).slice(0, 24)}`; sel.append(o); });
      if (d.followed) sel.value = d.followed;
    } catch {}
  }
  $('#xtSess').onchange = e => fetch('/api/follow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.target.value || null }) });

  // ---- how long the 5-hour window will last at this pace
  function forecast(samples, now) {
    const last = samples[samples.length - 1]; if (!last) return null;
    const first = samples.find(s => last.t - s.t >= 10 * 60e3 && s.resets === last.resets); if (!first || last.used <= first.used) return { used: last.used };
    const perMs = (last.used - first.used) / (last.t - first.t); return { used: last.used, out: now + (100 - last.used) / perMs, resets: last.resets ? Date.parse(last.resets) : null };
  }
  { const t0 = Date.parse('2026-01-01T00:00:00Z'), f = forecast([{ t: t0, used: 10, resets: 'r' }, { t: t0 + 20 * 60e3, used: 20, resets: 'r' }], t0 + 20 * 60e3); console.assert(Math.abs(f.out - (t0 + 180 * 60e3)) < 1000, 'forecast'); }
  let samples = store.get('samples', []);
  function onLimits(ev) {
    if (!ev.five) return;
    const t = Date.now(); if (samples.length && samples[samples.length - 1].resets !== ev.five.resets) samples = [];
    if (!samples.length || t - samples[samples.length - 1].t > 50000) { samples.push({ t, used: ev.five.used, resets: ev.five.resets }); samples = samples.slice(-400); store.set('samples', samples); }
    const f = forecast(samples, t), hm = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('#xtFc').textContent = !f ? '' : !f.out ? `5 h window: ${Math.round(f.used)}% used, no burn rate yet` : f.resets && f.out > f.resets ? `5 h window: ${Math.round(f.used)}% used, lasts past the ${hm(f.resets)} reset at this pace` : `5 h window: ${Math.round(f.used)}% used, runs out about ${hm(f.out)} at this pace`;
  }

  // ---- watching the live session
  let budgetHit = false; const base = document.title, running = new Map(); let warned = new Set(), bg = 0, title = '';
  const setTab = s => { document.title = s ? `${s} · ${base}` : base; };
  function onEvent(ev) {
    if (ev.k === 'limits') return onLimits(ev);
    if (ev.k === 'batch') { for (const e of ev.events) { if (e.k === 'title') title = e.text; if (e.k === 'cost' && S.budget && e.usd >= S.budget) budgetHit = true; } return; }
    if (ev.k === 'reset') { running.clear(); warned.clear(); bg = 0; budgetHit = false; return; }
    if (ev.r) { if (ev.k === 'title') title = ev.text; return; }
    if (ev.k === 'title') title = ev.text;
    if (ev.k === 'cost' && S.budget && ev.usd >= S.budget && !budgetHit) { budgetHit = true; shout(`Budget reached: $${ev.usd.toFixed(2)}`, title); }
    if (ev.k === 'tool' && !ev.ag) { running.set(ev.id, ev); setTab('● ' + (ev.label || ev.cat).slice(0, 28)); }
    if (ev.k === 'result') running.delete(ev.id);
    if (ev.k === 'bg') bg++;
    if (ev.k === 'bgdone') { bg = Math.max(0, bg - 1); shout(ev.status === 'failed' ? 'Background job failed' : 'Background job finished', title); }
    if (ev.k === 'prompt') { setTab('● on it'); warned.clear(); }
    if (ev.k === 'end') { running.clear(); setTab(bg ? '… waiting on a job' : '✓ done'); if (!bg) shout('Claude finished', title); }
  }
  setInterval(() => { for (const [id, e] of running) if (Date.now() - e.t > 3 * 60e3 && !warned.has(id)) { warned.add(id); shout('Still running after 3 minutes', e.label); } }, 15000);
  if (!replayId && !demo) { const es = new EventSource('/events'); es.onmessage = m => { try { onEvent(JSON.parse(m.data)); } catch {} }; }

  // ---- replay any past session, fed straight into the scene
  if (replayId) {
    const bar = document.createElement('div'); bar.id = 'xtReplay'; bar.innerHTML = `<span>REPLAY</span><div id="xtBar"><i></i></div><span id="xtPos"></span><button id="xtPause" type="button">pause</button>${[2, 8, 30].map(s => `<button type="button" data-s="${s}" aria-pressed="${s === 8}">${s}×</button>`).join('')}<a href="${location.pathname}" style="color:#e8a84a">live</a>`; document.body.append(bar);
    let speed = 8, paused = false, i = 0, evs = [];
    bar.querySelectorAll('[data-s]').forEach(b => { b.onclick = () => { speed = +b.dataset.s; bar.querySelectorAll('[data-s]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }; });
    $('#xtPause').onclick = () => { paused = !paused; $('#xtPause').textContent = paused ? 'play' : 'pause'; };
    const step = () => {
      if (paused) return setTimeout(step, 200);
      if (i >= evs.length) { $('#xtPos').textContent = 'finished'; return; }
      const e = evs[i++], next = evs[i]; window.__feed({ ...e, t: Date.now() });
      $('#xtBar i').style.width = (i / evs.length * 100) + '%'; $('#xtPos').textContent = `${i} / ${evs.length}`;
      setTimeout(step, next ? Math.max(30, Math.min(2500, (next.t - e.t) / speed)) : 0); // long silences are cut short, nobody wants to watch a coffee break
    };
    fetch('/api/replay?id=' + encodeURIComponent(replayId)).then(r => { if (!r.ok) throw 0; return r.json(); }).then(d => { evs = d; const wait = () => window.__feed ? (window.__feed({ k: 'reset', session: replayId, t: Date.now() }), step()) : setTimeout(wait, 100); wait(); }).catch(() => { $('#xtPos').textContent = 'session not found'; });
  }
})();
