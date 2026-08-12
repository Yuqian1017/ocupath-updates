import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/attach-public-mac-09911-temp.yml', import.meta.url),
  'utf8',
);

test('temporary Mac transfer is manual, draft-only, exact-byte checked, and duplicate-safe', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /MAC_09911_COS_URL/);
  assert.match(workflow, /1319589471/);
  assert.match(workflow, /aa28c4c8b082346316fd449d1f483d0cdf8d4820529a84215ace50e8db647d7e/);
  assert.match(workflow, /isDraft.*true/);
  assert.match(workflow, /test -z/);
  assert.doesNotMatch(workflow, /release edit|--draft=false|git tag|update-ref|force/);
});
