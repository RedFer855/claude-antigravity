// Pruebas de v0.3: atribución de cambios, deshacer seguro, guarda con respaldo,
// permisos temporales y recorte de la respuesta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { atribuir, canonica, relativaA } from "../scripts/lib/atribucion.mjs";
import { diffSummary, raizRepo, snapshot, undo } from "../scripts/lib/git.mjs";
import { capturar, hacerCumplir } from "../scripts/lib/guarda.mjs";
import { agregarTemporales, limpiarHuerfanos, quitarTemporales } from "../scripts/lib/permisos.mjs";
import { resumenCambios, truncate } from "../scripts/agy-run.mjs";

const carpeta = (p) => mkdtempSync(join(tmpdir(), p));
const leer = (ruta) => readFileSync(ruta, "utf8");

function repo(archivos = { "a.txt": "uno\n", "c.txt": "tres\n" }) {
  const dir = carpeta("agy-m-");
  const g = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir });
  g("init", "-q");
  for (const [n, t] of Object.entries(archivos)) writeFileSync(join(dir, n), t);
  g("add", "-A");
  g("commit", "-qm", "base");
  return dir;
}

// ---- atribución ----

test("relativaA: absoluta, relativa y file://; lo de fuera da null", () => {
  const raiz = resolve(tmpdir(), "proy");
  assert.equal(relativaA(raiz, join(raiz, "src", "a.js")), "src/a.js");
  assert.equal(relativaA(raiz, "src/a.js"), "src/a.js");
  assert.equal(relativaA(raiz, resolve(raiz, "..", "otro", "x.js")), null);
  assert.equal(relativaA(raiz, raiz), null);
  assert.equal(relativaA(raiz, ""), null);
  const url = new URL(`file:///${join(raiz, "b.txt").replace(/\\/g, "/").replace(/^\//, "")}`).href;
  assert.equal(relativaA(raiz, url), "b.txt");
});

test("relativaA: una carpeta y su alias (enlace simbólico o junction) son la misma raíz", () => {
  // Reproduce lo de macOS (/var → /private/var) y los nombres cortos de Windows: git da la ruta canónica
  // y agy o --cwd usan otra forma de la misma carpeta.
  const real = carpeta("agy-real-");
  const alias = join(carpeta("agy-alias-"), "enlace");
  symlinkSync(real, alias, process.platform === "win32" ? "junction" : "dir");
  writeFileSync(join(real, "a.js"), "x");
  assert.equal(relativaA(alias, join(real, "a.js")), "a.js"); // raíz por el alias, archivo por la ruta real
  assert.equal(relativaA(real, join(alias, "a.js")), "a.js"); // y al revés
  assert.equal(relativaA(realpathSync.native(real), join(alias, "no-existe", "b.js")), "no-existe/b.js"); // archivo que ya no existe
  assert.equal(canonica(join(alias, "no-existe", "b.js")), join(realpathSync.native(real), "no-existe", "b.js"));
});

test("atribuir: separa lo de agy de lo ajeno y suma líneas solo de agy", () => {
  const raiz = resolve(tmpdir(), "proy");
  const cambios = {
    archivos: [
      { estado: "M", archivo: "a.txt", mas: 3, menos: 1 },
      { estado: "A", archivo: "ajeno.txt", mas: 10, menos: 0 },
    ],
  };
  const r = atribuir(cambios, [join(raiz, "a.txt"), join(raiz, "no-cambio.txt")], raiz);
  assert.deepEqual(r.archivos.map((f) => f.archivo), ["a.txt"]);
  assert.deepEqual(r.otros.map((f) => f.archivo), ["ajeno.txt"]);
  assert.equal(r.inserciones, 3);
  assert.equal(r.borrados, 1);
});

test("resumenCambios: avisa cuando hay cambios que no son de agy", () => {
  assert.equal(resumenCambios(null), null);
  const limpio = resumenCambios({ archivos: [{ estado: "M", archivo: "a", mas: 1, menos: 0 }], otros: [], inserciones: 1, borrados: 0 });
  assert.equal(limpio.otros, undefined);
  const con = resumenCambios({ archivos: [], otros: [{ estado: "A", archivo: "x", mas: 1, menos: 0 }], inserciones: 0, borrados: 0 });
  assert.deepEqual(con.otros, [{ estado: "A", archivo: "x" }]);
  assert.match(con.nota, /no se cuentan como de agy/i);
});

// ---- git: deshacer con atribución ----

