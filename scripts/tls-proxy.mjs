// Dev tool: a minimal HTTPS + WSS terminating reverse proxy, like a hosting platform's edge.
// Adds X-Forwarded-Proto/For/Host. Usage: node scripts/tls-proxy.mjs <listenPort> <targetPort> <certPem> <keyPem>
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
const [listen = '8443', target = '10000', cert, key] = process.argv.slice(2);
const fwd = (req) => ({ ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': req.socket.remoteAddress ?? '', 'x-forwarded-host': req.headers.host ?? '' });
const server = https.createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => {
  const up = http.request({ host: '127.0.0.1', port: Number(target), method: req.method, path: req.url, headers: fwd(req) }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => (res.headersSent ? res.end() : (res.writeHead(502), res.end('upstream down'))));
  req.pipe(up);
});
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(Number(target), '127.0.0.1', () => {
    const h = fwd(req);
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});
server.listen(Number(listen), () => console.log(`[tls-proxy] https://localhost:${listen} -> http://127.0.0.1:${target}`));
