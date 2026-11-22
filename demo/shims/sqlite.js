// node:sqlite поверх sql.js (SQLite, скомпилированный в JS)
const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? +v : v));
class DatabaseSync {
  constructor() { this.d = new globalThis.__SQL.Database(globalThis.__DB_BYTES || undefined); }
  exec(sql) { this.d.exec(sql); }
  close() {}
  prepare(sql) {
    const once = (params, fn) => { const st = this.d.prepare(sql); try { st.bind(norm(params)); return fn(st); } finally { st.free(); } };
    return {
      get: (...p) => once(p, (st) => (st.step() ? st.getAsObject() : undefined)),
      all: (...p) => once(p, (st) => { const r = []; while (st.step()) r.push(st.getAsObject()); return r; }),
      run: (...p) => {
        once(p, (st) => { st.step(); });
        const changes = this.d.getRowsModified();
        const lastInsertRowid = this.d.exec('SELECT last_insert_rowid()')[0].values[0][0];
        return { changes, lastInsertRowid };
      },
    };
  }
}
module.exports = { DatabaseSync };
