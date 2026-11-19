#!/usr/bin/env node
// Flujo de releases. La versión vive en cuatro sitios y el CHANGELOG; este script los mueve juntos.
//
//   node scripts/release.mjs <patch|minor|major|x.y.z> [--dry]
//       Crea la rama release/vX, sube la versión, pasa [Unreleased] a [X] en el CHANGELOG y hace commit.
//       Después: sube la rama, abre el PR y fusiónalo.
//   node scripts/release.mjs etiquetar [--dry]
//       Desde main actualizada: verifica, crea el tag vX y lo sube. El tag dispara .github/workflows/release.yml,
//       que publica el GitHub Release con las notas del CHANGELOG.
//   node scripts/release.mjs notas <x.y.z>     imprime las notas de esa versión (las usa el workflow)
//   node scripts/release.mjs version           imprime la versión actual
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aplicarVersion, promover, seccion, siguiente, SITIOS, verificar, versionActual } from "./lib/versiones.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const fallar = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [sub, extra] = args.filter((a) => a !== "--dry");
if (!sub) fallar("Uso: release.mjs <patch|minor|major|x.y.z> [--dry] | etiquetar [--dry] | notas <x.y.z> | version");

if (sub === "version") {
  console.log(versionActual(raiz));
} else if (sub === "notas") {
  if (!extra) fallar("Falta la versión: release.mjs notas x.y.z");
  const notas = seccion(readFileSync(join(raiz, "CHANGELOG.md"), "utf8"), extra);
  if (!notas) fallar(`CHANGELOG.md no tiene una sección [${extra}] con contenido.`);
  console.log(notas);
} else if (sub === "etiquetar") {
  etiquetar();
} else {
  subirVersion(sub);
}

function limpio() {
  if (git("status", "--porcelain")) fallar("Hay cambios sin commitear. Haz commit o descártalos antes.");
}

function subirVersion(tipo) {
  const actual = versionActual(raiz);
  let nueva;
  try { nueva = siguiente(actual, tipo); } catch (e) { fallar(e.message); }
  const fecha = new Date().toISOString().slice(0, 10);
  const ruta = join(raiz, "CHANGELOG.md");
  let changelog;
  try { changelog = promover(readFileSync(ruta, "utf8"), nueva, fecha); } catch (e) { fallar(e.message); }

  console.log(`Versión ${actual} → ${nueva} (${fecha})`);
  console.log(`Notas:\n${seccion(changelog, nueva)}\n`);
  if (dry) return console.log("(--dry: no se cambió nada)");

  limpio();
  const rama = `release/v${nueva}`;
  git("switch", "-c", rama);
  aplicarVersion(raiz, nueva);
  writeFileSync(ruta, changelog, "utf8");
  const errores = verificar(raiz);
  if (errores.length) fallar(`Quedó incoherente:\n${errores.join("\n")}`);
  git("add", "CHANGELOG.md", ...SITIOS);
  git("commit", "-m", `chore(release): v${nueva}`);
  console.log(`✔ Commit en la rama ${rama}. Siguiente:\n  git push -u origin ${rama}\n  (abre el PR, espera CI completo en verde y fusiona con squash)\n  git switch main && git pull\n  npm run etiquetar`);
}

function etiquetar() {
  if (git("branch", "--show-current") !== "main") fallar("Etiqueta desde la rama main.");
  limpio();
  git("fetch", "origin", "main", "--tags");
  if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) fallar("main local no coincide con origin/main. Haz git pull.");
  const errores = verificar(raiz);
  if (errores.length) fallar(`El repo no está coherente:\n${errores.join("\n")}`);
  const tag = `v${versionActual(raiz)}`;
  if (git("tag", "--list", tag)) fallar(`El tag ${tag} ya existe.`);
  console.log(`Tag ${tag} sobre ${git("rev-parse", "--short", "HEAD")}`);
  if (dry) return console.log("(--dry: no se creó ni se subió nada)");
  git("tag", "-a", tag, "-m", tag);
  git("push", "origin", tag);
  console.log(`✔ ${tag} subido. El workflow "release" publicará el GitHub Release.`);
}
