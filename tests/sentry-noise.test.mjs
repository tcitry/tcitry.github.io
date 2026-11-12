import assert from 'node:assert/strict';
import test from 'node:test';
import {isThirdPartyNoise} from '../src/scripts/sentry-noise.mjs';

const site = 'https://yindongliang.com';
const frame = (filename, lineno = 10, colno = 20) => ({filename, lineno, colno});
const event = (exception, tags = {}) => ({exception: {values: [exception]}, tags});

test('Google Ads script errors are dropped', () => {
  const ads = 'https://pagead2.googlesyndication.com/pagead/js/r20261019/r20190131/rum_fy2021.js';
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'int64', stacktrace: {frames: [
    frame(`${site}/_astro/page.C15se8Ps.js`), frame(ads, 12, 251), frame(ads, 10, 267),
  ]}})), true);
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'int64', stacktrace: {frames: [
    frame('https://ep2.adtrafficquality.google/sodar/sodar2.js'),
  ]}})), true);
});

test('site errors that merely pass through an ad callback are kept', () => {
  assert.equal(isThirdPartyNoise(event({type: 'TypeError', value: 'x is undefined', stacktrace: {frames: [
    frame('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'), frame(`${site}/_astro/page.js`),
  ]}})), false);
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'int64', stacktrace: {frames: [
    frame(`${site}/pagead/fake.js`),
  ]}})), false);
  for (const filename of [
    'https://vendor.example/pagead/application.js',
    'https://notgooglesyndication.com/pagead/application.js',
    'https://googlesyndication.com.vendor.example/pagead/application.js',
  ]) {
    assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'int64', stacktrace: {frames: [
      frame(filename),
    ]}})), false, 'a pagead path alone does not establish a Google Ads origin');
  }
});

test('Google Identity Services client errors are dropped', () => {
  const gsi = '/gsi/client';
  const page = '/_astro/page.Ab12Cd34.js';
  const xhrWrap = (functionName, filename = page) => ({...frame(filename, 4, 80), function: functionName});

  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'pa', stacktrace: {frames: [
    frame(gsi, 40, 10), frame(gsi, 12, 4),
  ]}})), true, 'a path-only /gsi/client throw site is the GSI script');
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'pa', stacktrace: {frames: [
    frame('https://accounts.google.com/gsi/client?hl=en', 20, 8),
  ]}})), true);
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'pa', stacktrace: {frames: [
    frame('//accounts.google.com/gsi/client'),
  ]}})), true);
  assert.equal(isThirdPartyNoise(event({
    type: 'Error', value: 'pa',
    mechanism: {type: 'auto.browser.browserapierrors.xhr.onreadystatechange', handled: false},
    stacktrace: {frames: [
      frame(gsi, 30, 12), frame(gsi, 18, 6), xhrWrap('Object.apply'), xhrWrap('XMLHttpRequest.r'),
    ]},
  })), true, 'trailing Sentry XHR wrappers in the page chunk are not the throw site');
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'pa', stacktrace: {frames: [
    {...frame('https://accounts.google.com/gsi/client'), function: '_.Tk'},
    xhrWrap('XMLHttpRequest.ab', `${site}/_astro/page.js`),
    xhrWrap('Object.apply', `${site}/_astro/page.js`),
  ]}})), true, 'the minified listener name is not pinned to one build');
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'pa', stacktrace: {frames: [{
    ...frame(gsi), abs_path: 'https://accounts.google.com/gsi/client',
  }]}})), true);
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'pa', stacktrace: {frames: [
    xhrWrap('XMLHttpRequest.r'), xhrWrap('Object.apply'), frame(gsi, 40, 10),
  ]}})), true, 'older XHR wrapper callers still leave the /gsi/client throw site');
});

