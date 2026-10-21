// Copyright (c) 2026 Sub Rosa contributors
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const CHECKER = new URL("check-line-lengths.mjs", import.meta.url).pathname;
const REPO_ROOT = new URL("..", import.meta.url).pathname;

/** Run the checker and return output and code, without throwing on failure. */
function runChecker(cwd, extraArgs = []) {
  try {
    const stdout = execFileSync("node", [CHECKER, ...extraArgs], { encoding: "utf-8", cwd });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

/** Create a temporary project structure with config files. */
function createTempProject(files) {
  const root = mkdtempSync(join(tmpdir(), "line-length-check-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

describe("check-line-lengths", () => {
  it("exits 0 when all config files have lines within the default limit", () => {
    const { code, stdout } = runChecker(REPO_ROOT);
    assert.equal(code, 0, "should pass on the real repo");
    assert.match(stdout, /All configuration files have lines ≤ 500 characters/);
  });

  it("passes a normal config file under the threshold", () => {
    const normalConfig = `export default {
  plugins: [],
  theme: {
    extend: {}
  }
};
`;
    const root = createTempProject({
      "tailwind.config.js": normalConfig,
      "package.json": '{"name": "test", "version": "1.0.0"}',
    });
    try {
      const { code, stdout } = runChecker(root);
      assert.equal(code, 0, "normal config should pass");
      assert.match(stdout, /All configuration files have lines ≤ 500 characters/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when a config file has a line exceeding the threshold", () => {
    // Create a line with 600 characters (well over 500)
    const longLine = "x".repeat(600);
    const maliciousConfig = `export default {
  plugins: [],
  // Malicious payload hidden off-screen:
  const payload = "${longLine}";
};
`;
    const root = createTempProject({
      "vite.config.ts": maliciousConfig,
      "package.json": '{"name": "test", "version": "1.0.0"}',
    });
    try {
      const { code, stdout } = runChecker(root);
      assert.notEqual(code, 0, "should fail when line exceeds threshold");
      // CI prints paths and line numbers only
      assert.match(stdout, /vite\.config\.ts:4:6[0-9]+/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when package.json has a line exceeding the threshold", () => {
    const longLine = "x".repeat(600);
    const maliciousPackage = `{
  "name": "test",
  "version": "1.0.0",
  "description": "${longLine}"
}
`;
    const root = createTempProject({
      "package.json": maliciousPackage,
    });
    try {
      const { code, stdout } = runChecker(root);
      assert.notEqual(code, 0, "should fail when package.json line exceeds threshold");
      assert.match(stdout, /package\.json:4:6[0-9]+/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("respects custom --max-line-length threshold", () => {
    const line500 = "x".repeat(500);
    const line501 = "x".repeat(501);
    const config = `export default { plugins: [], long: "${line500}" };
`;
    const config501 = `export default { plugins: [], long: "${line501}" };
`;
    const root = createTempProject({
      "eslint.config.js": config,
      "vite.config.ts": config501,
    });
    try {
      // With default 500, the 501-char line should fail
      let { code } = runChecker(root);
      assert.notEqual(code, 0, "should fail with default 500 limit");

      // With 600, both should pass
      ({ code } = runChecker(root, ["--max-line-length", "600"]));
      assert.equal(code, 0, "should pass with 600 limit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips lockfiles and generated snapshots", () => {
    const longLine = "x".repeat(600);
    const root = createTempProject({
      "pnpm-lock.yaml": `packages:\n  "${longLine}": {}\n`,
      "package-lock.json": `{\n  "lockfileVersion": 1,\n  "packages": { "${longLine}": {} }\n}`,
      "contracts/round/test_snapshots/test/snapshot.json": `{\n  "data": "${longLine}"\n}`,
      "yarn.lock": `${longLine}\n`,
      "package.json": '{"name": "test", "version": "1.0.0"}',
    });
    try {
      const { code, stdout } = runChecker(root);
      assert.equal(code, 0, "should pass - lockfiles and snapshots should be skipped");
      assert.match(stdout, /All configuration files have lines ≤ 500 characters/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("respects allowlist for legitimate generated files", () => {
    const longLine = "x".repeat(600);
    const root = createTempProject({
      "vite.config.ts": `export default { plugins: [], long: "${longLine}" };\n`,
      "package.json": '{"name": "test", "version": "1.0.0"}',
    });
    try {
      // The allowlist in the script is empty by default for this test file,
      // so this should fail (the test file is not in the allowlist)
      const { code } = runChecker(root);
      assert.notEqual(code, 0, "should fail when not allowlisted");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans all common config file patterns", () => {
    const configs = {
      "vite.config.ts": "export default {};\n",
      "vitest.config.ts": "export default {};\n",
      "postcss.config.js": "module.exports = {};\n",
      "tailwind.config.js": "module.exports = {};\n",
      "eslint.config.js": "export default [];\n",
      "eslint.config.mjs": "export default [];\n",
      ".eslintrc.js": "module.exports = {};\n",
      ".eslintrc.json": "{}\n",
      "next.config.js": "module.exports = {};\n",
      "next.config.mjs": "export default {};\n",
      "rollup.config.js": "export default {};\n",
      "webpack.config.js": "module.exports = {};\n",
      "jest.config.js": "module.exports = {};\n",
      "tsconfig.json": "{}\n",
      "tsconfig.app.json": "{}\n",
      "package.json": '{"name": "test", "version": "1.0.0"}',
    };
    const root = createTempProject(configs);
    try {
      const { code, stdout } = runChecker(root);
      assert.equal(code, 0, "should pass for all recognized config files");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips node_modules and other excluded directories", () => {
    const longLine = "x".repeat(600);
    const root = createTempProject({
      "node_modules/some-package/vite.config.js": `export default { long: "${longLine}" };\n`,
      "dist/vite.config.js": `export default { long: "${longLine}" };\n`,
      "build/vite.config.js": `export default { long: "${longLine}" };\n`,
      "package.json": '{"name": "test", "version": "1.0.0"}',
    });
    try {
      const { code, stdout } = runChecker(root);
      assert.equal(code, 0, "should pass - excluded dirs should be skipped");
      assert.match(stdout, /All configuration files have lines ≤ 500 characters/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});