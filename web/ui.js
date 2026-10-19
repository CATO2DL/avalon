export function el(tag, className = '', text) {
  const n = document.createElement(tag); n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
const paths = {
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  crown: 'M3 6l4 4 5-7 5 7 4-4-2 13H5z',
  settings: 'M9 3h6l.5 2.5 2 1.2 2.4-.8 2 3.5L20 11v2l1.9 1.6-2 3.5-2.4-.8-2 1.2L15 21H9l-.5-2.5-2-1.2-2.4.8-2-3.5L4 13v-2L2.1 9.4l2-3.5 2.4.8 2-1.2zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7',
  check: 'M5 12l4 4L19 6', close: 'M6 6l12 12M6 18L18 6', plus: 'M12 5v14M5 12h14',
  sword: 'M5 3l14 14M3 5l14 14M3 3l5 1-4 4zM13 19l6-6M16 20l4-4M19 19l2 2M19 3L5 17M21 5L7 19M21 3l-5 1 4 4zM5 13l6 6M4 16l4 4M5 19l-2 2',
  shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z',
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('icon');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] ?? paths.shield);
  path.setAttribute('fill', name === 'crown' ? 'currentColor' : 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.7'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  svg.append(path); return svg;
}
const colors = ['#23c2bd','#9d83df','#df9b62','#79b4d5','#db839a','#8bbf87','#cea84f','#7d9bdc','#b9a497','#69baad'];
export function avatar(index) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox','0 0 64 64'); svg.setAttribute('aria-hidden','true');
  const shape = (tag, attrs) => { const n = document.createElementNS(svg.namespaceURI,tag); for (const [k,v] of Object.entries(attrs)) n.setAttribute(k,v); svg.append(n); };
  shape('circle',{cx:32,cy:32,r:31,fill:colors[index % 10]});
  shape('path',{d:'M0 46L64 10V64H0Z',fill:'#062b43',opacity:'.25'});
  const patterns = ['M32 10L50 32 32 54 14 32Z','M12 20H52L32 52Z','M16 14H48V50H16Z','M10 30L32 12 54 30 32 52Z','M16 12L48 32 16 52Z','M14 18H50L40 48H24Z','M32 10L52 48H12Z','M12 12L52 52M52 12L12 52','M10 24H54M10 40H54','M24 10V54M40 10V54'];
  shape('path',{d:patterns[index % 10],fill:'none',stroke:'#f1f3df','stroke-width':'5','stroke-linejoin':'round','stroke-linecap':'round'});
  shape('circle',{cx:32,cy:32,r:4,fill:'#13314c'});
  return svg;
}
export function button(text, handler, cls = '') {
  const b = el('button',cls,text); b.type='button'; b.addEventListener('click',handler); return b;
}

// Only reuse this player's explicit private knowledge; never infer allies from disabled targets.
export function assassinationTeammateIds(playerView) {
  if (playerView?.public.phase !== 'assassination' || playerView.self.alignment !== 'evil') return [];
  return (playerView.self.assassinationRoles ?? [])
    .filter(info => info.alignment === 'evil' && info.playerId !== playerView.self.playerId)
    .map(info => info.playerId);
}
