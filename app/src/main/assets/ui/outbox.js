/* Android-owned scheduling metadata. Core remains the only owner of execution and context. */
(() => {
'use strict';
// Strings (including large attachment data) are immutable; copy containers without re-encoding them.
const clone = value => Array.isArray(value) ? value.map(clone) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
function id() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
const position = s => JSON.stringify([s.leaf ?? null, s.trunk ?? null, s.pending || []]);
const empty = session => ({version:1,session,items:[],turn:null,anchor:null,paused:'',expanded:true});
function valid(q, session) {
  return q?.version === 1 && q.session === session && Array.isArray(q.items) && q.items.length <= 3
    && q.items.every(item => typeof item.id === 'string' && typeof item.body?.text === 'string' && Array.isArray(item.body.attachments));
}
let database;
function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('kaipi-outbox', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { database = null; reject(new Error('Outbox storage blocked')); };
  });
  return database;
}
async function read(session) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly'), request = tx.objectStore('sessions').get(session);
    tx.oncomplete = () => { const q = request.result; if (q && !valid(q, session)) reject(new Error('Invalid outbox')); else resolve(q || empty(session)); };
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Outbox read failed'));
  });
}
async function write(q) {
  const db = await open(), copy = clone(q);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(copy, q.session);
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Outbox write failed'));
  });
}
function begin(q, snapshot, body, retry = false) {
  const prior = q.turn;
  const same = retry && prior && prior.attemptId === snapshot.latest_attempt?.id && prior.status === 'failed';
  q.turn = {token:id(),body:clone(body),attempts:same ? prior.attempts + 1 : retry && ['aborted','tombstone'].includes(snapshot.latest_attempt?.status) ? 2 : 1,
    before:snapshot.latest_attempt?.id || null, attemptId:null,
    parent:retry ? snapshot.latest_attempt.parent_id : snapshot.leaf,
    status:'sending',stop:false};
  q.anchor = position(snapshot);
  // Context pauses require an explicit resume; failures are resolved by retrying this request.
  if (q.paused !== 'context') q.paused = '';
  return q.turn;
}
function observe(q, s, recover = false) {
  if (q.session !== s.session) return false;
  const t = q.turn, latest = s.latest_attempt;
  if (!t || !['sending','running','unknown'].includes(t.status)) {
    if (q.items.length && q.anchor && position(s) !== q.anchor) q.paused = 'context';
    return false;
  }
  const matches = latest && (latest.id === t.attemptId || (latest.id !== t.before && latest.parent_id === t.parent
    && (latest.input === t.body.text || (!t.body.text && latest.attachments))));
  if (!matches) { if (recover && !s.busy) { t.status = 'unknown'; q.paused = 'unknown'; } return false; }
  t.attemptId = latest.id;
  if (s.busy) { t.status = 'running'; return false; }
  q.anchor = position(s);
  if (latest.status === 'live' && s.leaf === latest.id) {
    t.status = 'succeeded';
    if (t.stop) q.paused = 'stopped';
    else if (q.paused === 'unknown') q.paused = '';
    return true;
  }
  t.status = 'failed';
  if (q.paused === 'unknown') q.paused = '';
  return false;
}
window.KaipiOutbox = {id,clone,position,empty,read,write,begin,observe};
})();
