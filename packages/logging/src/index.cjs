// SPDX-License-Identifier: MIT
'strict';

const { collectSecrets, scrubText, serialize } = require('./serialization.cjs');
const {
  DEFAULT_MAX_LENGTH,
  DEFAULT_TRUNCATED_SUFFIX,
  resolveOptions,
  truncateStrings,
  truncateError,
} = require('./truncate.cjs');

/** The only diagnostic transport boundary. Browser builds use their console sink. */
function defaultSink(line, level) {
  if (typeof process !== 'undefined' && process.stdout?.write && process.stderr?.write) {
    const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
    stream.write(line + '\n');
  } else {
    const method = level === 'warn' || level === 'error' ? level : 'info';
    globalThis.console?.[method]?.(line);
  }
}

function createLogger(component, options = {}) {
  const sink = options.sink ?? defaultSink;
  // Scripts running in plain Node need no TypeScript loader. Callers can inject their shared clock.
  const clock = options.clock ?? (() => new Date().toISOString());
  // Every serialized field shares one limit so a single oversized upstream
  // error cannot inflate the record. Invalid limits fail here, not mid-log.
  const limits = resolveOptions({
    maxLength: options.maxFieldLength ?? DEFAULT_MAX_LENGTH,
    truncatedSuffix: options.truncatedSuffix ?? DEFAULT_TRUNCATED_SUFFIX,
  });
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (event, message, context) => {
      try {
        const secrets = new Set();
        collectSecrets(message, secrets);
        collectSecrets(context, secrets);
        const record = {
          timestamp: clock(), level, component: scrubText(component, secrets), event: scrubText(event, secrets),
        };
        if (message !== undefined) record.message = serialize(message, secrets, new WeakSet(), 0, limits);
        if (context !== undefined) record.context = serialize(context, secrets, new WeakSet(), 0, limits);
        sink(JSON.stringify(record), level);
      } catch { /* Logging must not change command success or failure behavior. */ }
    };
  }
  return Object.freeze(logger);
}

/** Machine-readable command results are data, not diagnostic records. */
function writeData(text) {
  process.stdout.write(text + '\n');
}

exports.createLogger = createLogger;
exports.writeData = writeData;
exports.truncateStrings = truncateStrings;
exports.truncateError = truncateError;
exports.DEFAULT_MAX_LENGTH = DEFAULT_MAX_LENGTH;
exports.DEFAULT_TRUNCATED_SUFFIX = DEFAULT_TRUNCATED_SUFFIX;
