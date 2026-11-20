// Pruebas de punta a punta del runtime (agy-run.mjs) con un agy falso: sin el agy real ni gastar cuota.
// Cada prueba usa su propia carpeta de proyecto, de datos y de "home" (el settings de agy y el aviso
// de Telegram salen del home, así que nunca tocan los del usuario).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(aqui, "..", "scripts", "agy-run.mjs");
const FALSO = join(aqui, "helpers", "agy-falso.mjs");
const leer = (ruta) => readFileSync(ruta, "utf8");

function entorno({ allow = ["command(mio)"] } = {}) {
  const base = mkdtempSync(join(tmpdir(), "agy-e2e-"));
  const proyecto = join(base, "proyecto");
  const datos = join(base, "datos");
  const home = join(base, "home");
  mkdirSync(proyecto);
  mkdirSync(join(home, ".gemini", "antigravity-cli"), { recursive: true });
  const settings = join(home, ".gemini", "antigravity-cli", "settings.json");
  writeFileSync(settings, JSON.stringify({ permissions: { allow } }));

  const g = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: proyecto });
  g("init", "-q");
  writeFileSync(join(proyecto, "a.txt"), "uno\n");
  writeFileSync(join(proyecto, ".gitignore"), ".env\n");
  g("add", "-A");
  g("commit", "-qm", "base");

  const env = {
    ...process.env,
    AGY_BIN: process.execPath,
    AGY_BIN_ARGS: JSON.stringify([FALSO]),
    CLAUDE_PLUGIN_DATA: datos,
    USERPROFILE: home,
    HOME: home,
  };
  const ejecutar = (args, plan = {}) =>
    spawnSync(process.execPath, [RUNTIME, ...args], { cwd: proyecto, env: { ...env, FAKE_AGY_PLAN: JSON.stringify(plan) }, encoding: "utf8", input: "haz algo" });
  const delegar = (plan, extra = []) => {
    const r = ejecutar(["--cwd", proyecto, "--model", "falso", "--min-cuota", "0", ...extra], plan);
    return { ...r, json: JSON.parse(r.stdout) };
  };
  const deshacer = (id, extra = []) => {
    const r = ejecutar(["deshacer", "--id", id, "--cwd", proyecto, ...extra]);
    return { ...r, json: r.stdout.trim() ? JSON.parse(r.stdout) : null };
  };
  const allow_ = () => JSON.parse(leer(settings)).permissions.allow;
  return { proyecto, datos, settings, delegar, deshacer, allow: allow_, ruta: (n) => join(proyecto, n) };
}

