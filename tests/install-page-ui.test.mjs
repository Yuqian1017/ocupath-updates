import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { loadReleaseManifest, releaseUrls } from '../scripts/release-manifest.mjs';

const html = readFileSync(new URL('../ocupathif/install.html', import.meta.url), 'utf8');
const manifest = loadReleaseManifest(undefined, { requireFinal: false });
const urls = releaseUrls(manifest);

assert.match(
  html,
  /<link\s+rel="icon"\s+href="\.\/ocupathif-logo\.png">/,
  'browser tab must reuse the official OcuPathIF logo as its favicon',
);

assert.match(
  html,
  /<img\s+class="product-logo"\s+src="\.\/ocupathif-logo\.png"\s+alt="OcuPathIF logo">/,
  'page must show the official OcuPathIF logo above the title',
);

assert.match(
  html,
  /href="mailto:contact@ocupath\.ai">contact@ocupath\.ai<\/a>/,
  'footer must provide the clickable OcuPathIF contact email',
);

assert.equal(
  html.includes('Notarized by Apple · Stapled ticket · Gatekeeper accepted'),
  false,
  'customer page must not show internal signing terminology',
);

const baseButtonRule = html.match(/\.download-button\s*\{([^}]*)\}/)?.[1] ?? '';
assert.match(
  baseButtonRule,
  /background:\s*#087f73\s*;/,
  'download buttons must have a visible teal fill before hover',
);
assert.match(
  baseButtonRule,
  /box-shadow:/,
  'download buttons must have a visible default shadow',
);

const interactiveButtonRule = html.match(/\.download-button:hover,\s*\.download-button:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
assert.match(
  interactiveButtonRule,
  /background:\s*#0aa896\s*;/,
  'hover and keyboard focus must visibly brighten the button',
);
assert.match(
  interactiveButtonRule,
  /transform:\s*translateY\(-2px\)\s*;/,
  'hover and keyboard focus must provide a clear lift response',
);

assert.equal(
  (html.match(/class="download-button"/g) ?? []).length,
  2,
  'Mac and Windows must both use the same prominent button treatment',
);

const manualMacGitHubUrl = urls.macManualGlobal;
const windowsGitHubUrl = urls.windowsGlobal;
const manualMacChinaUrl = urls.macManualCos;
const windowsChinaUrl = urls.windowsCos;
const manualMacSha256 = manifest.assets.macManual.sha256;
const windowsSha256 = manifest.assets.windowsInstaller.sha256;
assert.equal(
  (html.match(/class="alternate-download"/g) ?? []).length,
  0,
  'users must see one download action per platform rather than choosing a source',
);
assert.equal(
  (html.match(/data-download-platform="(?:mac|windows)"/g) ?? []).length,
  2,
  'the page must expose exactly one routed button for Mac and one for Windows',
);
assert.match(
  html,
  new RegExp(`data-cn-url="${manualMacGitHubUrl.replaceAll('.', '\\.')}"`),
  'Mac China route must initially fall back to the exact GitHub customer asset',
);
assert.match(
  html,
  new RegExp(`data-cn-promoted-url="${manualMacChinaUrl.replaceAll('.', '\\.')}"`),
  'Mac China promotion data must retain the exact COS customer asset',
);
assert.match(
  html,
  new RegExp(`data-global-url="${manualMacGitHubUrl.replaceAll('.', '\\.')}"`),
  'Mac routing data must use the exact released Mac customer asset',
);
assert.match(
  html,
  new RegExp(`data-cn-url="${windowsGitHubUrl.replaceAll('.', '\\.')}"`),
  'Windows China route must initially fall back to the exact GitHub installer',
);
assert.match(
  html,
  new RegExp(`data-cn-promoted-url="${windowsChinaUrl.replaceAll('.', '\\.')}"`),
  'Windows China promotion data must retain the exact COS installer',
);
assert.match(
  html,
  new RegExp(`data-global-url="${windowsGitHubUrl.replaceAll('.', '\\.')}"`),
  'Windows routing data must use the exact released Windows installer',
);
assert.match(
  html,
  new RegExp(`href="${manualMacGitHubUrl.replaceAll('.', '\\.')}"`),
  'Mac must default to the exact released customer asset',
);
assert.match(
  html,
  new RegExp(`href="${windowsGitHubUrl.replaceAll('.', '\\.')}"`),
  'Windows must default to the exact released installer',
);
const customerVisibleText = (html.match(/<body>[\s\S]*?<\/body>/)?.[0] ?? '')
  .replace(/<script>[\s\S]*?<\/script>/gi, '')
  .replace(/<[^>]+>/g, ' ');
assert.doesNotMatch(
  customerVisibleText,
  /(?:Hong Kong|GitHub|mirror)/i,
  'customer-visible copy must not ask users to understand download providers',
);
assert.match(html, new RegExp(`<code data-sha256="mac">${manualMacSha256}<\\/code>`), 'Mac checksum must come from the staging manifest');
assert.match(html, new RegExp(`<code data-sha256="windows">${windowsSha256}<\\/code>`), 'Windows checksum must come from the staging manifest');

const inlineScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1] ?? '';

