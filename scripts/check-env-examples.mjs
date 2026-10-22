// Copyright (c) 2026 Sub Rosa contributors
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const TEMPLATES = [
  ['.env.example', new URL('../.env.example', import.meta.url)],
  ['apps/web/.env.example', new URL('../apps/web/.env.example', import.meta.url)],
];

// Public IDs, URLs and network passphrases are valid template values. Credential
// fields must stay empty or contain an unmistakable placeholder.
const SECRET_KEY = /(?:^|_)(?:SECRET|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_TOKEN|AUTH_TOKEN|REFRESH_TOKEN|CREDENTIAL|MNEMONIC|SEED)(?:_|$)/i;
const PLACEHOLDER = /^(?:<[^<>]+>|\$\{[A-Z][A-Z0-9_]*\}|(?:YOUR|EXAMPLE|PLACEHOLDER)[_-][A-Z0-9_-]+|REPLACE_ME|CHANGE_ME|CHANGEME|\.\.\.|…|S…|G…)$/i;
const SECRET_VALUE = /(?:^|[^A-Za-z0-9_])(?:S[A-Z2-7]{55}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)(?:$|[^A-Za-z0-9_])/;

export function checkTemplate(source, file) {
  const seen = new Map();
  const errors = [];

  for (const [index, line] of source.split(/\r?\n/).entries()) {
    // Never source or expand template text. Commented examples are documentation.
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const lineNumber = index + 1;
    if (seen.has(key)) {
      errors.push(`${file}:${lineNumber}: duplicate ${key} (first at line ${seen.get(key)})`);
    } else {
      seen.set(key, lineNumber);
    }

    let value = rawValue.trim();
    const quoted = value.match(/^(['"])(.*)\1(?:\s+#.*)?$/);
    if (quoted) {
      value = quoted[2];
    } else {
      value = value.replace(/(?:^|\s+)#.*$/, '').trim();
    }

    if (value && !PLACEHOLDER.test(value) && (SECRET_KEY.test(key) || SECRET_VALUE.test(value))) {
      errors.push(`${file}:${lineNumber}: unsafe secret-shaped value for ${key}`);
    }
  }

  return errors;
}

export function checkTemplates(templates = TEMPLATES) {
  const errors = [];
  for (const [file, url] of templates) {
    try {
      errors.push(...checkTemplate(readFileSync(url, 'utf8'), file));
    } catch {
      errors.push(`${file}: unable to read required environment template`);
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkTemplates();
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
  else console.log('Environment templates are valid.');
}
