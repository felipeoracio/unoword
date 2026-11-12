/** Serve built public files and SPA routes for isolated browser fixtures. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
exports.start=async(options={})=>{
 const dist=options.dist?path.resolve(options.dist):path.resolve(__dirname,'../../frontend/dist');
 if(!fs.existsSync(path.join(dist,'index.html')))throw Error('Build the frontend before running browser fixtures');
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff':'font/woff','.woff2':'font/woff2','.zip':'application/zip'};
 const server=http.createServer((req,res)=>{
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
  if(pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"detail":"API must be supplied by an isolated test fixture"}');return;}
  let file=path.resolve(dist,'.'+pathname);
  if(file!==dist&&!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){
   // Vercel's SPA fallback also handles legacy *.html deep links.
   if(path.extname(pathname)&&path.extname(pathname)!=='.html'){res.writeHead(404);res.end();return;}
   file=path.join(dist,'index.html');
  }
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(res);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
};