test("runtime: atribuye a agy solo lo que escribió y avisa del resto", () => {
  const e = entorno();
  const r = e.delegar({
    escribe: [{ ruta: e.ruta("a.txt"), contenido: "uno\nagy\n" }],
    escribeSinEvento: [{ ruta: e.ruta("ajeno.txt"), contenido: "no es de agy\n" }],
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.estado, "ok");
  assert.deepEqual(r.json.cambios.archivos, [{ estado: "M", archivo: "a.txt" }]);
  assert.deepEqual(r.json.cambios.otros, [{ estado: "A", archivo: "ajeno.txt" }]);
  assert.match(r.json.cambios.nota, /no se cuentan como de agy/i);
  assert.equal(r.json.cambios.inserciones, 1);
});

test("runtime: deshacer revierte solo lo de agy; --todo incluye lo demás", () => {
  const e = entorno();
  const r = e.delegar({
    escribe: [{ ruta: e.ruta("a.txt"), contenido: "uno\nagy\n" }],
    escribeSinEvento: [{ ruta: e.ruta("ajeno.txt"), contenido: "x\n" }],
  });
  const d = e.deshacer(r.json.delegacion_id);
  assert.equal(d.status, 0, d.stderr);
  assert.deepEqual(d.json.revertidos, ["a.txt"]);
  assert.deepEqual(d.json.no_de_agy_sin_tocar, ["ajeno.txt"]);
  assert.equal(leer(e.ruta("a.txt")), "uno\n");
  assert.ok(existsSync(e.ruta("ajeno.txt")));

  const todo = e.deshacer(r.json.delegacion_id, ["--todo", "--forzar"]);
  assert.equal(todo.status, 0, todo.stderr);
  assert.ok(!existsSync(e.ruta("ajeno.txt")));
});

test("runtime: deshacer no pisa una edición posterior y --forzar sí", () => {
  const e = entorno();
  const r = e.delegar({ escribe: [{ ruta: e.ruta("a.txt"), contenido: "uno\nagy\n" }] });
  writeFileSync(e.ruta("a.txt"), "uno\nagy\nmás trabajo mío\n");
  const d = e.deshacer(r.json.delegacion_id);
  assert.deepEqual(d.json.conflictos, ["a.txt"]);
  assert.equal(leer(e.ruta("a.txt")), "uno\nagy\nmás trabajo mío\n");
  const f = e.deshacer(r.json.delegacion_id, ["--forzar"]);
  assert.deepEqual(f.json.revertidos, ["a.txt"]);
  assert.equal(leer(e.ruta("a.txt")), "uno\n");
});

test("runtime: deshacer sin registro de atribución pide --todo en vez de adivinar", () => {
  const e = entorno();
  const d = e.deshacer("d-que-no-existe");
  assert.equal(d.status, 2);
  assert.match(d.stderr, /--todo/);
});

test("runtime: la guarda restaura el .env y deja copia de lo que había", () => {
  const e = entorno();
  writeFileSync(e.ruta(".env"), "SECRETO=1\n");
  const r = e.delegar({ escribeSinEvento: [{ ruta: e.ruta(".env"), contenido: "SECRETO=otro\n" }] });
  assert.equal(leer(e.ruta(".env")), "SECRETO=1\n");
  const rev = r.json.rutas_prohibidas_revertidas;
  assert.equal(rev[0].archivo, ".env");
  assert.equal(leer(rev[0].respaldo), "SECRETO=otro\n");
});

test("runtime: --comando se permite durante la corrida y se quita al terminar", () => {
  const e = entorno();
  const durante = join(e.datos, "settings-durante.json");
  mkdirSync(e.datos, { recursive: true });
  const r = e.delegar({ registrarSettings: durante }, ["--comando", "npm test", "--comando", "mio"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.json.comandos_temporales.sort(), ["command(mio)", "command(npm test)"]);
  assert.deepEqual(JSON.parse(leer(durante)).permissions.allow.sort(), ["command(mio)", "command(npm test)"]);
  assert.deepEqual(e.allow(), ["command(mio)"]); // `mio` era del usuario; `npm test` salió solo
  assert.deepEqual(JSON.parse(leer(join(e.datos, "permisos-temporales.json"))), { reglas: {}, procesos: {} });
});

test("runtime: si la delegación falla, los comandos temporales también se quitan", () => {
  const e = entorno({ allow: [] });
  const r = e.delegar({ status: "ERROR", respuesta: "" }, ["--comando", "npm test"]);
  assert.equal(r.status, 1);
  assert.equal(r.json.estado, "error");
  assert.deepEqual(e.allow(), []);
});

test("runtime: una corrida anterior que murió deja temporales que la siguiente limpia", () => {
  const e = entorno({ allow: ["command(huerfano)"] });
  const muerto = spawnSync(process.execPath, ["-e", ""]).pid; // un proceso que ya terminó
  mkdirSync(e.datos, { recursive: true });
  writeFileSync(
    join(e.datos, "permisos-temporales.json"),
    JSON.stringify({ reglas: { "command(huerfano)": { preexistente: false, usuarios: ["dviejo"] } }, procesos: { dviejo: { pid: muerto, creado: new Date().toISOString() } } }),
  );
  const r = e.delegar({});
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(e.allow(), []);
});

test("runtime: respuesta larga se recorta conservando el final y apunta al archivo completo", () => {
  const e = entorno();
  const larga = `${"A".repeat(6000)}\nPENDIENTE: nada`;
  const r = e.delegar({ respuesta: larga });
  assert.equal(r.json.respuesta_truncada, true);
  assert.ok(r.json.respuesta.endsWith("PENDIENTE: nada"));
  assert.match(r.json.respuesta, /omitidos/);
  assert.ok(r.json.respuesta_completa.endsWith(".respuesta.md"));
  assert.equal(leer(r.json.respuesta_completa), larga);
});

test("runtime: una respuesta corta no se recorta", () => {
  const e = entorno();
  const r = e.delegar({ respuesta: "Listo." });
  assert.equal(r.json.respuesta, "Listo.");
  assert.equal(r.json.respuesta_truncada, false);
});
