const http = require('http');
const fs = require('fs');
const path = require('path');
const port = process.env.PORT || 3000;
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const full = path.normalize(path.join(root,p));
  if (!full.startsWith(root)) {res.writeHead(403); return res.end('Forbidden');}
  fs.readFile(full,(err,data)=>{
    if(err){fs.readFile(path.join(root,'index.html'),(e,d)=>{if(e){res.writeHead(404);res.end('Not found')}else{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(d)}});return;}
    res.writeHead(200,{'Content-Type':types[path.extname(full)]||'application/octet-stream'});res.end(data);
  });
}).listen(port,()=>console.log('Tsubera tracker listening on '+port));
