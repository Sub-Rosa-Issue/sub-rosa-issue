// SPDX-License-Identifier: MIT
'use strict';

const { collectSecrets, scrubText, serialize } = require('./serialization.cjs');

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
        if (message !== undefined) record.message = serialize(message, secrets);
        if (context !== undefined) record.context = serialize(context, secrets);
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
