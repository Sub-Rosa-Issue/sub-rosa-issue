import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const CHECKER = new URL("check-fixture-sizes.mjs", import.meta.url).pathname;
const RAIZ = new URL("..", import.meta.url).pathname;

/** Corre el checker y devuelve salida y codigo, sin tirar cuando falla. */
function correr(cwd) {
  try {
    const stdout = execFileSync("node", [CHECKER], { encoding: "utf-8", cwd });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? "" };
  }
}

/**
 * Un proyecto de mentira con los tres grupos que declara GROUPS.
 *
 * `omitir` no crea ese directorio; `vaciar` lo crea sin archivos que matcheen.
 * Son los dos casos que antes salian por SKIP con exit 0.
 */
function proyecto({ omitir = null, vaciar = null } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "fixture-check-"));
  const grupos = [
    ["services/receipt-cli/src/fixtures", "a.json", "{}"],
    ["contracts/round/test_snapshots/test", "b.json", "{}"],
    ["apps/web/src/demo", "c.ts", "export const x = 1;\n"],
  ];
  for (const [dir, archivo, contenido] of grupos) {
    if (dir === omitir) continue;
    mkdirSync(join(raiz, dir), { recursive: true });
    if (dir === vaciar) continue;
    writeFileSync(join(raiz, dir, archivo), contenido);
  }
  return raiz;
}

describe("check-fixture-sizes", () => {
  it("exits 0 when all fixture sizes are within budget", () => {
    const { code, stdout } = correr(RAIZ);
    assert.equal(code, 0);
    assert.match(stdout, /All fixture size budgets are within limits/);
  });

  it("reports all three fixture groups", () => {
    const { stdout } = correr(RAIZ);
    assert.match(stdout, /Receipt fixtures/);
    assert.match(stdout, /Contract test snapshots/);
    assert.match(stdout, /Demo trace outputs/);
  });

  it("passes on a temporary project where every required group is present", () => {
    const raiz = proyecto();
    try {
      const { code } = correr(raiz);
      assert.equal(code, 0, "un proyecto con los tres grupos completos tiene que pasar");
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it("fails when a required group directory is missing", () => {
    const raiz = proyecto({ omitir: "services/receipt-cli/src/fixtures" });
    try {
      const { code, stdout } = correr(raiz);
      // Este es el agujero: antes salia [SKIP] y terminaba en 0, asi que
      // borrar un grupo entero desactivaba su presupuesto sin que nadie viera.
      assert.notEqual(code, 0, "un grupo ausente tiene que dar exit distinto de 0");
      assert.match(stdout, /required fixture directory is missing/);
      assert.match(stdout, /Receipt fixtures/);
      assert.doesNotMatch(stdout, /\[SKIP\]/);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it("fails when a required group directory exists but has no matching files", () => {
    const raiz = proyecto({ vaciar: "apps/web/src/demo" });
    try {
      const { code, stdout } = correr(raiz);
      assert.notEqual(code, 0, "un grupo vacio tiene que dar exit distinto de 0");
      assert.match(stdout, /has no matching files/);
      assert.match(stdout, /Demo trace outputs/);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it("tells the two failure paths apart", () => {
    // Se arreglan distinto: uno se restaura, el otro se repuebla. Un mensaje
    // unico para los dos te obliga a ir a mirar cual fue.
    const ausente = proyecto({ omitir: "contracts/round/test_snapshots/test" });
    const vacio = proyecto({ vaciar: "contracts/round/test_snapshots/test" });
    try {
      assert.match(correr(ausente).stdout, /is missing/);
      assert.match(correr(vacio).stdout, /has no matching files/);
    } finally {
      rmSync(ausente, { recursive: true, force: true });
      rmSync(vacio, { recursive: true, force: true });
    }
  });
});
