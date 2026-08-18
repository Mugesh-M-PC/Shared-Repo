const fs = require('fs');
const path = require('path');

const CHECKPOINT_STATES = Object.freeze({
  SUBMITTING: 'SUBMITTING',
  BANK_SUBMITTED: 'BANK_SUBMITTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
});

const VALID_STATES = new Set(Object.values(CHECKPOINT_STATES));

function normalizeType(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTokenId(value) {
  return String(value || '').trim();
}

function getCheckpointKey(type, tokenId) {
  return `${normalizeType(type)}:${normalizeTokenId(tokenId)}`;
}

class CheckpointStore {
  constructor(options = {}) {
    this.filePath = path.resolve(
      options.filePath ||
      path.join(
        process.cwd(),
        'output',
        'HDB_Worker_Checkpoint.jsonl'
      )
    );
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
    this.latestByKey = new Map();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    let contents;

    try {
      contents = await fs.promises.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return this.latestByKey;
      }
      throw error;
    }

    const lines = contents.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (!line.trim()) {
        return;
      }

      try {
        const event = JSON.parse(line);
        const type = normalizeType(event.type);
        const tokenId = normalizeTokenId(event.tokenId);

        if (!type || !tokenId || !VALID_STATES.has(event.state)) {
          throw new Error('invalid checkpoint event');
        }

        this.latestByKey.set(
          getCheckpointKey(type, tokenId),
          {
            ...event,
            type,
            tokenId,
          }
        );
      } catch (error) {
        this.logger.warn(
          `Skipping invalid checkpoint line ${index + 1}: ${error.message}`
        );
      }
    });

    return this.latestByKey;
  }

  get(type, tokenId) {
    return this.latestByKey.get(
      getCheckpointKey(type, tokenId)
    ) || null;
  }

  async record({
    type,
    tokenId,
    state,
    loanNo = '',
    automationStatus = '',
    error = null,
    metadata = {},
  }) {
    const normalizedType = normalizeType(type);
    const normalizedTokenId = normalizeTokenId(tokenId);

    if (!['rv', 'ov'].includes(normalizedType)) {
      throw new Error('Checkpoint type must be RV or OV.');
    }

    if (!normalizedTokenId) {
      throw new Error('Checkpoint tokenId is required.');
    }

    if (!VALID_STATES.has(state)) {
      throw new Error(`Unsupported checkpoint state: ${state}`);
    }

    const nowValue = this.now();
    const timestamp = nowValue instanceof Date
      ? nowValue.toISOString()
      : new Date(nowValue).toISOString();
    const event = {
      timestamp,
      type: normalizedType,
      tokenId: normalizedTokenId,
      loanNo: String(loanNo || ''),
      state,
      automationStatus: String(automationStatus || ''),
      errorCategory: error?.category || '',
      errorMessage: error ? String(error.message || error) : '',
      metadata,
    };

    const operation = this.writeQueue.then(async () => {
      await fs.promises.mkdir(
        path.dirname(this.filePath),
        { recursive: true }
      );
      await fs.promises.appendFile(
        this.filePath,
        `${JSON.stringify(event)}\n`,
        'utf8'
      );
      this.latestByKey.set(
        getCheckpointKey(normalizedType, normalizedTokenId),
        event
      );

      return event;
    });

    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async flush() {
    await this.writeQueue;
  }
}

module.exports = {
  CHECKPOINT_STATES,
  CheckpointStore,
  getCheckpointKey,
};

