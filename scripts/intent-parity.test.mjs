// Runs the shared intent cases against the generated browser patterns (app/00-intent-patterns.js).
// The Python side runs the same cases in backend/tests/test_intent_parity.py.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'shared/intent-cases.json'), 'utf8'));
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'app/00-intent-patterns.js'), 'utf8'), sandbox);
const patterns = sandbox.window.NZ_INTENT.inventory;

for (const { q, inventory } of cases) {
  test(`inventory intent: ${q}`, () => {
    assert.equal(patterns.some(pattern => pattern.test(q)), inventory);
  });
}
