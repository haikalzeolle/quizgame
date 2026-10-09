const http = require('http'), fs = require('fs'), path = require('path');
const store = {}, clients = new Set();
const push = () => { const m = 'data: ' + JSON.stringify(store) + '\n\n'; clients.forEach(r => r.write(m)); };

// This code runs inside the browser and replaces the claude.ai database
function shim() {
  const store = {}, subs = []; let loaded = false;
  const host = location.pathname === '/host';
  let id = sessionStorage.getItem('qid');
  if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('qid', id); }
  const notify = () => subs.forEach(f => f());
  const es = new EventSource('/events');
  es.onmessage = e => {
    const s = JSON.parse(e.data);
    Object.keys(store).forEach(k => delete store[k]);
    Object.assign(store, s); loaded = true; notify();
  };
  const db = {
    doc: p => ({
      set: d => {
        store[p] = JSON.parse(JSON.stringify(d)); notify();
        return fetch('/set', { method: 'POST', body: JSON.stringify({ path: p, data: d }) }).then(() => {});
      },
      onSnapshot: fn => {
        const f = () => fn({ id: p.split('/').pop(), exists: p in store, data: () => store[p] });
        subs.push(f); if (loaded) f(); return () => {};
      }
    }),
    collection: c => ({
      onSnapshot: fn => {
        const f = () => fn({ docs: Object.keys(store).filter(k => k.startsWith(c + '/')).map(k => ({ id: k.slice(c.length + 1), data: () => store[k] })) });
        subs.push(f); if (loaded) f(); return () => {};
      }
    })
  };
  const user = { isOwner: () => host, id: async () => id };
  window.claude = { use: async n => n === 'db' ? db : n === 'user' ? user : null };
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    clients.add(res); res.write('data: ' + JSON.stringify(store) + '\n\n');
    req.on('close', () => clients.delete(res)); return;
  }
  if (url === '/set' && req.method === 'POST') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => {
      try { const { path: p, data } = JSON.parse(b); store[p] = data; push(); res.end('ok'); }
      catch (e) { res.statusCode = 400; res.end('bad'); }
    }); return;
  }
  if (url === '/shim.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end('(' + shim.toString() + ')()'); }
  if (url === '/host' && process.env.HOST_KEY && new URL(req.url, 'http://x').searchParams.get('key') !== process.env.HOST_KEY) {
    res.statusCode = 403; res.end('Wrong host key. Use /host?key=YOUR_KEY'); return;
  }
  if (url === '/' || url === '/host') {
    const f = fs.readdirSync(__dirname).find(n => n.toLowerCase().endsWith('.html'));
    if (!f) { res.end('No .html file found in folder: ' + __dirname); return; }
    const html = fs.readFileSync(path.join(__dirname, f), 'utf8').replace('<body>', '<body><script src="/shim.js"></script>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html);
  }
  res.statusCode = 404; res.end('not found');
}).listen(process.env.PORT || 3000, () => console.log('Quiz running on port ' + (process.env.PORT || 3000)));
