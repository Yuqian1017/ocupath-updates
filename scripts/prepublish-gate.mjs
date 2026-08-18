function assetMap(assets = []) {
  const map = new Map();
  const duplicates = new Set();
  for (const asset of assets) {
    if (map.has(asset.name)) duplicates.add(asset.name);
    map.set(asset.name, asset);
  }
  return { map, duplicates };
}

export function exactReleaseAssetFailures(release, expectedAssets = {}) {
  const failures = [];
  const actualAssets = release?.assets ?? [];
  const expectedNames = Object.keys(expectedAssets);
  const { map, duplicates } = assetMap(actualAssets);
  const actualNames = [...map.keys()];
  const extras = actualNames.filter((name) => !Object.hasOwn(expectedAssets, name));

  if (actualAssets.length !== expectedNames.length) {
    failures.push(`release asset count mismatch: ${actualAssets.length}/${expectedNames.length}`);
  }
  if (duplicates.size > 0) failures.push(`duplicate release assets: ${[...duplicates].sort().join(', ')}`);
  if (extras.length > 0) failures.push(`unexpected release assets: ${extras.sort().join(', ')}`);

  for (const [name, expected] of Object.entries(expectedAssets)) {
    const actual = map.get(name);
    if (!actual) {
      failures.push(`missing release asset: ${name}`);
      continue;
    }
    if (actual.state !== 'uploaded') {
      failures.push(`release asset incomplete: ${name} (${actual.state ?? 'missing state'})`);
      continue;
    }
    if (actual.size !== expected.size || actual.digest !== expected.digest) {
      failures.push(`release asset bytes mismatch: ${name}`);
    }
  }
  return failures;
}

export function evaluatePrepublishGate(state) {
  const failures = [];
  const release = state.release ?? {};

  if (state.publicationFilesCurrent !== true) {
    failures.push('rendered publication files do not match the frozen staging manifest');
  }
  if (release.draft !== true) failures.push('release is not a draft');
  if (release.tagName !== state.expectedTagName) {
    failures.push(`release tag mismatch: ${release.tagName ?? 'missing'}`);
  }
  if (release.targetCommitish !== state.expectedTargetCommitSha) {
    failures.push(`release target SHA mismatch: ${release.targetCommitish ?? 'missing'}`);
  }
  if (state.remoteTagPresent) {
    failures.push(`remote tag already exists before publication: ${state.expectedTagName}`);
  }
  if (state.liveVersion !== state.expectedRollbackVersion) {
    failures.push(`live rollback version mismatch: ${state.liveVersion ?? 'missing'}`);
  }
  if (state.rollbackAuthority?.status !== 'GREEN') {
    failures.push(`rollback authority: ${state.rollbackAuthority?.failures?.join('; ') || 'missing'}`);
  }

  failures.push(...exactReleaseAssetFailures(release, state.expectedAssets));
  if (state.cosEvidence?.status !== 'GREEN') {
    failures.push(`COS six-object evidence: ${state.cosEvidence?.failures?.join('; ') || 'missing'}`);
  }
  if (state.macTwoLegTransaction !== 'PASS') {
    failures.push(`Mac two-leg updater transaction: ${state.macTwoLegTransaction}`);
  }
  if (state.windowsEvidence?.status !== 'GREEN') {
    failures.push(`Windows durable evidence: ${state.windowsEvidence?.failures?.join('; ') || 'missing'}`);
  }
  return { status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE', failures };
}
