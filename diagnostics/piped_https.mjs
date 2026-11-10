// Loopback-only TLS transport for the real Piped services in disposable CI.
// Certificates are issued by a CA trusted by this test runner and Chromium.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
const [certFile, keyFile] = process.argv.slice(2);
https.createServer({cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile)}, (req,res) => {
  const isApi = req.url.startsWith('/api/');
  const upstream = http.request({hostname:'127.0.0.1', port:isApi ? 8091 : 8092,
    method:req.method, path:isApi ? req.url.slice(4) : req.url, headers:req.headers}, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
    response.on('error', () => res.destroy());
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}).listen(8443, '127.0.0.1', () => console.log('Piped CI TLS transport ready on loopback'));
