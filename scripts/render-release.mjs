#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildCosAuthority, buildManualCosAuthority } from './cos-publication.mjs';
import { REGIONAL_COS_MARKER_URL_PATH } from './regional-cos-marker.mjs';
import {
  DEFAULT_STAGING_MANIFEST_URL,
  formatGigabytes,
  loadReleaseManifest,
  releaseUrls,
  validateWebsitePublicationManifest,
} from './release-manifest.mjs';

const args = new Set(process.argv.slice(2));
const allowPending = args.has('--allow-pending');
const checkOnly = args.has('--check');
const websiteOnly = args.has('--website-only');
const positional = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const manifestSource = positional ? resolve(positional) : DEFAULT_STAGING_MANIFEST_URL;
const manifest = loadReleaseManifest(manifestSource, { requireFinal: !allowPending && !websiteOnly });
if (websiteOnly) {
  const websiteValidation = validateWebsitePublicationManifest(manifest);
  if (websiteValidation.status !== 'GREEN') {
    throw new Error(`Website publication manifest is not publishable:\n- ${websiteValidation.failures.join('\n- ')}`);
  }
}
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
  html = replaceRequired(
    html,
    /<html lang="en"[^>]*>/,
    `<html lang="en" data-release-version="${manifest.version}" data-regional-marker-url="${REGIONAL_COS_MARKER_URL_PATH}">`,
    'regional marker page contract',
  );
  html = replaceRequired(html, /<title>Download OcuPathIF [^<]+<\/title>/, `<title>Download OcuPathIF ${manifest.version}</title>`, 'page title');
  html = replaceRequired(
    html,
    /<a class="download-button" data-download-platform="mac"[^>]*>/,
    `<a class="download-button" data-download-platform="mac" data-regional-key="macManual" data-cn-url="${urls.macManualGlobal}" data-cn-promoted-url="${urls.macManualCos}" data-expected-key="${mac.fileName}" data-expected-bytes="${mac.sizeBytes}" data-expected-sha256="${mac.sha256}" data-global-url="${urls.macManualGlobal}" href="${urls.macManualGlobal}">`,
    'Mac download link',
  );
  html = replaceRequired(
    html,
    /<a class="download-button" data-download-platform="windows"[^>]*>/,
    `<a class="download-button" data-download-platform="windows" data-regional-key="windowsInstaller" data-cn-url="${urls.windowsGlobal}" data-cn-promoted-url="${urls.windowsCos}" data-expected-key="${windows.fileName}" data-expected-bytes="${windows.sizeBytes}" data-expected-sha256="${windows.sha256}" data-global-url="${urls.windowsGlobal}" href="${urls.windowsGlobal}">`,
    'Windows download link',
  );
  html = replaceRequired(html, /(<p class="file-meta" data-file-meta="mac">)[^<]*(<\/p>)/, `$1Version ${manifest.version} · ${formatGigabytes(mac.sizeBytes)}$2`, 'Mac metadata');
  html = replaceRequired(html, /(<p class="file-meta" data-file-meta="windows">)[^<]*(<\/p>)/, `$1Version ${manifest.version} · ${formatGigabytes(windows.sizeBytes)}$2`, 'Windows metadata');
  html = replaceRequired(html, /(<p class="filename" data-file-name="mac">)[^<]*(<\/p>)/, `$1${mac.fileName}$2`, 'Mac filename');
  html = replaceRequired(html, /(<p class="filename" data-file-name="windows">)[^<]*(<\/p>)/, `$1${windows.fileName}$2`, 'Windows filename');
  html = replaceRequired(html, /(<code data-sha256="mac">)[^<]*(<\/code>)/, `$1${mac.sha256}$2`, 'Mac SHA-256');
  html = replaceRequired(html, /(<code data-sha256="windows">)[^<]*(<\/code>)/, `$1${windows.sha256}$2`, 'Windows SHA-256');
  html = replaceRequired(
    html,
    /(<h3 id="mac-steps">Install on macOS<\/h3>\s*)<ol>[\s\S]*?<\/ol>/,
    '$1<ol><li>Open the downloaded DMG.</li><li>Drag OcuPathIF into Applications.</li><li>Open OcuPathIF from Applications.</li></ol>',
    'Mac DMG installation steps',
  );
  html = replaceRequired(html, /(<a data-guide-language="en") href="[^"]+"/, `$1 href="${urls.guideEn}"`, 'English guide');
  html = replaceRequired(html, /(<a data-guide-language="zh") href="[^"]+"/, `$1 href="${urls.guideZh}"`, 'Chinese guide');
  return html;
}

function updaterFeed(asset, artifactUrl) {
  return `version: ${manifest.version}\nfiles:\n  - url: ${artifactUrl}\n    sha512: ${asset.sha512}\n    size: ${asset.sizeBytes}\npath: ${artifactUrl}\nsha512: ${asset.sha512}\nreleaseDate: '${manifest.releaseDate}'\n`;
}

const outputs = new Map();
const installPath = new URL('ocupathif/install.html', root);
const macFeedBody = updaterFeed(manifest.assets.macUpdater, urls.macUpdaterCos);
const windowsFeedBody = updaterFeed(manifest.assets.windowsInstaller, urls.windowsCos);
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
  new URL('release-manifests/v0.995.1-manual-cos-authority.json', root),
  `${JSON.stringify(buildManualCosAuthority(manifest), null, 2)}\n`,
);
outputs.set(
  new URL('ocupathif/direct/win32-x64/latest.yml', root),
  windowsFeedBody,
);
if (!websiteOnly) {
  outputs.set(
    new URL('ocupathif/direct/darwin-arm64/latest-mac.yml', root),
    macFeedBody,
  );
  outputs.set(
    new URL('release-manifests/v0.995.1-cos-authority.json', root),
    `${JSON.stringify(buildCosAuthority(manifest, { darwinArm64: macFeedBody }), null, 2)}\n`,
  );
}

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
process.stdout.write(`${checkOnly ? 'checked' : 'rendered'} ${outputs.size} ${websiteOnly ? 'website ' : ''}publication files from ${manifest.version} staging manifest${allowPending ? ' (pending allowed)' : ''}\n`);
