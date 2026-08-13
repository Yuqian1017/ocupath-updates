import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/attach-public-assets-09911-temp.yml', import.meta.url),
  'utf8',
);

test('temporary transfer waits for exact COS bytes and can only update the unpublished draft', () => {
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- release\/0991-two-leg-feed-20260810/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /RELEASE_TAG: v0\.991\.1-c801/);
  assert.match(workflow, /1318746948/);
  assert.match(workflow, /c18c0d29158f8c24ea8e7861dba52100581dde5e10af3600a8d5127452364009/);
  assert.match(workflow, /1354650736/);
  assert.match(workflow, /3db8fcd6deabbc55e2b37c6e086234bf448d536392703e5700e83ca4803091ac/);
  assert.match(workflow, /1313793497/);
  assert.match(workflow, /7acb800aea86d9675078b0497956c905a213544bb95f6229623de52b7d521162/);
  assert.match(workflow, /1362071/);
  assert.match(workflow, /e4f027c422a395dd3f88a4562bdd3124df617452fee163f554a6e6240b4e7d10/);
  assert.match(workflow, /remote_length/);
  assert.match(workflow, /sha256sum --check --strict/);
  assert.match(workflow, /\.draft/);
  assert.match(workflow, /\.body == null/);
  assert.match(workflow, /cleanup_invalid_targets/);
  assert.match(workflow, /https:\/\/uploads\.github\.com\/repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID\/assets\?name=/);
  assert.match(workflow, /--upload-file "\$path"/);
  assert.doesNotMatch(workflow, /--data-binary/);
  assert.match(workflow, /--fail-with-body --retry 1/);
  assert.match(workflow, /POST reconciliation:/);
  assert.match(workflow, /releases\/\$RELEASE_ID\/assets\?name=/);
  assert.match(workflow, /remove_existing_asset/);
  assert.match(workflow, /Preconditions:/);
  assert.match(workflow, /Tag refs before transfer:/);
  assert.match(workflow, /DELETE response:/);
  assert.match(workflow, /POST response:/);
  assert.doesNotMatch(workflow, /--hostname uploads\.github\.com/);
  assert.doesNotMatch(workflow, /gh release upload/);
  assert.doesNotMatch(workflow, /git\/ref\/tags|git tag|release edit|--draft=false|git push.*--force/);
  assert.doesNotMatch(workflow, /gh release (?:edit|create)/);
});
