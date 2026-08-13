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

export function evaluatePostpublishGate(state) {
  const failures = [];

  if (state.liveVersion !== state.expectedVersion) {
    failures.push(`live version mismatch: ${state.liveVersion ?? 'missing'}`);
  }
  if (state.releaseDraft !== false) failures.push('release is still a draft');
  if (state.releaseTagName !== state.expectedTagName) {
    failures.push(`published release tag mismatch: ${state.releaseTagName ?? 'missing'}`);
  }

  const runtimeFeed = state.productionRuntimeFeed ?? {};
  const runtimeFeedExact = runtimeFeed.url === runtimeFeed.expectedUrl
    && runtimeFeed.httpStatus === 200
    && runtimeFeed.sha256 === runtimeFeed.expectedSha256
    && runtimeFeed.version === state.expectedVersion
    && runtimeFeed.path === runtimeFeed.expectedPath
    && runtimeFeed.sha512 === runtimeFeed.expectedSha512
    && runtimeFeed.size === runtimeFeed.expectedSize;
  if (!runtimeFeedExact) {
    failures.push('production runtime feed is not the exact packaged-app route');
  }

  if (state.productionOldVersion !== state.expectedOldVersion) {
    failures.push(`production updater source mismatch: ${state.productionOldVersion ?? 'missing'}`);
  }
  if (state.productionTargetVersion !== state.expectedVersion) {
    failures.push(`production updater target mismatch: ${state.productionTargetVersion ?? 'missing'}`);
  }
  if (state.productionUpdaterTransaction !== 'PASS') {
    failures.push(
      `production ${state.expectedOldVersion} to ${state.expectedVersion} updater transaction: ${state.productionUpdaterTransaction}`,
    );
  }
  if (state.automaticRelaunch !== true) failures.push('automatic relaunch was not observed');
  if (state.unchangedSentinels !== state.expectedSentinels) {
    failures.push(`unchanged sentinels: ${state.unchangedSentinels}/${state.expectedSentinels}`);
  }
  if (!(state.rangeRequestCount > 0)) failures.push('no differential Range request was observed');
  if (state.fullZipHttp200Count !== 0) {
    failures.push('full updater ZIP was transferred instead of the differential path');
  }
  if (state.macManualDownload !== 'PASS') {
    failures.push(`Mac production Manual Download transaction: ${state.macManualDownload}`);
  }
  if (state.windowsManualDownload !== 'PASS') {
    failures.push(`Windows production Manual Download transaction: ${state.windowsManualDownload}`);
  }
  if (state.chinaMacTransaction !== 'PASS') {
    failures.push(`China Mac complete download/install/relaunch transaction: ${state.chinaMacTransaction}`);
  }
  if (state.chinaWindowsTransaction !== 'PASS') {
    failures.push(`China Windows complete download/install/relaunch transaction: ${state.chinaWindowsTransaction}`);
  }

  return { status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE', failures };
}
