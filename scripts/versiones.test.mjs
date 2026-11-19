import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { aplicarVersion, leerVersiones, promover, seccion, siguiente, verificar } from "./lib/versiones.mjs";

const BOM = "﻿";

// Repo mínimo y válido en una carpeta temporal.
function repo(version = "0.2.4", extra = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "agy-repo-"));
  const w = (rel, texto) => { mkdirSync(join(raiz, rel, ".."), { recursive: true }); writeFileSync(join(raiz, rel), texto); };
  w(".claude-plugin/marketplace.json", `${BOM}{\n  "name": "m",\n  "metadata": {\n    "version": "${version}"\n  },\n  "plugins": [\n    {\n      "name": "agy",\n      "version": "${version}",\n      "source": "./agy-bridge"\n    }\n  ]\n}\n`);
  w("agy-bridge/.claude-plugin/plugin.json", `${BOM}{\n  "name": "agy",\n  "version": "${version}"\n}\n`);
  w("agy-bridge/package.json", `${BOM}{\n  "name": "agy-bridge",\n  "version": "${version}"\n}\n`);
  w("CHANGELOG.md", `# Changelog\n\n## [Unreleased]\n\n## [${version}] - 2026-01-01\n\n- Primera versión.\n`);
  w("agy-bridge/commands/cuota.md", "---\ndescription: Ver la cuota\n---\ncuerpo\n");
  w("agy-bridge/skills/delegacion/SKILL.md", "---\nname: delegacion\ndescription: Delegar\n---\ncuerpo\n");
  for (const [rel, texto] of Object.entries(extra)) w(rel, texto);
  return raiz;
}
const limpiar = (raiz) => rmSync(raiz, { recursive: true, force: true });

test("leerVersiones: cuenta las dos del marketplace, plugin.json y package.json", () => {
  const r = repo();
  assert.deepEqual(leerVersiones(r).map((v) => v.version), ["0.2.4", "0.2.4", "0.2.4", "0.2.4"]);
  limpiar(r);
});

test("siguiente: patch, minor, major y versión explícita", () => {
  assert.equal(siguiente("0.2.4", "patch"), "0.2.5");
  assert.equal(siguiente("0.2.4", "minor"), "0.3.0");
  assert.equal(siguiente("0.2.4", "major"), "1.0.0");
  assert.equal(siguiente("0.2.4", "1.4.0"), "1.4.0");
  assert.throws(() => siguiente("0.2.4", "grande"), /inválido/);
  assert.throws(() => siguiente("0.2", "patch"), /no es x\.y\.z/);
});

test("aplicarVersion: cambia las cuatro y conserva BOM y formato", () => {
  const r = repo();
  const antes = readFileSync(join(r, "agy-bridge/.claude-plugin/plugin.json"), "utf8");
  aplicarVersion(r, "0.3.0");
  const despues = readFileSync(join(r, "agy-bridge/.claude-plugin/plugin.json"), "utf8");
  assert.ok(despues.startsWith(BOM));
  assert.equal(despues, antes.replace("0.2.4", "0.3.0"));
  assert.deepEqual([...new Set(leerVersiones(r).map((v) => v.version))], ["0.3.0"]);
  limpiar(r);
});

test("seccion y promover: [Unreleased] pasa a la versión nueva", () => {
  const texto = "# Changelog\n\n## [Unreleased]\n\n### Added\n- CI\n\n## [0.2.4] - 2026-01-01\n\n- Primera.\n";
  assert.equal(seccion(texto, "Unreleased"), "### Added\n- CI");
  assert.equal(seccion(texto, "0.2.4"), "- Primera.");
  assert.equal(seccion(texto, "9.9.9"), null);
  const nuevo = promover(texto, "0.3.0", "2026-02-02");
  assert.equal(seccion(nuevo, "Unreleased"), "");
  assert.equal(seccion(nuevo, "0.3.0"), "### Added\n- CI");
  assert.match(nuevo, /## \[Unreleased\]\n\n## \[0\.3\.0\] - 2026-02-02/);
});

test("promover: falla si [Unreleased] está vacío o la versión ya existe", () => {
  assert.throws(() => promover("## [Unreleased]\n\n## [0.2.4] - x\n\n- a\n", "0.3.0", "2026-02-02"), /vacía/);
  assert.throws(() => promover("## [Unreleased]\n\n- algo\n\n## [0.2.4] - x\n\n- a\n", "0.2.4", "2026-02-02"), /ya tiene/);
});

test("verificar: un repo coherente no da errores", () => {
  const r = repo();
  assert.deepEqual(verificar(r), []);
  assert.deepEqual(verificar(r, { tag: "v0.2.4" }), []);
  limpiar(r);
});

test("verificar: detecta versiones distintas", () => {
  const r = repo();
  const p = join(r, "agy-bridge/package.json");
  writeFileSync(p, readFileSync(p, "utf8").replace("0.2.4", "0.2.5"));
  assert.match(verificar(r).join("\n"), /no coinciden/);
  limpiar(r);
});

test("verificar: detecta tag que no corresponde y CHANGELOG sin sección", () => {
  const r = repo();
  assert.match(verificar(r, { tag: "v0.3.0" }).join("\n"), /no corresponde/);
  writeFileSync(join(r, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n");
  assert.match(verificar(r).join("\n"), /sección \[0\.2\.4\]/);
  limpiar(r);
});

test("verificar: detecta frontmatter incompleto y fuente del plugin inexistente", () => {
  const r = repo("0.2.4", {
    "agy-bridge/commands/sin-descripcion.md": "---\nargument-hint: x\n---\ncuerpo\n",
    "agy-bridge/skills/otra/SKILL.md": "---\nname: distinto\ndescription: x\n---\n",
  });
  const e = verificar(r).join("\n");
  assert.match(e, /commands\/sin-descripcion\.md: falta "description"/);
  assert.match(e, /skills\/otra\/SKILL\.md: "name" \(distinto\) no coincide/);
  rmSync(join(r, "agy-bridge/.claude-plugin"), { recursive: true });
  assert.match(verificar(r).join("\n"), /no tiene \.claude-plugin\/plugin\.json/);
  limpiar(r);
});
