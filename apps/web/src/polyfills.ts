// Copyright (c) 2026 Sub Rosa contributors
import process from "process/browser";

(globalThis as { process: typeof process }).process = process;
