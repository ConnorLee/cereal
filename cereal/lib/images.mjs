// Image dimensions from the first bytes of a file, without decoding it. PNG, JPEG, GIF, WebP and SVG.
export const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

export function imageSize(buf, ext) {
  if (!buf || buf.length < 24) return null;
  ext = String(ext || '').toLowerCase();
  // PNG: IHDR is always the first chunk.
  if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  // GIF
  if (buf.toString('ascii', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  // WebP (lossy, lossless, extended)
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  }
  // JPEG: walk segments to the first start-of-frame marker.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  // SVG: width/height attributes, else the viewBox.
  if (ext === 'svg' || buf.toString('utf8', 0, 400).includes('<svg')) {
    const head = buf.toString('utf8', 0, 4000);
    const tag = /<svg\b[^>]*>/i.exec(head)?.[0] || '';
    const num = (name) => { const m = new RegExp(`\\b${name}="([\\d.]+)(px)?"`, 'i').exec(tag); return m ? Number(m[1]) : null; };
    const vb = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/i.exec(tag);
    const w = num('width') || (vb && Number(vb[1]));
    const h = num('height') || (vb && Number(vb[2]));
    return w && h ? { w, h } : null;
  }
  return null;
}