test("deshacer con archivos: revierte lo de agy y no toca el trabajo en paralelo", () => {
  const dir = repo();
  const antes = snapshot(dir, "m1-antes");
  writeFileSync(join(dir, "a.txt"), "uno\nagy\n"); // lo escribe agy
  writeFileSync(join(dir, "c.txt"), "tres\ncambio en paralelo\n"); // lo edita otra persona o Claude
  const despues = snapshot(dir, "m1-despues");
  const d = atribuir(diffSummary(dir, antes, despues), [join(dir, "a.txt")], dir);
  assert.deepEqual(d.archivos.map((f) => f.archivo), ["a.txt"]);
  assert.deepEqual(d.otros.map((f) => f.archivo), ["c.txt"]);

  const r = undo(dir, "refs/agy/m1-antes", "refs/agy/m1-despues", { archivos: new Set(["a.txt"]) });
  assert.deepEqual(r.revertidos, ["a.txt"]);
  assert.deepEqual(r.omitidos, ["c.txt"]);
  assert.equal(leer(join(dir, "a.txt")), "uno\n");
  assert.equal(leer(join(dir, "c.txt")), "tres\ncambio en paralelo\n");
});

test("deshacer: un archivo editado después de la corrida no se pisa, salvo --forzar", () => {
  const dir = repo();
  snapshot(dir, "m2-antes");
  writeFileSync(join(dir, "a.txt"), "uno\nagy\n");
  writeFileSync(join(dir, "nuevo.txt"), "de agy\n");
  snapshot(dir, "m2-despues");
  writeFileSync(join(dir, "a.txt"), "uno\nagy\nedición posterior\n"); // el usuario sigue trabajando
  // nuevo.txt queda igual que lo dejó agy

  const r = undo(dir, "refs/agy/m2-antes", "refs/agy/m2-despues");
  assert.deepEqual(r.conflictos, ["a.txt"]);
  assert.deepEqual(r.revertidos, ["nuevo.txt"]);
  assert.equal(leer(join(dir, "a.txt")), "uno\nagy\nedición posterior\n");
  assert.ok(!existsSync(join(dir, "nuevo.txt")));

  const f = undo(dir, "refs/agy/m2-antes", "refs/agy/m2-despues", { forzar: true });
  assert.deepEqual(f.revertidos.sort(), ["a.txt", "nuevo.txt"]);
  assert.equal(leer(join(dir, "a.txt")), "uno\n");
});

test("deshacer: un archivo borrado por agy y vuelto a crear después es conflicto", () => {
  const dir = repo();
  snapshot(dir, "m3-antes");
  unlinkSync(join(dir, "c.txt"));
  snapshot(dir, "m3-despues");
  writeFileSync(join(dir, "c.txt"), "otra vez\n");
  const r = undo(dir, "refs/agy/m3-antes", "refs/agy/m3-despues");
  assert.deepEqual(r.conflictos, ["c.txt"]);
  assert.equal(leer(join(dir, "c.txt")), "otra vez\n");
});

test("git: desde una subcarpeta las rutas son de la raíz del repo y los nombres con acentos salen limpios", () => {
  const dir = repo();
  mkdirSync(join(dir, "sub"));
  const antes = snapshot(join(dir, "sub"), "m4-antes");
  writeFileSync(join(dir, "ñandú.txt"), "x\n");
  writeFileSync(join(dir, "sub", "b.txt"), "y\n");
  const despues = snapshot(join(dir, "sub"), "m4-despues");
  assert.equal(canonica(raizRepo(join(dir, "sub"))), canonica(dir)); // git da la ruta canónica; tmpdir() puede ser un alias
  const d = diffSummary(raizRepo(dir), antes, despues);
  assert.deepEqual(d.archivos.map((f) => f.archivo).sort(), ["sub/b.txt", "ñandú.txt"].sort());
  assert.equal(d.inserciones, 2);
});

// ---- guarda con respaldo ----

test("guarda: antes de pisar o borrar un .env copia lo que había, para no perder una edición del usuario", () => {
  const cwd = carpeta("agy-g-");
  const respaldo = join(carpeta("agy-r-"), "d1");
  writeFileSync(join(cwd, ".env"), "SECRETO=1\n");
  const antes = capturar(cwd);

  writeFileSync(join(cwd, ".env"), "SECRETO=editado por el usuario\n");
  writeFileSync(join(cwd, ".env.production"), "NUEVO=3\n");
  const r = hacerCumplir(cwd, antes, { respaldo });

  assert.equal(leer(join(cwd, ".env")), "SECRETO=1\n");
  assert.ok(!existsSync(join(cwd, ".env.production")));
  const porArchivo = Object.fromEntries(r.map((x) => [x.archivo, x]));
  assert.equal(leer(porArchivo[".env"].respaldo), "SECRETO=editado por el usuario\n");
  assert.equal(leer(porArchivo[".env.production"].respaldo), "NUEVO=3\n");
});

test("guarda: sin cambios no crea respaldo", () => {
  const cwd = carpeta("agy-g-");
  const respaldo = join(carpeta("agy-r-"), "d2");
  writeFileSync(join(cwd, ".env"), "A=1\n");
  assert.deepEqual(hacerCumplir(cwd, capturar(cwd), { respaldo }), []);
  assert.ok(!existsSync(respaldo));
});

