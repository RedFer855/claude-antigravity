#!/usr/bin/env node
// Verifica que el repositorio esté coherente: una sola versión en todos los archivos, sección
// del CHANGELOG para esa versión, manifiestos válidos y frontmatter de comandos y skills.
//   node scripts/verificar.mjs [--tag v0.3.0]
// Código de salida 1 si hay errores. Lo corre el CI en cada PR y el workflow de release.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { verificar, versionActual } from "./lib/versiones.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { tag: { type: "string" } } });

const errores = verificar(raiz, { tag: values.tag });
if (errores.length) {
  for (const e of errores) console.error(`✖ ${e}`);
  process.exit(1);
}
console.log(`✔ Repositorio coherente (versión ${versionActual(raiz)}${values.tag ? `, tag ${values.tag}` : ""}).`);
