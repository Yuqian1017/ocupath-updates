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
  if (state.localHeadSha !== state.expectedTargetCommitSha) {
    failures.push(`local HEAD SHA mismatch: ${state.localHeadSha ?? 'missing'}`);
  }
  if (state.localWorktreeClean !== true) failures.push('local updates worktree is dirty');
  if (state.localBranch !== state.expectedPublicationBranch) {
    failures.push(`local publication branch mismatch: ${state.localBranch ?? 'missing'}`);
  }
  if (state.remotePublicationBranchSha !== state.expectedTargetCommitSha) {
    failures.push(`remote publication branch SHA mismatch: ${state.remotePublicationBranchSha ?? 'missing'}`);
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
  if (state.liveRollbackState?.status !== 'GREEN') {
    failures.push(`live rollback recheck: ${state.liveRollbackState?.failures?.join('; ') || 'missing'}`);
  }

  failures.push(...exactReleaseAssetFailures(release, state.expectedAssets));
  if (state.manualCosEvidence?.status !== 'GREEN') {
    failures.push(`COS manual payload evidence: ${state.manualCosEvidence?.failures?.join('; ') || 'missing'}`);
  }
  if (state.windowsEvidence?.status !== 'GREEN') {
    failures.push(`Windows durable evidence: ${state.windowsEvidence?.failures?.join('; ') || 'missing'}`);
  }
  return { status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE', failures };
}
