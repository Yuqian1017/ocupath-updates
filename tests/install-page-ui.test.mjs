import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../ocupathif/install.html', import.meta.url), 'utf8');

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

const githubOrigin = 'https://github.com/Yuqian1017/ocupath-updates/releases/download/v0.992.1';
const manualMacGitHubUrl = `${githubOrigin}/OcupathIF-0.992.1-arm64-mac-standalone.zip`;
const windowsGitHubUrl = `${githubOrigin}/OcupathIF-Setup-0.992.1-x64.exe`;
const manualMacSha256 = '30361e88cb424b0fdb3a263a8743034c76662c0ab9ed939195ef9c846adc1f9d';
const windowsSha256 = '385a35a12225d44dc5361c20f21ea43b109b908a08e5b4cdfded4d32e9391193';
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
  'Mac routing data must use the exact released Mac customer asset',
);
assert.match(
  html,
  new RegExp(`data-global-url="${manualMacGitHubUrl.replaceAll('.', '\\.')}"`),
  'Mac routing data must use the exact released Mac customer asset',
);
assert.match(
  html,
  new RegExp(`data-cn-url="${windowsGitHubUrl.replaceAll('.', '\\.')}"`),
  'Windows routing data must use the exact released Windows installer',
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
assert.doesNotMatch(
  html.match(/<body>[\s\S]*?<\/body>/)?.[0] ?? '',
  />[^<]*(?:Hong Kong|GitHub|mirror)[^<]*</i,
  'customer-visible copy must not ask users to understand download providers',
);
assert.match(html, new RegExp(`<code>${manualMacSha256}<\\/code>`), 'Mac checksum must match the final c801 package');
assert.match(html, new RegExp(`<code>${windowsSha256}<\\/code>`), 'Windows checksum must match the final c801 installer');

const inlineScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1] ?? '';

function createRoutingHarness(fetchImpl = () => new Promise(() => {})) {
  const buttons = [
    {
      dataset: {
        cnUrl: manualMacGitHubUrl,
        globalUrl: manualMacGitHubUrl,
      },
      href: manualMacGitHubUrl,
    },
    {
      dataset: {
        cnUrl: windowsGitHubUrl,
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
  deterministic.buttons.map((button) => button.dataset.cnUrl),
  'mainland-China traffic must use the same official release asset for both platforms',
);
assert.equal(deterministic.document.documentElement.dataset.downloadRegion, 'cn');

deterministic.window.__ocupathDownloadRouting.applyCountry('US');
assert.deepEqual(
  deterministic.buttons.map((button) => button.href),
  deterministic.buttons.map((button) => button.dataset.globalUrl),
  'non-China traffic must use the same official release asset for both platforms',
);
assert.equal(deterministic.document.documentElement.dataset.downloadRegion, 'global');

deterministic.window.__ocupathDownloadRouting.applyCountry(undefined);
assert.deepEqual(
  deterministic.buttons.map((button) => button.href),
  deterministic.buttons.map((button) => button.dataset.cnUrl),
  'lookup failure must keep the exact official release asset',
);
assert.equal(deterministic.document.documentElement.dataset.downloadRegion, 'cn');

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
  /OcuPathIF_User_Guide_en\.pdf/,
  'customer page must link the version-neutral English user guide',
);
assert.match(
  html,
  /OcuPathIF_User_Guide_zh\.pdf/,
  'customer page must link the version-neutral Chinese user guide',
);