// ---- permisos temporales ----

function entorno(allow = ["command(mio)"]) {
  const dir = carpeta("agy-t-");
  const paths = {
    base: join(dir, "base.json"),
    proyectos: join(dir, "proyectos.json"),
    aplicadas: join(dir, "aplicadas.json"),
    temporales: join(dir, "temporales.json"),
    settings: join(dir, "settings.json"),
  };
  writeFileSync(paths.base, JSON.stringify({ allow: ["command(git status)"], deny: [] }));
  writeFileSync(paths.settings, JSON.stringify({ model: "m", permissions: { allow } }));
  return { paths, allow: () => JSON.parse(leer(paths.settings)).permissions.allow, estado: () => JSON.parse(leer(paths.temporales)) };
}

test("temporales: se agregan y se quitan, y no se toca lo que el usuario ya tenía", () => {
  const { paths, allow, estado } = entorno();
  const reglas = agregarTemporales("d1", ["npm test", "mio"], paths);
  assert.deepEqual(reglas.sort(), ["command(mio)", "command(npm test)"]);
  assert.deepEqual(allow().sort(), ["command(mio)", "command(npm test)"]);

  const quitadas = quitarTemporales("d1", paths);
  assert.deepEqual(quitadas, ["command(npm test)"]); // `mio` era del usuario: se queda
  assert.deepEqual(allow(), ["command(mio)"]);
  assert.deepEqual(estado(), { reglas: {}, procesos: {} });
  assert.equal(JSON.parse(leer(paths.settings)).model, "m"); // el resto del settings intacto
});

test("temporales: con dos delegaciones a la vez, la regla sale cuando termina la última", () => {
  const { paths, allow } = entorno([]);
  agregarTemporales("d1", ["npm test"], paths);
  agregarTemporales("d2", ["npm test"], paths);
  assert.deepEqual(quitarTemporales("d1", paths), []);
  assert.deepEqual(allow(), ["command(npm test)"]); // d2 todavía la usa
  assert.deepEqual(quitarTemporales("d2", paths), ["command(npm test)"]);
  assert.deepEqual(allow(), []);
});

test("temporales: si el comando pasó a ser regla de un proyecto, no se quita", () => {
  const { paths, allow } = entorno([]);
  agregarTemporales("d1", ["npm test"], paths);
  writeFileSync(paths.proyectos, JSON.stringify({ [resolve(tmpdir(), "p").replace(/\\/g, "/")]: { escritura: false, comandos: ["npm test"] } }));
  assert.deepEqual(quitarTemporales("d1", paths), []);
  assert.deepEqual(allow(), ["command(npm test)"]);
});

test("temporales: limpiarHuerfanos quita lo de corridas que murieron y respeta las vivas", () => {
  const { paths, allow } = entorno([]);
  agregarTemporales("muerta", ["uno"], paths, { pid: 111 });
  agregarTemporales("viva", ["dos"], paths, { pid: 222 });
  const quitadas = limpiarHuerfanos(paths, { vivo: (pid) => pid === 222 });
  assert.deepEqual(quitadas, ["command(uno)"]);
  assert.deepEqual(allow(), ["command(dos)"]);
});

test("temporales: una corrida demasiado vieja se limpia aunque su pid parezca vivo", () => {
  const { paths, allow } = entorno([]);
  agregarTemporales("vieja", ["uno"], paths, { pid: 333, ahora: new Date(Date.now() - 3 * 3600 * 1000) });
  assert.deepEqual(limpiarHuerfanos(paths, { vivo: () => true }), ["command(uno)"]);
  assert.deepEqual(allow(), []);
});

test("temporales: respalda el settings, con copia del día que no se sobrescribe", () => {
  const { paths } = entorno(["command(original)"]);
  agregarTemporales("d1", ["x"], paths);
  quitarTemporales("d1", paths);
  const hoy = new Date().toISOString().slice(0, 10);
  assert.deepEqual(JSON.parse(leer(`${paths.settings}.bak-${hoy}`)).permissions.allow, ["command(original)"]); // el primero del día
  assert.ok(existsSync(`${paths.settings}.bak`));
});

// ---- recorte de la respuesta ----

test("truncate: conserva principio y final y avisa cuánto omitió", () => {
  const largo = "A".repeat(5000) + "MEDIO" + "Z".repeat(5000) + "PENDIENTE: nada";
  const t = truncate(largo, 3000);
  assert.equal(t.truncada, true);
  assert.ok(t.texto.startsWith("A".repeat(1800)));
  assert.ok(t.texto.endsWith("PENDIENTE: nada"));
  assert.match(t.texto, /\d+ caracteres omitidos; completa en respuesta_completa/);
  assert.ok(t.texto.length < 3200);
});

test("truncate: lo corto pasa igual", () => {
  assert.deepEqual(truncate("abc", 5), { texto: "abc", truncada: false });
});