test('site errors that merely pass through a GSI callback are kept', () => {
  const gsi = '/gsi/client';
  const page = `${site}/_astro/page.js`;
  const xhrWrap = functionName => ({...frame(page, 4, 80), function: functionName});

  assert.equal(isThirdPartyNoise(event({type: 'TypeError', value: 'x is undefined', stacktrace: {frames: [
    frame(gsi), {...frame(page), function: 'onCredential'},
  ]}})), false);
  assert.equal(isThirdPartyNoise(event({
    type: 'TypeError', value: 'x is undefined',
    mechanism: {type: 'auto.browser.browserapierrors.xhr.onreadystatechange', handled: false},
    stacktrace: {frames: [
      frame(gsi), {...frame(page), function: 'onCredential'}, xhrWrap('Object.apply'), xhrWrap('XMLHttpRequest.r'),
    ]},
  })), false, 'a site frame under the Sentry XHR wrappers stays visible');
  assert.equal(isThirdPartyNoise(event({type: 'TypeError', value: 'x is undefined', stacktrace: {frames: [
    frame(gsi), {...frame(page), function: 'XMLHttpRequest.ab'},
  ]}})), false, 'a lone XMLHttpRequest method without the Proxy frame is a site handler');
  assert.equal(isThirdPartyNoise(event({type: 'TypeError', value: 'x is undefined', stacktrace: {frames: [
    xhrWrap('Object.apply'), xhrWrap('XMLHttpRequest.r'),
  ]}})), false, 'wrapper frames alone do not drop a site error');
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'pa', stacktrace: {frames: [
    frame(`${site}/gsi/client`),
  ]}})), false, 'an absolute site URL is not the GSI script');
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'pa', stacktrace: {frames: [{
    ...frame(gsi), abs_path: `${site}/gsi/client`,
  }]}})), false, 'abs_path on this site takes precedence over the path-only filename');
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'pa', stacktrace: {frames: [
    frame('https://accounts.google.com/gsi/status'),
  ]}})), false, 'the GSI status endpoint is not the client script');
  for (const filename of [
    'https://vendor.example/gsi/client',
    'https://accounts.google.com.vendor.example/gsi/client',
    'https://notaccounts.google.com/gsi/client',
  ]) {
    assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'pa', stacktrace: {frames: [
      frame(filename),
    ]}})), false, 'a /gsi/client path on another origin is not Google Identity Services');
  }
  assert.equal(isThirdPartyNoise(event({type: 'Error', value: 'pa', stacktrace: {frames: [
    frame('/gsi/status'),
  ]}})), false);
});

test('a dropped recent-updates request is dropped only for that search operation', () => {
  const failed = {type: 'TypeError', value: 'Failed to fetch (yindongliang.com)', mechanism: {type: 'generic', handled: true}};
  assert.equal(isThirdPartyNoise(event(failed, {feature: 'search', operation: 'recent_load'})), true);
  assert.equal(isThirdPartyNoise(event({...failed, value: 'Load failed'}, {feature: 'search', operation: 'recent_load'})), true);
  assert.equal(isThirdPartyNoise(event(failed, {feature: 'search', operation: 'query'})), false);
  assert.equal(isThirdPartyNoise(event(failed, {feature: 'chat', operation: 'load'})), false);
  assert.equal(isThirdPartyNoise(event({...failed, value: 'Cannot read properties of undefined'},
    {feature: 'search', operation: 'recent_load'})), false);
});

test('a hashed chunk corrupted at its first bytes is dropped', () => {
  const corrupted = (filename, overrides = {}) => event({
    type: 'SyntaxError',
    value: 'Invalid or unexpected token',
    mechanism: {type: 'auto.browser.global_handlers.onerror', handled: false},
    stacktrace: {frames: [frame(filename, 1, 2)]},
    ...overrides,
  });
  assert.equal(isThirdPartyNoise(corrupted(`${site}/_astro/BlogSearch.astro_astro_type_script_index_0_lang.Dz5Hcq2Z.js`)), true);
  assert.equal(isThirdPartyNoise(corrupted(`${site}/_astro/preload-helper.DHhhL8Zf.js`)), true);
  assert.equal(isThirdPartyNoise(corrupted(`${site}/docs/page/`)), false, 'inline scripts stay visible');
  assert.equal(isThirdPartyNoise(corrupted('https://cdn.example.com/_astro/a.js')), false);
  assert.equal(isThirdPartyNoise(corrupted(`${site}/_astro/a.js`, {stacktrace: {frames: [frame(`${site}/_astro/a.js`, 1, 5000)]}})), false,
    'a syntax error deep inside a chunk is a real build problem');
  assert.equal(isThirdPartyNoise(corrupted(`${site}/_astro/a.js`, {value: "Identifier 'originalQuery' has already been declared"})), false);
  assert.equal(isThirdPartyNoise(corrupted(`${site}/_astro/a.js`, {mechanism: {type: 'generic', handled: true}})), false);
});

