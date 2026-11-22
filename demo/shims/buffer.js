class Buffer extends Uint8Array {
  static alloc(n) { return new Buffer(n); }
  static from(x, e) {
    if (typeof x === 'string') {
      if (e === 'hex') { const b = new Buffer(x.length >> 1); for (let i = 0; i < b.length; i++) b[i] = parseInt(x.substr(i * 2, 2), 16); return b; }
      const u = new TextEncoder().encode(x); const b = new Buffer(u.length); b.set(u); return b;
    }
    const b = new Buffer(x.length); b.set(x); return b;
  }
  toString(e) { return e === 'hex' ? Array.from(this, (v) => v.toString(16).padStart(2, '0')).join('') : new TextDecoder().decode(this); }
}
module.exports = { Buffer };
