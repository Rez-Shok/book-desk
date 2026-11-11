// A tiny web server that writes down every request it gets. The hostile test book points at it from every place a
// book could try to fetch something; after the test the log must be empty.
//   node tests/app/canary-server.mjs <port> <log file>
import http from 'node:http';
import fs from 'node:fs';
const port = Number(process.argv[2] || 47831), log = process.argv[3] || 'canary.log';
fs.writeFileSync(log, '');
http.createServer((req, res) => {
  fs.appendFileSync(log, `${req.method} ${req.url}\n`);
  res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' });
  res.end();
}).listen(port, '127.0.0.1', () => console.log('canary listening on', port));
