export function evaluatePostpublishGate(state) {
  const failures = [];

  if (state.liveVersion !== state.expectedVersion) {
    failures.push(`live version mismatch: ${state.liveVersion ?? 'missing'}`);
  }
  if (state.releaseDraft !== false) failures.push('release is still a draft');
  if (state.releaseTagName !== state.expectedTagName) {
    failures.push(`published release tag mismatch: ${state.releaseTagName ?? 'missing'}`);
  }
  if (state.productionOldVersion !== state.expectedOldVersion) {
    failures.push(`production updater source mismatch: ${state.productionOldVersion ?? 'missing'}`);
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

  return { status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE', failures };
}
