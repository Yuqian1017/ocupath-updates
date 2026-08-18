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
  if (state.releaseDraft !== false) failures.push('release is still a draft');
  if (state.releaseTagName !== state.expectedTagName) {
    failures.push(`published release tag mismatch: ${state.releaseTagName ?? 'missing'}`);
  }
  if (state.liveManualPublication?.latestManifestExact !== true) {
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

  if (state.windowsUpdateDetection !== 'PASS') {
    failures.push(`Windows update detection: ${state.windowsUpdateDetection}`);
  }
  if (state.windowsInstallMode !== 'manual') {
    failures.push(`Windows install mode: ${state.windowsInstallMode ?? 'missing'}`);
  }
  if (state.windowsManualFallback !== 'PASS') {
    failures.push(`Windows Manual Download fallback: ${state.windowsManualFallback}`);
  }
  if (state.windowsAutomaticInstallObserved === true) {
    failures.push('Windows attempted automatic installation instead of Manual Download');
  }

  if (state.macManualDownload !== 'PASS') {
    failures.push(`Mac production Manual Download transaction: ${state.macManualDownload}`);
  }
  if (state.windowsManualDownload !== 'PASS') {
    failures.push(`Windows production Manual Download transaction: ${state.windowsManualDownload}`);
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
