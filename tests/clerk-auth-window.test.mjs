import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const article = 'https://example.test/docs/article/?view=full#comments';
const nonce = 'b8188ec9-f1a8-4cb3-9cc5-040166ab890b';
const stateKey = 'blog-auth-window';
const lifetime = 15 * 60 * 1000;
const bundle = await build({entryPoints: [new URL('../src/components/auth/clerk-auth-window.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false});
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64');
let generation = 0;

async function withWindow(run, href = article) {
  const originals = new Map(['window', 'BroadcastChannel', 'setTimeout', 'clearTimeout'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new Map();
  const timers = new Map();
  const events = new Map();
  const channels = [];
  const opened = [];
  const popup = {closed: false, focused: 0, focus() { this.focused++; }};
  let timerId = 0;
  class Channel {
    constructor(name) { this.name = name; this.messages = []; this.closed = false; channels.push(this); }
    postMessage(data) { assert.equal(this.closed, false); this.messages.push(data); }
    close() { this.closed = true; }
  }
  const current = new URL(href);
  const browserWindow = {
    location: {href, origin: current.origin, pathname: current.pathname},
    sessionStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    open: (...args) => { opened.push(args); return popup; },
    addEventListener: (type, handler) => events.set(type, handler),
    removeEventListener: (type, handler) => { if (events.get(type) === handler) events.delete(type); },
  };
  const replacements = {
    window: browserWindow,
    BroadcastChannel: Channel,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, {callback, delay}); return id; },
    clearTimeout: id => timers.delete(id),
  };
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  const module = await import(moduleUrl + '#test-' + (++generation));
  const context = {module, window: browserWindow, storage, channels, timers, events, opened, popup,
    deliver: data => channels[0].onmessage({data}),
    fire(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue;
        timers.delete(id);
        timer.callback();
      }
    },
  };
  try { await run(context); }
  finally {
    events.get('pagehide')?.();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

function clerkFixture(sessions = []) {
  const fixture = {reloads: 0, activated: [], sessions};
  fixture.clerk = {
    client: {reload: async () => { fixture.reloads++; return {sessions: fixture.sessions}; }},
    setActive: async props => { fixture.activated.push(props); await props.navigate(); },
  };
  return fixture;
}

test('the window opens synchronously on the current origin with a fresh channel and leaves the article intact', async () => {
  await withWindow(async ({module, opened, channels, window, popup}) => {
    const fixture = clerkFixture();
    module.openClerkAuthWindow(fixture.clerk, assert.fail);
    assert.equal(opened.length, 1);
    const [href, target, features] = opened[0];
    const url = new URL(href);
    assert.equal(url.origin, new URL(article).origin);
    assert.equal(url.pathname, '/sso-callback/');
    assert.equal(url.hash, '');
    assert.match(url.searchParams.get('auth_window'), /^[a-f0-9-]{36}$/);
    assert.equal(channels[0].name, `blog-auth:${url.searchParams.get('auth_window')}`,
      'Messages use the browser origin-scoped BroadcastChannel API with a per-attempt name');
    assert.equal(target, '_blank');
    assert.match(features, /popup=yes/);
    assert.equal(window.location.href, article);
    assert.equal(fixture.reloads, 0, 'Window creation must precede asynchronous auth work');
    module.openClerkAuthWindow(fixture.clerk, assert.fail);
    assert.equal(opened.length, 1, 'Repeated clicks focus the pending window');
    assert.equal(popup.focused, 1);
  });
});

test('blocked or throwing window.open reports the problem and closes its channel', async () => {
  for (const open of [() => null, () => { throw new Error('blocked'); }]) {
    await withWindow(async ({module, window, channels, timers}) => {
      window.open = open;
      const errors = [];
      module.openClerkAuthWindow(clerkFixture().clerk, message => errors.push(message));
      assert.equal(errors.length, 1);
      assert.match(errors[0], /allow popups/);
      assert.equal(channels[0].closed, true);
      assert.equal(timers.size, 0);
      assert.equal(window.location.href, article);
    });
  }
});

test('unavailable BroadcastChannel fails before opening an OAuth window', async () => {
  await withWindow(async ({module, opened}) => {
    globalThis.BroadcastChannel = class { constructor() { throw new Error('unavailable'); } };
    const errors = [];
    module.openClerkAuthWindow(clerkFixture().clerk, message => errors.push(message));
    assert.equal(opened.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /connect the sign-in window/);
  });
});

test('malformed notifications and sessions absent from Clerk never activate or acknowledge', async () => {
  await withWindow(async ({module, deliver, channels}) => {
    const fixture = clerkFixture();
    module.openClerkAuthWindow(fixture.clerk, assert.fail);
    for (const data of [null, {}, {type: 'ack'}, {type: 'complete'}, {type: 'complete', sessionId: 12}]) await deliver(data);
    assert.equal(fixture.reloads, 0);
    await deliver({type: 'complete', sessionId: 'session_forged'});
    assert.equal(fixture.reloads, 1);
    assert.deepEqual(fixture.activated, []);
    assert.deepEqual(channels[0].messages, []);
  });
});

test('ended sessions and sessions with outstanding tasks cannot activate the parent', async () => {
  await withWindow(async ({module, deliver, channels}) => {
    const fixture = clerkFixture([
      {id: 'session_ended', status: 'ended', currentTask: null},
      {id: 'session_task', status: 'active', currentTask: {key: 'choose-organization'}},
    ]);
    module.openClerkAuthWindow(fixture.clerk, assert.fail);
    await deliver({type: 'complete', sessionId: 'session_ended'});
    await deliver({type: 'complete', sessionId: 'session_task'});
    assert.equal(fixture.reloads, 2);
    assert.deepEqual(fixture.activated, []);
    assert.deepEqual(channels[0].messages, []);
  });
});

test('a verified session activates without navigation and duplicate completion gets another ack only', async () => {
  await withWindow(async ({module, deliver, channels, window, timers, fire}) => {
    const fixture = clerkFixture([{id: 'session_verified', status: 'active', currentTask: null}]);
    module.openClerkAuthWindow(fixture.clerk, assert.fail);
    await deliver({type: 'complete', sessionId: 'session_verified'});
    assert.equal(fixture.reloads, 1);
    assert.equal(fixture.activated.length, 1);
    assert.equal(fixture.activated[0].session, 'session_verified');
    assert.equal(typeof fixture.activated[0].navigate, 'function');
    assert.equal(Object.hasOwn(fixture.activated[0], 'redirectUrl'), false);
    assert.equal(window.location.href, article);
    assert.deepEqual(channels[0].messages, [{type: 'ack'}]);
    await deliver({type: 'complete', sessionId: 'session_verified'});
    assert.equal(fixture.reloads, 1);
    assert.equal(fixture.activated.length, 1);
    assert.deepEqual(channels[0].messages, [{type: 'ack'}, {type: 'ack'}]);
    assert.equal([...timers.values()].some(timer => timer.delay === lifetime), false);
    fire(10_000);
    assert.equal(channels[0].closed, true);
  });
});

test('transient Clerk failures permit a later retry without a false acknowledgement', async () => {
  await withWindow(async ({module, deliver, channels}) => {
    const fixture = clerkFixture([{id: 'session_verified', status: 'active', currentTask: null}]);
    const reload = fixture.clerk.client.reload;
    fixture.clerk.client.reload = async () => { fixture.clerk.client.reload = reload; throw new Error('offline'); };
    module.openClerkAuthWindow(fixture.clerk, assert.fail);
    await deliver({type: 'complete', sessionId: 'session_verified'});
    assert.deepEqual(channels[0].messages, []);
    assert.equal(fixture.activated.length, 0);
    await deliver({type: 'complete', sessionId: 'session_verified'});
    assert.equal(fixture.activated.length, 1);
    assert.deepEqual(channels[0].messages, [{type: 'ack'}]);
  });
});

test('pagehide during verification and expired attempts cannot activate or send acknowledgements', async () => {
  await withWindow(async ({module, deliver, channels, events}) => {
    const fixture = clerkFixture();
    let finish;
    fixture.clerk.client.reload = () => new Promise(resolve => { finish = resolve; });
    module.openClerkAuthWindow(fixture.clerk, assert.fail);
    const pending = deliver({type: 'complete', sessionId: 'session_verified'});
    events.get('pagehide')();
    finish({sessions: [{id: 'session_verified', status: 'active', currentTask: null}]});
    await pending;
    assert.equal(fixture.activated.length, 0);
    assert.equal(channels[0].closed, true);
    assert.deepEqual(channels[0].messages, []);
  });
  await withWindow(async ({module, deliver, fire, channels}) => {
    const fixture = clerkFixture();
    const errors = [];
    module.openClerkAuthWindow(fixture.clerk, message => errors.push(message));
    fire(lifetime);
    await deliver({type: 'complete', sessionId: 'session_verified'});
    assert.equal(fixture.reloads, 0);
    assert.equal(channels[0].closed, true);
    assert.match(errors[0], /expired/);
  });
});

test('callback state survives official continuation URLs but is ignored on ordinary article pages', async () => {
  await withWindow(async ({module, storage, window}) => {
    const state = module.authWindowState();
    assert.equal(state.nonce, nonce);
    assert.ok(state.expires > Date.now());
    assert.deepEqual(JSON.parse(storage.get(stateKey)), state);
    window.location.href = 'https://example.test/sso-callback/?intent=signIn#/create/continue';
    assert.deepEqual(module.authWindowState(), state);
    assert.equal(module.authWindowUrl(state), `https://example.test/sso-callback/?auth_window=${nonce}`);
    storage.set(stateKey, JSON.stringify({...state, expires: Date.now() - 1}));
    assert.equal(module.authWindowState(), undefined);
    storage.set(stateKey, JSON.stringify(state));
    window.location.href = article;
    assert.equal(module.authWindowState(), undefined);
    module.clearAuthWindowState();
    assert.equal(storage.has(stateKey), false);
  }, `https://example.test/sso-callback/?auth_window=${nonce}`);
});

test('invalid state is ignored and an explicit valid completion nonce tolerates blocked storage', async () => {
  await withWindow(async ({module, storage}) => {
    storage.set(stateKey, JSON.stringify({nonce: 'untrusted', expires: Date.now() + lifetime}));
    assert.equal(module.authWindowState(), undefined);
  }, 'https://example.test/sso-callback/?auth_window=untrusted');
  await withWindow(async ({module, window}) => {
    window.sessionStorage.getItem = () => { throw new Error('storage denied'); };
    window.sessionStorage.removeItem = () => { throw new Error('storage denied'); };
    assert.equal(module.authWindowState().nonce, nonce);
    assert.doesNotThrow(() => module.clearAuthWindowState());
  }, `https://example.test/sso-callback/?auth_window=${nonce}`);
});
