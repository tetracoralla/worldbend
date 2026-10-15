// First-party book artwork. These canvases also supply the native still/video source files.
export function artwork(alternate = false) {
  const make = (width, height) => { const image = document.createElement('canvas'); image.width = width; image.height = height; return image; };
  const cover = make(600, 800), c = cover.getContext('2d');
  c.fillStyle = alternate ? '#e0ad35' : '#267c87'; c.fillRect(0, 0, 600, 800);
  c.fillStyle = '#182725'; c.beginPath(); c.ellipse(595, 540, 310, 360, -.2, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#f5f0df'; c.font = '700 90px Arial';
  ['Across', 'the', 'ordinary.'].forEach((line, index) => c.fillText(line, 36, 153 + index * 99));
  c.font = '22px Arial'; c.fillText('FIELD NOTES', 38, 52);
  c.fillText(alternate ? '2027 / 02' : '2026 / 10', 38, 750);
  c.strokeStyle = '#f5f0df'; c.lineWidth = 2; c.beginPath(); c.moveTo(38, 690); c.lineTo(170, 690); c.stroke();
  const spine = make(64, 800), s = spine.getContext('2d');
  s.fillStyle = alternate ? '#b58020' : '#1e5860'; s.fillRect(0, 0, 64, 800);
  s.save(); s.translate(39, 60); s.rotate(Math.PI / 2); s.fillStyle = '#f5f0df'; s.font = '23px Arial'; s.fillText('Across the ordinary.', 0, 0); s.restore();
  const shadow = make(600, 240), h = shadow.getContext('2d');
  const gradient = h.createRadialGradient(300, 120, 0, 300, 120, 275);
  gradient.addColorStop(0, 'rgba(29,35,31,.32)'); gradient.addColorStop(.4, 'rgba(29,35,31,.18)'); gradient.addColorStop(1, 'rgba(29,35,31,0)');
  h.scale(1, .4); h.fillStyle = gradient; h.fillRect(0, 0, 600, 600);
  return [{id:'shadow',image:shadow},{id:'spine',image:spine},{id:'cover',image:cover}];
}
