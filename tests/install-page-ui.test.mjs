import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const hongKongOrigin = 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com';
assert.equal(
  (html.match(/data-download-source="hong-kong"/g) ?? []).length,
  2,
  'both platforms must expose the Hong Kong mirror as a direct download source',
);
assert.match(
  html,
  new RegExp(`href="${hongKongOrigin}/OcupathIF-0\\.99\\.1-arm64-mac\\.zip"`),
  'Mac Hong Kong mirror must target the exact source-protected release asset',
);
assert.match(
  html,
  new RegExp(`href="${hongKongOrigin}/OcupathIF-Setup-0\\.99\\.1-x64\\.exe"`),
  'Windows Hong Kong mirror must target the exact source-protected release asset',
);
assert.equal(
  (html.match(/data-download-source="github"/g) ?? []).length,
  2,
  'both platforms must retain a visible GitHub fallback',
);
assert.equal(
  (html.match(/class="alternate-download"/g) ?? []).length,
  2,
  'the alternate source must be visible without JavaScript or hover',
);
assert.match(
  html,
  /Hong Kong mirror is recommended for users in mainland China/i,
  'the page must explain the regional choice in plain language',
);
assert.match(
  html,
  /If one download source is slow or unavailable, use the other/i,
  'the page must explain the fallback action without technical jargon',
);

console.log('install page UI contract: PASS');
