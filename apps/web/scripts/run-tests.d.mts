// Copyright (c) 2026 Sub Rosa contributors
import type { spawnSync } from "node:child_process";

export const DEFAULT_WEB_ROOT: string;

export function discoverWebTestFiles(rootDir?: string): string[];

export function partitionWebTestFiles(
  files: string[],
  rootDir?: string,
): {
  standardTests: string[];
  moduleMockTests: string[];
};

export function runWebTests(
  rootDir?: string,
  options?: { spawn?: typeof spawnSync },
): {
  status: number;
  files: string[];
  standardTests: string[];
  moduleMockTests: string[];
};
