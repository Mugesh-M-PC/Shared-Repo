const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CHECKPOINT_STATES,
  CheckpointStore,
} = require('../../../src/workers/hdb/checkpointStore');

test('persists and restores the latest state per token', async t => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'hdb-checkpoint-')
  );
  const filePath = path.join(directory, 'checkpoint.jsonl');

  t.after(async () => {
    await fs.promises.rm(directory, {
      recursive: true,
      force: true,
    });
  });

  const store = new CheckpointStore({
    filePath,
    now: () => new Date('2026-08-16T00:00:00.000Z'),
  });

  await store.record({
    type: 'rv',
    tokenId: 'RV-1',
    loanNo: 'LOAN-1',
    state: CHECKPOINT_STATES.SUBMITTING,
  });
  await store.record({
    type: 'rv',
    tokenId: 'RV-1',
    loanNo: 'LOAN-1',
    state: CHECKPOINT_STATES.BANK_SUBMITTED,
  });
  await store.record({
    type: 'ov',
    tokenId: 'OV-1',
    loanNo: 'LOAN-2',
    state: CHECKPOINT_STATES.FAILED,
  });
  await store.flush();

  const restored = new CheckpointStore({
    filePath,
  });
  await restored.load();

  assert.equal(
    restored.get('rv', 'RV-1').state,
    CHECKPOINT_STATES.BANK_SUBMITTED
  );
  assert.equal(
    restored.get('ov', 'OV-1').state,
    CHECKPOINT_STATES.FAILED
  );
});

test('ignores a partial invalid journal line', async t => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'hdb-checkpoint-invalid-')
  );
  const filePath = path.join(directory, 'checkpoint.jsonl');
  const warnings = [];

  t.after(async () => {
    await fs.promises.rm(directory, {
      recursive: true,
      force: true,
    });
  });

  await fs.promises.writeFile(
    filePath,
    [
      JSON.stringify({
        timestamp: '2026-08-16T00:00:00.000Z',
        type: 'rv',
        tokenId: 'RV-1',
        state: CHECKPOINT_STATES.COMPLETED,
      }),
      '{"partial":',
    ].join('\n'),
    'utf8'
  );

  const store = new CheckpointStore({
    filePath,
    logger: {
      warn: message => warnings.push(message),
    },
  });
  await store.load();

  assert.equal(
    store.get('rv', 'RV-1').state,
    CHECKPOINT_STATES.COMPLETED
  );
  assert.equal(warnings.length, 1);
});

