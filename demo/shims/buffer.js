// UTF-8 без TextEncoder/TextDecoder (их может не быть в движке React Native)
function utf8enc(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) { c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00); }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}
function utf8dec(b) {
  let s = '';
  for (let i = 0; i < b.length;) {
    const c = b[i++];
    let cp = c < 0x80 ? c : c < 0xe0 ? ((c & 31) << 6) | (b[i++] & 63) : c < 0xf0 ? ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63)
      : ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    s += String.fromCodePoint(cp);
  }
  return s;
}
class Buffer extends Uint8Array {
  static alloc(n) { return new Buffer(n); }
  static from(x, e) {
    if (typeof x === 'string') {
      if (e === 'hex') { const b = new Buffer(x.length >> 1); for (let i = 0; i < b.length; i++) b[i] = parseInt(x.substr(i * 2, 2), 16); return b; }
      const u = utf8enc(x); const b = new Buffer(u.length); b.set(u); return b;
    }
    const b = new Buffer(x.length); b.set(x); return b;
  }
  toString(e) { return e === 'hex' ? Array.from(this, (v) => v.toString(16).padStart(2, '0')).join('') : utf8dec(this); }
}
module.exports = { Buffer, utf8enc };
