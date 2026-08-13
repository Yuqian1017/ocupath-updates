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
  assert.match(workflow, /1318746948/);
  assert.match(workflow, /c18c0d29158f8c24ea8e7861dba52100581dde5e10af3600a8d5127452364009/);
  assert.match(workflow, /1354650736/);
  assert.match(workflow, /3db8fcd6deabbc55e2b37c6e086234bf448d536392703e5700e83ca4803091ac/);
  assert.match(workflow, /remote_length/);
  assert.match(workflow, /sha256sum --check --strict/);
  assert.match(workflow, /\.draft/);
  assert.match(workflow, /\.body == null/);
  assert.match(workflow, /\.permissions\.push/);
  assert.match(workflow, /cleanup_starters/);
  assert.match(workflow, /tag_after.*tag_before/s);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /--clobber/);
  assert.doesNotMatch(workflow, /gh release (?:edit|create)|--draft=false|--draft=false|git push.*--force|git tag/);
});
