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
