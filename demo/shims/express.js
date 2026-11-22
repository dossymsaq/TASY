// Мини-Express для браузера: маршруты, middleware, ошибки, async-обработчики
function compile(path, end) {
  const keys = [];
  const src = path.replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/\\?:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  return { re: new RegExp('^' + src + (end ? '/?$' : '(?=/|$)')), keys };
}
function Router() {
  const layers = [];
  const r = (req, res, next) => r.handle(req, res, next);
  r.layers = layers;
  const add = (method) => (path, ...fns) => { layers.push({ method, ...compile(path, true), fns: fns.flat() }); return r; };
  for (const m of ['get', 'post', 'patch', 'put', 'delete']) r[m] = add(m.toUpperCase());
  r.all = add(null);
  r.use = (path, ...fns) => {
    if (typeof path !== 'string') { fns.unshift(path); path = ''; }
    layers.push({ mount: true, ...compile(path, false), prefix: path, fns: fns.flat() });
    return r;
  };
  r.set = () => r;
  r.handle = (req, res, done) => {
    let i = 0, j = 0;
    const basePath = req.path;
    const next = (err) => {
      req.path = basePath;
      while (i < layers.length) {
        const L = layers[i];
        if (j >= L.fns.length) { i++; j = 0; continue; }
        if (!L.mount && L.method && L.method !== req.method) { i++; j = 0; continue; }
        const m = req.path.match(L.re);
        if (!m) { i++; j = 0; continue; }
        const fn = L.fns[j++];
        const isErr = fn.length === 4;
        if (!!err !== isErr) continue;
        if (!L.mount) req.params = Object.fromEntries(L.keys.map((k, n) => [k, decodeURIComponent(m[n + 1])]));
        if (L.mount && L.prefix) req.path = req.path.slice(L.prefix.length) || '/';
        try {
          const out = isErr ? fn(err, req, res, next) : fn(req, res, next);
          if (out && typeof out.then === 'function') out.then(undefined, next);
        } catch (e) { next(e); }
        return;
      }
      done(err);
    };
    next();
  };
  return r;
}
function express() { return Router(); }
express.Router = Router;
const pass = () => (req, res, next) => next();
express.json = pass; express.urlencoded = pass; express.static = pass;
module.exports = express;