function createRoutingHarness(fetchImpl = () => new Promise(() => {})) {
  const buttons = [
    {
      dataset: {
        cnUrl: manualMacGitHubUrl,
        cnPromotedUrl: manualMacChinaUrl,
        expectedBytes: String(manifest.assets.macManual.sizeBytes),
        globalUrl: manualMacGitHubUrl,
      },
      href: manualMacGitHubUrl,
    },
    {
      dataset: {
        cnUrl: windowsGitHubUrl,
        cnPromotedUrl: windowsChinaUrl,
        expectedBytes: String(manifest.assets.windowsInstaller.sizeBytes),
        globalUrl: windowsGitHubUrl,
      },
      href: windowsGitHubUrl,
    },
  ];
  const document = {
    documentElement: { dataset: {} },
    querySelectorAll(selector) {
      return selector === '[data-download-platform]' ? buttons : [];
    },
    querySelector() {
      return null;
    },
  };
  const window = {};

  vm.runInNewContext(inlineScript, {
    AbortController,
    clearTimeout() {},
    document,
    fetch: fetchImpl,
    navigator: { userAgent: 'test' },
    setTimeout() { return 1; },
    window,
  });

  return { buttons, document, window };
}

const deterministic = createRoutingHarness();
assert.equal(
  typeof deterministic.window.__ocupathDownloadRouting?.applyCountry,
  'function',
  'the page must expose one deterministic routing function for browser verification',
);

deterministic.window.__ocupathDownloadRouting.applyCountry('CN');
assert.deepEqual(
  deterministic.buttons.map((button) => button.href),
  deterministic.buttons.map((button) => button.dataset.globalUrl),
  'mainland-China traffic must safely use GitHub until COS promotion succeeds',
);
assert.equal(deterministic.document.documentElement.dataset.downloadRegion, 'cn');

deterministic.window.__ocupathDownloadRouting.applyCountry('US');
assert.deepEqual(
  deterministic.buttons.map((button) => button.href),
  deterministic.buttons.map((button) => button.dataset.globalUrl),
  'non-China traffic must use the same official release asset for both platforms',
);
assert.equal(deterministic.document.documentElement.dataset.downloadRegion, 'global');

const promotedSizes = [101, manifest.assets.windowsInstaller.sizeBytes];
const promoted = createRoutingHarness((url, options) => {
  if (url === 'https://api.country.is/') return new Promise(() => {});
  const button = [manualMacChinaUrl, windowsChinaUrl].indexOf(url);
  return Promise.resolve({
    ok: options?.method === 'HEAD' && button >= 0,
    headers: {
      get: (name) => ({
        'content-length': String(promotedSizes[button]),
        etag: `"fixture-${button}"`,
        'last-modified': 'Tue, 18 Aug 2026 12:00:00 GMT',
      })[name] ?? null,
    },
  });
});
promoted.buttons.forEach((button, index) => { button.dataset.expectedBytes = String(promotedSizes[index]); });
assert.equal(await promoted.window.__ocupathDownloadRouting.promoteChinaRoutes(), true);
promoted.window.__ocupathDownloadRouting.applyCountry('CN');
assert.deepEqual(
  promoted.buttons.map((button) => button.href),
  promoted.buttons.map((button) => button.dataset.cnPromotedUrl),
  'verified COS manual payloads must atomically promote both China routes',
);
assert.equal(promoted.document.documentElement.dataset.chinaRoute, 'cos-promoted');

const unavailableCos = createRoutingHarness((url) => {
  if (url === 'https://api.country.is/') return new Promise(() => {});
  return Promise.resolve({ ok: false, headers: { get: () => null } });
});
assert.equal(await unavailableCos.window.__ocupathDownloadRouting.promoteChinaRoutes(), false);
unavailableCos.window.__ocupathDownloadRouting.applyCountry('CN');
assert.deepEqual(
  unavailableCos.buttons.map((button) => button.href),
  unavailableCos.buttons.map((button) => button.dataset.globalUrl),
  'unavailable COS must leave mainland-China users on the working GitHub fallback',
);

const corsBlocked = createRoutingHarness((url) => {
  if (url === 'https://api.country.is/') return new Promise(() => {});
  return Promise.resolve({ ok: true, headers: { get: () => null } });
});
assert.equal(await corsBlocked.window.__ocupathDownloadRouting.promoteChinaRoutes(), false);
corsBlocked.window.__ocupathDownloadRouting.applyCountry('CN');
assert.deepEqual(
  corsBlocked.buttons.map((button) => button.href),
  corsBlocked.buttons.map((button) => button.dataset.globalUrl),
  'COS without browser-readable CORS headers must keep both China routes on GitHub',
);

deterministic.window.__ocupathDownloadRouting.applyCountry(undefined);
assert.deepEqual(
  deterministic.buttons.map((button) => button.href),
  deterministic.buttons.map((button) => button.dataset.globalUrl),
  'lookup failure must keep the globally available GitHub asset',
);
assert.equal(deterministic.document.documentElement.dataset.downloadRegion, 'global');

let lookupRequest;
const automatic = createRoutingHarness((url, options) => {
  lookupRequest = { url, options };
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ country: 'US' }) });
});
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));

assert.equal(lookupRequest?.url, 'https://api.country.is/');
assert.equal(lookupRequest?.options?.credentials, 'omit');
assert.equal(lookupRequest?.options?.referrerPolicy, 'no-referrer');
assert.equal(lookupRequest?.options?.cache, 'no-store');
assert.deepEqual(
  automatic.buttons.map((button) => button.href),
  automatic.buttons.map((button) => button.dataset.globalUrl),
  'a successful non-China lookup must automatically select the global route',
);

console.log('install page UI contract: PASS');

assert.match(
  html,
  new RegExp(manifest.assets.guideEn.fileName.replaceAll('.', '\\.')),
  'customer page must link the versioned English user guide that matches the release',
);
assert.match(
  html,
  new RegExp(manifest.assets.guideZh.fileName.replaceAll('.', '\\.')),
  'customer page must link the versioned Chinese user guide that matches the release',
);