test('ordinary site errors are kept', () => {
  assert.equal(isThirdPartyNoise({}), false);
  assert.equal(isThirdPartyNoise(event({type: 'TypeError', value: 'e.at is not a function', stacktrace: {frames: [
    frame(`${site}/_astro/page.js`),
  ]}})), false);
  assert.equal(isThirdPartyNoise(event({type: 'TypeError', value: 'Failed to fetch'})), false);
});

test('Sentry path frames and abs_path retain the same origin checks', () => {
  const syntax = source => event({
    type: 'SyntaxError', value: 'Invalid or unexpected token',
    mechanism: {type: 'auto.browser.global_handlers.onerror', handled: false},
    stacktrace: {frames: [{...frame('/_astro/preload-helper.DHhhL8Zf.js', 1, 2), ...source}]},
  });
  assert.equal(isThirdPartyNoise(syntax({})), true);
  assert.equal(isThirdPartyNoise(syntax({abs_path: `${site}/_astro/preload-helper.DHhhL8Zf.js`})), true);
  assert.equal(isThirdPartyNoise(syntax({abs_path: 'https://vendor.example/_astro/preload-helper.DHhhL8Zf.js'})), false,
    'an absolute source on another origin takes precedence over the path-only filename');
  assert.equal(isThirdPartyNoise(syntax({filename: '//vendor.example/_astro/preload-helper.DHhhL8Zf.js'})), false);
  assert.equal(isThirdPartyNoise(syntax({abs_path: 'not a URL'})), false);
  assert.equal(isThirdPartyNoise(syntax({filename: '/docs/article/'})), false);

  const ads = {type: 'Error', value: 'int64', stacktrace: {frames: [{
    ...frame('/pagead/js/r20261019/r20190131/rum_fy2021.js'),
    abs_path: 'https://pagead2.googlesyndication.com/pagead/js/r20261019/r20190131/rum_fy2021.js',
  }]}};
  assert.equal(isThirdPartyNoise(event(ads)), true);
  assert.equal(isThirdPartyNoise(event({...ads, stacktrace: {frames: [
    {...ads.stacktrace.frames[0], abs_path: `${site}/pagead/application.js`},
  ]}})), false);
});

test('unattributed rejections, code loads, inline declarations and Convex failures remain visible', () => {
  for (const sample of [
    event({type: 'UnhandledRejection', value: 'Non-Error promise rejection captured with value: undefined',
      mechanism: {type: 'auto.browser.global_handlers.onunhandledrejection', handled: false}}),
    event({type: 'Error', value: 'undefined', mechanism: {type: 'generic', handled: true}},
      {feature: 'code', operation: 'load'}),
    event({type: 'SyntaxError', value: "Identifier 'originalQuery' has already been declared",
      mechanism: {type: 'auto.browser.global_handlers.onerror', handled: false},
      stacktrace: {frames: [frame('/docs/Linux/DevOps/alibaba-cloud-cli-configuration-guide/', 1, 1)]}}),
    event({type: 'Error', value: '[CONVEX Q(reader:listReadingProgress)] [Request ID: fixture] Server Error\n  Called by client',
      mechanism: {type: 'generic', handled: true}}, {feature: 'chat', operation: 'render'}),
  ]) assert.equal(isThirdPartyNoise(sample), false);
});
