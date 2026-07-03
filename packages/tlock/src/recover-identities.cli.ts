import process from "node:process";

import { runAuditorRecoveryCli, usage } from "./auditor-recovery-cli.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

const stdin = process.stdin.isTTY ? "" : await new Promise<string>((resolve, reject) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    data += chunk;
  });
  process.stdin.on("end", () => resolve(data));
  process.stdin.on("error", reject);
});

const result = runAuditorRecoveryCli(args, stdin);
process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
process.exit(result.exitCode);
