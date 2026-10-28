const crypto = require('node:crypto');
function endpoint(value) {
  const url = new URL(String(value || 'http://127.0.0.1:8765'));
  const loopback = ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use HTTPS, ou HTTP em localhost, sem credenciais/caminho na URL.');
  return url.origin;
}
function key(workspace, mode) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspace) || !['notes','full'].includes(mode)) throw new Error('Workspace/modo inválido');
  return `${workspace}:${mode}`;
}
function windowURL(base, workspace, mode, previous) {
  endpoint(base); key(workspace,mode);
  const url = new URL(previous || base);
  if (url.origin !== base) throw new Error('Origem diferente do servidor configurado');
  url.pathname='/'; url.search=''; url.searchParams.set('desktop_workspace',workspace);
  if(mode==='notes')url.searchParams.set('compact','1');
  if(!previous)url.hash=mode==='notes'?'notes':'home';
  return url.toString();
}
function bounds(saved,area,mode) {
  const width=Math.min(area.width,Math.max(320,Number(saved?.width)||(mode==='notes'?480:1180)));
  const height=Math.min(area.height,Math.max(320,Number(saved?.height)||760));
  return {width,height,x:Math.min(area.x+area.width-width,Math.max(area.x,Number.isFinite(saved?.x)?saved.x:area.x+30)),y:Math.min(area.y+area.height-height,Math.max(area.y,Number.isFinite(saved?.y)?saved.y:area.y+30))};
}
function partition(workspace) { return 'persist:metis-work-'+crypto.createHash('sha256').update(workspace).digest('hex').slice(0,20); }
module.exports={endpoint,key,windowURL,bounds,partition};
