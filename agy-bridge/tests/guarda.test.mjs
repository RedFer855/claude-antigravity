// Pruebas de la guarda post-turno de rutas prohibidas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturar, esProhibida, hacerCumplir } from "../scripts/lib/guarda.mjs";

const carpeta = () => mkdtempSync(join(tmpdir(), "guarda-"));

test("esProhibida: .env en cualquier caso, plantillas no", () => {
  for (const r of [".env", ".ENV", ".env.local", ".env.production", "api/.env", ".claude/settings.local.json"]) assert.ok(esProhibida(r), r);
  for (const r of [".env.example", ".env.sample", ".env.template", ".env.dist", "src/env.js", ".claude/settings.json"]) assert.ok(!esProhibida(r), r);
});

test("hacerCumplir: restaura un .env cambiado y borrado, elimina el que apareció", () => {
  const cwd = carpeta();
  mkdirSync(join(cwd, "api"));
  writeFileSync(join(cwd, ".env"), "SECRETO=1\n");
  writeFileSync(join(cwd, "api", ".env.local"), "OTRO=2\n");
  writeFileSync(join(cwd, ".env.example"), "SECRETO=\n");
  const antes = capturar(cwd);
  assert.equal(antes.size, 2);

  writeFileSync(join(cwd, ".env"), "SECRETO=robado\n");
  unlinkSync(join(cwd, "api", ".env.local"));
  writeFileSync(join(cwd, ".env.production"), "NUEVO=3\n");
  writeFileSync(join(cwd, ".env.example"), "SECRETO=\nOTRA=\n");

  const r = hacerCumplir(cwd, antes);
  assert.deepEqual(r.map((x) => `${x.archivo}:${x.accion}`).sort(), [".env.production:eliminado", ".env:restaurado", "api/.env.local:restaurado"]);
  assert.equal(readFileSync(join(cwd, ".env"), "utf8"), "SECRETO=1\n");
  assert.equal(readFileSync(join(cwd, "api", ".env.local"), "utf8"), "OTRO=2\n");
  assert.ok(!existsSync(join(cwd, ".env.production")));
  assert.equal(readFileSync(join(cwd, ".env.example"), "utf8"), "SECRETO=\nOTRA=\n");
});

test("hacerCumplir: sin cambios no toca nada", () => {
  const cwd = carpeta();
  writeFileSync(join(cwd, ".env"), "A=1\n");
  assert.deepEqual(hacerCumplir(cwd, capturar(cwd)), []);
});
