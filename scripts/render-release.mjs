#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_STAGING_MANIFEST_URL,
  formatGigabytes,
  loadReleaseManifest,
  releaseUrls,
} from './release-manifest.mjs';

const args = new Set(process.argv.slice(2));
const allowPending = args.has('--allow-pending');
const checkOnly = args.has('--check');
const positional = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const manifestSource = positional ? resolve(positional) : DEFAULT_STAGING_MANIFEST_URL;
const manifest = loadReleaseManifest(manifestSource, { requireFinal: !allowPending });
const urls = releaseUrls(manifest);
const root = new URL('../', import.meta.url);

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Cannot render ${label}: marker not found`);
  return source.replace(pattern, replacement);
}

function renderInstallPage(source) {
  const mac = manifest.assets.macManual;
  const windows = manifest.assets.windowsInstaller;
  let html = source;
  html = replaceRequired(html, /<title>Download OcuPathIF [^<]+<\/title>/, `<title>Download OcuPathIF ${manifest.version}</title>`, 'page title');
  html = replaceRequired(
    html,
    /<a class="download-button" data-download-platform="mac"[^>]*>/,
    `<a class="download-button" data-download-platform="mac" data-cn-url="${urls.macManualCos}" data-global-url="${urls.macManualGlobal}" href="${urls.macManualGlobal}">`,
    'Mac download link',
  );
  html = replaceRequired(
    html,
    /<a class="download-button" data-download-platform="windows"[^>]*>/,
    `<a class="download-button" data-download-platform="windows" data-cn-url="${urls.windowsCos}" data-global-url="${urls.windowsGlobal}" href="${urls.windowsGlobal}">`,
    'Windows download link',
  );
  html = replaceRequired(html, /(<p class="file-meta" data-file-meta="mac">)[^<]*(<\/p>)/, `$1Version ${manifest.version} · ${formatGigabytes(mac.sizeBytes)}$2`, 'Mac metadata');
  html = replaceRequired(html, /(<p class="file-meta" data-file-meta="windows">)[^<]*(<\/p>)/, `$1Version ${manifest.version} · ${formatGigabytes(windows.sizeBytes)}$2`, 'Windows metadata');
  html = replaceRequired(html, /(<p class="filename" data-file-name="mac">)[^<]*(<\/p>)/, `$1${mac.fileName}$2`, 'Mac filename');
  html = replaceRequired(html, /(<p class="filename" data-file-name="windows">)[^<]*(<\/p>)/, `$1${windows.fileName}$2`, 'Windows filename');
  html = replaceRequired(html, /(<code data-sha256="mac">)[^<]*(<\/code>)/, `$1${mac.sha256}$2`, 'Mac SHA-256');
  html = replaceRequired(html, /(<code data-sha256="windows">)[^<]*(<\/code>)/, `$1${windows.sha256}$2`, 'Windows SHA-256');
  html = replaceRequired(html, /(<a data-guide-language="en") href="[^"]+"/, `$1 href="${urls.guideEn}"`, 'English guide');
  html = replaceRequired(html, /(<a data-guide-language="zh") href="[^"]+"/, `$1 href="${urls.guideZh}"`, 'Chinese guide');
  return html;
}

function updaterFeed(asset, artifactUrl) {
  return `version: ${manifest.version}\nfiles:\n  - url: ${artifactUrl}\n    sha512: ${asset.sha512}\n    size: ${asset.sizeBytes}\npath: ${artifactUrl}\nsha512: ${asset.sha512}\nreleaseDate: '${manifest.releaseDate}'\n`;
}

const outputs = new Map();
const installPath = new URL('ocupathif/install.html', root);
outputs.set(installPath, renderInstallPage(readFileSync(installPath, 'utf8')));
outputs.set(new URL('ocupathif/latest.json', root), `${JSON.stringify({
  schemaVersion: 1,
  appId: 'com.biostateai.ocupathif',
  channel: 'stable',
  version: manifest.version,
  releaseDate: manifest.releaseDate,
  packages: {
    'darwin-arm64': {
      kind: 'manual_page',
      url: urls.installPage,
      sha256: manifest.assets.macManual.sha256,
      sizeBytes: manifest.assets.macManual.sizeBytes,
      signature: 'Apple notarized and stapled; Developer ID Application: Biostate AI, Incorporated (6269FUBJZ5)',
    },
    'win32-x64': {
      kind: 'manual_page',
      url: urls.installPage,
      sha256: manifest.assets.windowsInstaller.sha256,
      sizeBytes: manifest.assets.windowsInstaller.sizeBytes,
    },
  },
}, null, 2)}\n`);
outputs.set(
  new URL('ocupathif/direct/darwin-arm64/latest-mac.yml', root),
  updaterFeed(manifest.assets.macUpdater, urls.macUpdaterCos),
);
outputs.set(
  new URL('ocupathif/direct/win32-x64/latest.yml', root),
  updaterFeed(manifest.assets.windowsInstaller, urls.windowsCos),
);

const mismatches = [];
for (const [target, content] of outputs) {
  if (checkOnly) {
    let actual;
    try {
      actual = readFileSync(target, 'utf8');
    } catch {
      actual = undefined;
    }
    if (actual !== content) mismatches.push(target.pathname);
  } else {
    writeFileSync(target, content);
  }
}

if (mismatches.length > 0) {
  throw new Error(`Generated publication files are stale:\n- ${mismatches.join('\n- ')}`);
}
process.stdout.write(`${checkOnly ? 'checked' : 'rendered'} ${outputs.size} publication files from ${manifest.version} staging manifest${allowPending ? ' (pending allowed)' : ''}\n`);
