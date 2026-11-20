import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { desiredRules, mergeSettings, projectKey, projectRules, suggestFromLog, sync, updateProject } from "../scripts/lib/permisos.mjs";

// Ruta absoluta válida en el SO donde corre la prueba (en Linux/macOS "D:\\p" sería una ruta relativa).
const absoluta = (...partes) => resolve(tmpdir(), ...partes);
const aBarras = (p) => p.replace(/\\/g, "/");

function tempPaths(settings = {}) {
  const dir = mkdtempSync(join(tmpdir(), "agy-perm-"));
  const paths = {
    base: join(dir, "base.json"),
    proyectos: join(dir, "proyectos.json"),
    aplicadas: join(dir, "aplicadas.json"),
    settings: join(dir, "settings.json"),
  };
  writeFileSync(paths.base, JSON.stringify({ allow: ["command(git status)"], deny: ["command(git push)"] }));
  writeFileSync(paths.settings, JSON.stringify(settings));
  return paths;
}
const readSettings = (p) => JSON.parse(readFileSync(p.settings, "utf8"));

test("projectKey normaliza barras y quita la final", () => {
  const ruta = absoluta("a", "b");
  assert.equal(projectKey(ruta + sep), aBarras(ruta));
  assert.equal(projectKey(ruta + sep + sep), aBarras(ruta));
  // Solo en Windows una ruta con letra de unidad y barras invertidas es absoluta.
  if (process.platform === "win32") assert.equal(projectKey("D:\\a\\b\\"), "D:/a/b");
});

test("projectRules arma escritura por carpeta y comandos", () => {
  assert.deepEqual(projectRules("D:/p", { escritura: true, comandos: ["npm test"] }), ["write_file(D:/p/)", "command(npm test)"]);
});

test("desiredRules une base y proyectos sin duplicar", () => {
  const d = desiredRules({ allow: ["command(npm test)"], deny: ["x"] }, { "D:/p": { escritura: false, comandos: ["npm test"] } });
  assert.deepEqual(d.allow, ["command(npm test)"]);
  assert.deepEqual(d.deny, ["x"]);
});

test("mergeSettings conserva reglas del usuario y otras claves", () => {
  const { settings } = mergeSettings({ model: "m", permissions: { allow: ["command(mio)"] } }, { allow: ["command(a)"], deny: ["command(b)"] });
  assert.equal(settings.model, "m");
  assert.deepEqual(settings.permissions.allow, ["command(mio)", "command(a)"]);
  assert.deepEqual(settings.permissions.deny, ["command(b)"]);
});

test("mergeSettings quita lo que el puente aplicó antes y ya no se desea", () => {
  const prev = { allow: ["command(viejo)"], deny: [] };
  const { settings } = mergeSettings({ permissions: { allow: ["command(mio)", "command(viejo)"] } }, { allow: ["command(nuevo)"], deny: [] }, prev);
  assert.deepEqual(settings.permissions.allow, ["command(mio)", "command(nuevo)"]);
});

test("sync + updateProject: agregar y quitar un proyecto deja el settings limpio", () => {
  const p = tempPaths({ permissions: { allow: ["command(mio)"] } });
  sync(p);
  assert.deepEqual(readSettings(p).permissions.allow, ["command(mio)", "command(git status)"]);

  const proj = absoluta("proj");
  updateProject(proj, (c) => { c.escritura = true; c.comandos.push("npm test"); }, p);
  assert.ok(readSettings(p).permissions.allow.includes(`write_file(${aBarras(proj)}/)`));
  assert.ok(readSettings(p).permissions.allow.includes("command(npm test)"));

  updateProject(proj, (c) => { c.escritura = false; c.comandos = []; }, p);
  assert.deepEqual(readSettings(p).permissions.allow, ["command(mio)", "command(git status)"]);
  assert.deepEqual(JSON.parse(readFileSync(p.proyectos, "utf8")), {});
  // Hace respaldo antes de escribir.
  assert.ok(readFileSync(p.settings + ".bak", "utf8"));
});

test("suggestFromLog cuenta comandos denegados solo del proyecto", () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-log-"));
  const log = join(dir, "t.jsonl");
  const rec = (proyecto, comando_denegado) => JSON.stringify({ proyecto, comando_denegado });
  const p = absoluta("p");
  // El mismo proyecto escrito con barras del SO y con barras normales cuenta como uno solo.
  writeFileSync(log, [rec(p, "npm test"), rec(aBarras(p), "npm test"), rec(aBarras(p), "pytest"), rec(absoluta("otro"), "make"), "basura", rec(aBarras(p), null)].join("\n"));
  assert.deepEqual(suggestFromLog(log, p), [{ comando: "npm test", veces: 2 }, { comando: "pytest", veces: 1 }]);
});
