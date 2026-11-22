export { Buffer } from './buffer.js';
export const process = { env: globalThis.__DEMO_ENV || {}, exit() {}, on() {} };
const _si = globalThis.setInterval, _st = globalThis.setTimeout;
export const setInterval = (...a) => ({ id: _si(...a), unref() { return this; } });
export const setImmediate = (fn, ...a) => _st(fn, 0, ...a);
