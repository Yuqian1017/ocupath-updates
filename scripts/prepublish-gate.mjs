function assetMap(assets = []) {
  return new Map(assets.map((asset) => [asset.name, asset]));
}

export function evaluatePrepublishGate(state) {
  const failures = [];
  const release = state.release ?? {};

  if (release.draft !== true) failures.push('release is not a draft');
  if (release.tagName !== state.expectedTagName) {
    failures.push(`release tag mismatch: ${release.tagName ?? 'missing'}`);
  }
  if (release.targetCommitish !== state.expectedTargetCommitish) {
    failures.push(`release target mismatch: ${release.targetCommitish ?? 'missing'}`);
  }
  if (state.remoteTagPresent) {
    failures.push(`remote tag already exists before publication: ${state.expectedTagName}`);
  }
  if (state.liveVersion !== state.expectedRollbackVersion) {
    failures.push(`live rollback version mismatch: ${state.liveVersion ?? 'missing'}`);
  }

  const actualAssets = assetMap(release.assets);
  for (const [name, expected] of Object.entries(state.expectedAssets ?? {})) {
    const actual = actualAssets.get(name);
    if (!actual) {
      failures.push(`missing release asset: ${name}`);
      continue;
    }
    if (actual.size !== expected.size || actual.digest !== expected.digest) {
      failures.push(`release asset bytes mismatch: ${name}`);
    }
  }

  if (state.cosObjectsVerified !== state.expectedCosObjects) {
    failures.push(`COS exact objects verified: ${state.cosObjectsVerified}/${state.expectedCosObjects}`);
  }
  if (state.macTwoLegTransaction !== 'PASS') {
    failures.push(`Mac two-leg updater transaction: ${state.macTwoLegTransaction}`);
  }
  if (state.windowsNativeValidation !== 'PASS') {
    failures.push(`Windows native validation: ${state.windowsNativeValidation}`);
  }
  if (state.baiduAtomicPromotion !== 'PASS') {
    failures.push(`Baidu atomic promotion: ${state.baiduAtomicPromotion}`);
  }

  return { status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE', failures };
}
