import { readFileSync } from 'node:fs';

export const DEFAULT_STAGING_MANIFEST_URL = new URL(
  '../release-manifests/v0.995.1-staging.json',
  import.meta.url,
);

const PENDING_PREFIX = '__PENDING_';

export function isPendingValue(value) {
  return typeof value === 'string'
    && value.startsWith(PENDING_PREFIX)
    && value.endsWith('__');
}

function visitPending(value, path, pending) {
  if (isPendingValue(value)) {
    pending.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitPending(entry, `${path}[${index}]`, pending));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => {
      visitPending(entry, path ? `${path}.${key}` : key, pending);
    });
  }
}

function requireValue(condition, message, failures) {
  if (!condition) failures.push(message);
}

function validSha256(value) {
  return isPendingValue(value) || /^[a-f0-9]{64}$/.test(value);
}

function validSha512(value) {
  if (isPendingValue(value)) return true;
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 64 && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}

function validBytes(value) {
  return isPendingValue(value) || (Number.isSafeInteger(value) && value > 0);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isSameVersionReplacement(manifest) {
  const version = manifest?.version;
  const tagName = manifest?.release?.tagName;
  if (typeof version !== 'string' || typeof tagName !== 'string') return false;
  return new RegExp(`^v${escapeRegExp(version)}-r(?:[2-9]|[1-9][0-9]+)$`).test(tagName);
}

export function assetCosKey(manifest, assetKey) {
  const asset = manifest?.assets?.[assetKey];
  return asset?.cosKey || asset?.fileName;
}

export function regionalPromotionTopology(manifest) {
  if (isSameVersionReplacement(manifest)) {
    return { markerPresentAtBase: true, markerDiffStatus: 'M' };
  }
  return { markerPresentAtBase: false, markerDiffStatus: 'A' };
}

export function isCanonicalUtcIso(value, { allowPending = true } = {}) {
  if (allowPending && isPendingValue(value)) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export function validateReleaseManifest(manifest, { requireFinal = true } = {}) {
  const failures = [];
  const version = manifest?.version;
  const assets = manifest?.assets ?? {};

  requireValue(manifest?.schemaVersion === 1, 'schemaVersion must be 1', failures);
  requireValue(version === '0.995.1', `version must be 0.995.1, got ${version ?? 'missing'}`, failures);
  requireValue(manifest?.previousLiveVersion === '0.994.1', 'previousLiveVersion must be 0.994.1', failures);
  requireValue(manifest?.release?.repository === 'Yuqian1017/ocupath-updates', 'release.repository mismatch', failures);
  const initialTagName = `v${version}`;
  const replacementRelease = isSameVersionReplacement(manifest);
  requireValue(
    manifest?.release?.tagName === initialTagName || replacementRelease,
    'release.tagName must match version or use a monotonic same-version replacement suffix',
    failures,
  );
  requireValue(
    !Object.hasOwn(manifest?.release ?? {}, 'targetCommitish'),
    'release.targetCommitish must not be stored in the manifest; supply OCUPATH_RELEASE_TARGET_SHA',
    failures,
  );
  requireValue(manifest?.origins?.public === 'https://updates.ocupath.ai/ocupathif', 'public origin mismatch', failures);
  requireValue(
    manifest?.origins?.cos === 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com',
    'COS origin mismatch',
    failures,
  );
  requireValue(
    JSON.stringify(manifest?.publication?.githubAssetKeys) === JSON.stringify([
      'macManual',
      'windowsInstaller',
      'guideEn',
      'guideZh',
    ]),
    'publication.githubAssetKeys must name the exact four release assets',
    failures,
  );
  requireValue(
    JSON.stringify(manifest?.publication?.cosObjects) === JSON.stringify([
      { order: 1, phase: 'payload', assetKey: 'macManual' },
      { order: 2, phase: 'payload', assetKey: 'windowsInstaller' },
      { order: 3, phase: 'payload', assetKey: 'macUpdater' },
      { order: 4, phase: 'payload', assetKey: 'macUpdaterBlockmap' },
      { order: 5, phase: 'metadata', key: 'latest-mac.yml', feedKey: 'darwinArm64' },
      { order: 6, phase: 'metadata', key: 'darwin-arm64/latest-mac.yml', feedKey: 'darwinArm64' },
    ]),
    'publication.cosObjects must contain the exact six payload-first, metadata-last objects',
    failures,
  );
  requireValue(
    isCanonicalUtcIso(manifest?.releaseDate),
    'releaseDate must be canonical UTC ISO (YYYY-MM-DDTHH:mm:ss.sssZ)',
    failures,
  );
  requireValue(
    isPendingValue(manifest?.release?.draftReleaseId) || /^\d+$/.test(manifest?.release?.draftReleaseId),
    'release.draftReleaseId must be numeric',
    failures,
  );

  const expectedNames = {
    macManual: `OcupathIF-${version}-arm64-mac.dmg`,
    macUpdater: `OcupathIF-${version}-arm64-mac.zip`,
    macUpdaterBlockmap: `OcupathIF-${version}-arm64-mac.zip.blockmap`,
    windowsInstaller: `OcupathIF-Setup-${version}-x64.exe`,
    guideEn: `OcuPathIF_v${version}_User_Guide_en.pdf`,
    guideZh: `OcuPathIF_v${version}_User_Guide_zh.pdf`,
  };
  for (const [key, expectedName] of Object.entries(expectedNames)) {
    const asset = assets[key];
    requireValue(Boolean(asset), `assets.${key} is missing`, failures);
    if (!asset) continue;
    requireValue(asset.fileName === expectedName, `assets.${key}.fileName mismatch`, failures);
    requireValue(validBytes(asset.sizeBytes), `assets.${key}.sizeBytes is invalid`, failures);
    requireValue(validSha256(asset.sha256), `assets.${key}.sha256 is invalid`, failures);
  }
  const cosPayloadKeys = ['macManual', 'windowsInstaller', 'macUpdater', 'macUpdaterBlockmap'];
  for (const key of cosPayloadKeys) {
    const asset = assets[key];
    if (!asset) continue;
    if (replacementRelease) {
      const expectedCosKey = `revisions/${manifest.release.tagName}/${asset.fileName}`;
      requireValue(
        asset.cosKey === expectedCosKey,
        `same-version replacement requires assets.${key}.cosKey=${expectedCosKey}`,
        failures,
      );
    } else {
      requireValue(
        !Object.hasOwn(asset, 'cosKey'),
        `initial release must not define assets.${key}.cosKey`,
        failures,
      );
    }
  }
  requireValue(validSha512(assets.macUpdater?.sha512), 'assets.macUpdater.sha512 is invalid', failures);
  requireValue(validSha512(assets.windowsInstaller?.sha512), 'assets.windowsInstaller.sha512 is invalid', failures);
  requireValue(
    manifest?.feeds?.darwinArm64?.path === 'direct/darwin-arm64/latest-mac.yml',
    'darwin feed path mismatch',
    failures,
  );
  requireValue(
    manifest?.feeds?.win32X64?.path === 'direct/win32-x64/latest.yml',
    'Windows feed path mismatch',
    failures,
  );
  requireValue(manifest?.feeds?.win32X64?.installMode === 'manual', 'Windows installMode must be manual', failures);

  const pending = [];
  visitPending(manifest, '', pending);
  if (requireFinal && pending.length > 0) {
    failures.push(`pending publication fields: ${pending.join(', ')}`);
  }

  return {
    status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE',
    failures,
    pending,
  };
}

export function validateWebsitePublicationManifest(manifest) {
  const base = validateReleaseManifest(manifest, { requireFinal: false });
  const requiredPaths = new Set([
    'releaseDate',
    'release.draftReleaseId',
    'assets.macManual.sizeBytes',
    'assets.macManual.sha256',
    'assets.windowsInstaller.sizeBytes',
    'assets.windowsInstaller.sha256',
    'assets.windowsInstaller.sha512',
    'assets.guideEn.sizeBytes',
    'assets.guideEn.sha256',
    'assets.guideZh.sizeBytes',
    'assets.guideZh.sha256',
  ]);
  const websitePending = base.pending.filter((path) => requiredPaths.has(path));
  const failures = [...base.failures];
  if (websitePending.length > 0) failures.push(`pending website publication fields: ${websitePending.join(', ')}`);
  return {
    status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE',
    failures,
    pending: websitePending,
  };
}

export function loadReleaseManifest(pathOrUrl, options) {
  const source = pathOrUrl || process.env.OCUPATH_RELEASE_STAGING_MANIFEST || DEFAULT_STAGING_MANIFEST_URL;
  const manifest = JSON.parse(readFileSync(source, 'utf8'));
  const result = validateReleaseManifest(manifest, options);
  if (result.status !== 'GREEN') {
    const error = new Error(`Release manifest is not publishable:\n- ${result.failures.join('\n- ')}`);
    error.validation = result;
    throw error;
  }
  return manifest;
}

export function findPendingFields(value) {
  const pending = [];
  visitPending(value, '', pending);
  return pending;
}

export function requireExactCommitSha(value, label = 'commit SHA') {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be an externally supplied exact 40-char lowercase SHA`);
  }
  return value;
}

export function requirePublicationBranch(value) {
  if (typeof value !== 'string' || !/^release\/[a-z0-9][a-z0-9._/-]*$/.test(value)) {
    throw new Error('OCUPATH_RELEASE_BRANCH must be an explicit release/* branch name');
  }
  return value;
}

export function resolvePublicUrl(manifest, rootPath) {
  return new URL(rootPath, manifest.origins.public).href;
}

export function releaseUrls(manifest) {
  const tagBase = `https://github.com/${manifest.release.repository}/releases/download/${manifest.release.tagName}`;
  const cosBase = manifest.origins.cos;
  const publicBase = manifest.origins.public;
  const assetUrl = (base, key) => `${base}/${manifest.assets[key].fileName}`;
  const cosAssetUrl = (key) => `${cosBase}/${assetCosKey(manifest, key)}`;
  return {
    installPage: `${publicBase}/install.html`,
    macManualGlobal: assetUrl(tagBase, 'macManual'),
    macManualCos: cosAssetUrl('macManual'),
    macUpdaterCos: cosAssetUrl('macUpdater'),
    windowsGlobal: assetUrl(tagBase, 'windowsInstaller'),
    windowsCos: cosAssetUrl('windowsInstaller'),
    guideEn: assetUrl(tagBase, 'guideEn'),
    guideZh: assetUrl(tagBase, 'guideZh'),
    macFeed: `${publicBase}/${manifest.feeds.darwinArm64.path}`,
    windowsFeed: `${publicBase}/${manifest.feeds.win32X64.path}`,
  };
}

export function formatGigabytes(value) {
  if (!Number.isSafeInteger(value)) return 'Pending final package';
  return `${(value / (1024 ** 3)).toFixed(2)} GB`;
}
