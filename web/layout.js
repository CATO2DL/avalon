// Public geometry only. Role and alignment never enter this function.
export function ringLayout(count, width, selfIndex = 0) {
  if (!Number.isInteger(count) || count < 5 || count > 10) throw new Error('Unsupported player count');
  const base = count <= 6 ? 54 : count <= 8 ? 48 : 44;
  const avatar = Math.max(44, Math.round(base * Math.min(1.25, Math.max(0.9, width / 350))));
  const seatWidth = avatar + 12;
  const seatHeight = avatar + 40;
  const rx = Math.max(60, (width - seatWidth) / 2 - 5);
  let ry = Math.max(100, width * .31);
  const points = r => Array.from({ length: count }, (_, i) => {
    const angle = Math.PI / 2 + ((i - selfIndex + count) % count) * 2 * Math.PI / count;
    return { x: width / 2 + Math.cos(angle) * rx, y: seatHeight / 2 + 12 + r + Math.sin(angle) * r };
  });
  const overlaps = ps => ps.some((a, i) => ps.slice(i + 1).some(b => Math.abs(a.x - b.x) < seatWidth + 5 && Math.abs(a.y - b.y) < seatHeight + 5));
  const discSize = Math.min(144, Math.max(104, width * .30));
  const hitsDisc = ps => ps.some(p => {
    const dx = Math.max(0, Math.abs(p.x-width/2)-seatWidth/2);
    const dy = Math.max(0, Math.abs(p.y-(seatHeight/2+12+ry))-seatHeight/2);
    return Math.hypot(dx,dy) < discSize/2+8;
  });
  while ((overlaps(points(ry)) || hitsDisc(points(ry))) && ry < 650) ry += 4;
  return { discSize, avatar, seatWidth, seatHeight, height: 2 * ry + seatHeight + 24, centerY: seatHeight / 2 + 12 + ry, rx, ry, points: points(ry) };
}
