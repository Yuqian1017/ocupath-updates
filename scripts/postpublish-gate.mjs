import { exactReleaseAssetFailures } from './prepublish-gate.mjs';

export function parseUpdaterMetadata(body) {
  function scalar(key) {
    const match = body.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
    if (!match) return undefined;
    return match[1].trim().replace(/^['"]|['"]$/g, '');
  }

  return {
    version: scalar('version'),
    path: scalar('path'),
    sha512: scalar('sha512'),
    size: Number(scalar('size')),
  };
}

function exactRuntimeFeed(feed, expectedVersion) {
  return feed.url === feed.expectedUrl
    && feed.httpStatus === 200
    && feed.sha256 === feed.expectedSha256
    && feed.version === expectedVersion
    && feed.path === feed.expectedPath
    && feed.sha512 === feed.expectedSha512
    && feed.size === feed.expectedSize;
}

function acceptedRegionalStatus(value) {
  return value === 'PASS' || value === 'baseline-reused';
}

export function evaluatePostpublishGate(state) {
  const failures = [];

  if (state.liveVersion !== state.expectedVersion) {
    failures.push(`live version mismatch: ${state.liveVersion ?? 'missing'}`);
  }
  if (state.expectedRegionalPromotionSha === state.expectedTargetCommitSha) {
    failures.push('regional promotion SHA must differ from the immutable base release SHA');
  }
  if (state.localHeadSha !== state.expectedRegionalPromotionSha) {
    failures.push(`local HEAD SHA mismatch: ${state.localHeadSha ?? 'missing'}`);
  }
  if (state.localWorktreeClean !== true) failures.push('local updates worktree is dirty');
  if (state.localBranch !== state.expectedPublicationBranch) {
    failures.push(`local publication branch mismatch: ${state.localBranch ?? 'missing'}`);
  }
  if (state.remotePublicationBranchSha !== state.expectedRegionalPromotionSha) {
    failures.push(`remote publication branch SHA mismatch: ${state.remotePublicationBranchSha ?? 'missing'}`);
  }
  if (state.regionalPromotionParentSha !== state.expectedTargetCommitSha) {
    failures.push(`regional promotion parent SHA mismatch: ${state.regionalPromotionParentSha ?? 'missing'}`);
  }
  if (JSON.stringify(state.regionalPromotionChangedFiles) !== JSON.stringify([{
    status: 'A',
    path: state.expectedRegionalMarkerPath,
  }])) failures.push(`regional promotion commit must add only ${state.expectedRegionalMarkerPath}`);
  if (state.regionalMarkerPresentAtBase !== false) {
    failures.push('regional marker already existed in the immutable base release commit');
  }
  if (state.regionalMarkerEvidence?.status !== 'GREEN') {
    failures.push(`regional marker evidence: ${state.regionalMarkerEvidence?.failures?.join('; ') || 'missing'}`);
  }
  if (
    state.liveRegionalMarker?.httpStatus !== 200
    || state.liveRegionalMarker?.sha256 !== state.liveRegionalMarker?.expectedSha256
    || state.liveRegionalMarker?.expectedSha256 !== state.regionalMarkerEvidence?.sha256
  ) failures.push('live regional COS marker does not match the promotion commit');
  const release = state.release ?? {};
  if (release.draft !== false) failures.push('release is still a draft');
  if (release.tagName !== state.expectedTagName) {
    failures.push(`published release tag mismatch: ${release.tagName ?? 'missing'}`);
  }
  if (release.targetCommitish !== state.expectedTargetCommitSha) {
    failures.push(`published release target SHA mismatch: ${release.targetCommitish ?? 'missing'}`);
  }
  if (state.remoteTagCommitSha !== state.expectedTargetCommitSha) {
    failures.push(`remote tag commit SHA mismatch: ${state.remoteTagCommitSha ?? 'missing'}`);
  }
  failures.push(...exactReleaseAssetFailures(release, state.expectedAssets));
  if (
    state.liveManualPublication?.latestJsonHttpStatus !== 200
    || state.liveManualPublication?.latestJsonSha256 !== state.liveManualPublication?.expectedLatestJsonSha256
  ) {
    failures.push('live latest.json does not match the frozen staging manifest');
  }
  if (
    state.liveManualPublication?.installPageHttpStatus !== 200
    || state.liveManualPublication?.installPageSha256 !== state.liveManualPublication?.expectedInstallPageSha256
  ) {
    failures.push('live install.html does not match the rendered publication page');
  }

  const runtimeFeeds = state.productionRuntimeFeeds ?? {};
  if (!exactRuntimeFeed(runtimeFeeds.darwinArm64 ?? {}, state.expectedVersion)) {
    failures.push('production Mac runtime feed is not the exact packaged-app route');
  }
  if (!exactRuntimeFeed(runtimeFeeds.win32X64 ?? {}, state.expectedVersion)) {
    failures.push('production Windows detection feed is not the exact packaged-app route');
  }

  if (state.productionOldVersion !== state.expectedOldVersion) {
    failures.push(`production updater source mismatch: ${state.productionOldVersion ?? 'missing'}`);
  }
  if (state.productionTargetVersion !== state.expectedVersion) {
    failures.push(`production updater target mismatch: ${state.productionTargetVersion ?? 'missing'}`);
  }

  const macAutomaticPassed = state.productionUpdaterTransaction === 'PASS';
  const macManualFallbackPassed = state.macUpdateDetection === 'PASS'
    && state.macManualFallback === 'PASS';
  if (!macAutomaticPassed && !macManualFallbackPassed) {
    failures.push(
      `Mac update reachability: transaction=${state.productionUpdaterTransaction}, detection=${state.macUpdateDetection}, manualFallback=${state.macManualFallback}`,
    );
  }
  if (macAutomaticPassed) {
    if (state.automaticRelaunch !== true) failures.push('automatic relaunch was not observed');
    if (state.unchangedSentinels !== state.expectedSentinels) {
      failures.push(`unchanged sentinels: ${state.unchangedSentinels}/${state.expectedSentinels}`);
    }
    if (!(state.rangeRequestCount > 0)) failures.push('no differential Range request was observed');
    if (state.fullZipHttp200Count !== 0) {
      failures.push('full updater ZIP was transferred instead of the differential path');
    }
  }

  if (state.windowsEvidence?.status !== 'GREEN') {
    failures.push(`Windows durable evidence: ${state.windowsEvidence?.failures?.join('; ') || 'missing'}`);
  }
  if (state.cosEvidence?.status !== 'GREEN') {
    failures.push(`COS six-object evidence: ${state.cosEvidence?.failures?.join('; ') || 'missing'}`);
  }

  if (state.macManualDownload !== 'PASS') {
    failures.push(`Mac production Manual Download transaction: ${state.macManualDownload}`);
  }
  if (!acceptedRegionalStatus(state.chinaMacValidation)) {
    failures.push(`China Mac regional validation: ${state.chinaMacValidation}`);
  }
  if (!acceptedRegionalStatus(state.chinaWindowsValidation)) {
    failures.push(`China Windows regional validation: ${state.chinaWindowsValidation}`);
  }
  if (state.baiduAtomicPromotion !== 'PASS') {
    failures.push(`Baidu atomic promotion: ${state.baiduAtomicPromotion}`);
  }

  return { status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE', failures };
}
