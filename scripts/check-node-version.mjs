import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const NODE_MAJOR = '22';

export function validateNodeVersions(versionFile, packageJsonText, workflows) {
  const errors = [];
  const version = versionFile.trim();
  if (version !== NODE_MAJOR) {
    errors.push(`.nvmrc must contain ${NODE_MAJOR}; found ${JSON.stringify(version)}`);
  }

  const engine = JSON.parse(packageJsonText).engines?.node;
  if (engine !== `>=${NODE_MAJOR}`) {
    errors.push(`package.json engines.node must be >=${NODE_MAJOR}; found ${JSON.stringify(engine)}`);
  }

  if (Object.keys(workflows).length === 0) {
    errors.push('No GitHub Actions workflows found');
  }
  for (const [name, content] of Object.entries(workflows)) {
    const lines = content.split(/\r?\n/);
    let setupCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const step = lines[i].match(/^(\s*)-\s+uses:\s*actions\/setup-node@v\d+\s*$/);
      if (!step) continue;
      setupCount++;
      let versionInStep;
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() && line.match(/^\s*/)[0].length <= step[1].length) break;
        const match = line.trim().match(/^node-version:\s*(.*)$/);
        if (match) {
          versionInStep = match[1].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
          break;
        }
      }
      if (versionInStep !== NODE_MAJOR) {
        errors.push(`${name}: actions/setup-node must use node-version: ${NODE_MAJOR}; found ${JSON.stringify(versionInStep)}`);
      }
    }
    if (setupCount === 0) {
      errors.push(`${name}: missing actions/setup-node`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workflowsDir = join(root, '.github/workflows');
  const workflows = Object.fromEntries(
    readdirSync(workflowsDir)
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]),
  );
  const errors = validateNodeVersions(
    readFileSync(join(root, '.nvmrc'), 'utf8'),
    readFileSync(join(root, 'package.json'), 'utf8'),
    workflows,
  );
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Node 22 matches .nvmrc, engines.node, and every workflow\n');
  }
}
