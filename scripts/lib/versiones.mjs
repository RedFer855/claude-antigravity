// Versiones y changelog del repositorio. Sin dependencias; lo usan scripts/verificar.mjs,
// scripts/release.mjs y el CI. Las funciones reciben la raíz del repo para poder probarlas en carpetas temporales.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Archivos que declaran la versión del plugin. El marketplace la trae dos veces
// (metadata y entrada del plugin); las tres fuentes deben coincidir.
export const SITIOS = [
  ".claude-plugin/marketplace.json",
  "agy-bridge/.claude-plugin/plugin.json",
  "agy-bridge/package.json",
];

const RE_VERSION = /("version"\s*:\s*")([^"]*)(")/g;
const sinBom = (t) => t.replace(/^﻿/, "");

export function leerVersiones(raiz) {
  const out = [];
  for (const archivo of SITIOS) {
    const ruta = join(raiz, archivo);
    if (!existsSync(ruta)) { out.push({ archivo, version: null }); continue; }
    const coincidencias = [...readFileSync(ruta, "utf8").matchAll(RE_VERSION)];
    if (!coincidencias.length) out.push({ archivo, version: null });
    for (const m of coincidencias) out.push({ archivo, version: m[2] });
  }
  return out;
}

export function versionActual(raiz) {
  const v = leerVersiones(raiz)[0]?.version;
  if (!v) throw new Error("No se encontró la versión en los archivos del plugin.");
  return v;
}

// tipo: "patch" | "minor" | "major" | "x.y.z". Devuelve la versión nueva.
export function siguiente(actual, tipo) {
  if (SEMVER.test(tipo)) return tipo;
  const m = SEMVER.exec(actual);
  if (!m) throw new Error(`La versión actual "${actual}" no es x.y.z.`);
  const [ma, mi, pa] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (tipo === "major") return `${ma + 1}.0.0`;
  if (tipo === "minor") return `${ma}.${mi + 1}.0`;
  if (tipo === "patch") return `${ma}.${mi}.${pa + 1}`;
  throw new Error(`Tipo de versión inválido: "${tipo}". Usa patch, minor, major o x.y.z.`);
}

// Reemplaza solo el número, sin reformatear el archivo (conserva BOM, sangría y saltos de línea).
export function aplicarVersion(raiz, nueva) {
  for (const archivo of SITIOS) {
    const ruta = join(raiz, archivo);
    const texto = readFileSync(ruta, "utf8");
    writeFileSync(ruta, texto.replace(RE_VERSION, `$1${nueva}$3`), "utf8");
  }
}

// ---- CHANGELOG (formato Keep a Changelog: "## [Unreleased]", "## [x.y.z] - AAAA-MM-DD") ----

export function seccion(texto, version) {
  const lineas = texto.split(/\r?\n/);
  const ini = lineas.findIndex((l) => l.startsWith(`## [${version}]`));
  if (ini < 0) return null;
  let fin = lineas.findIndex((l, i) => i > ini && l.startsWith("## ["));
  if (fin < 0) fin = lineas.length;
  return lineas.slice(ini + 1, fin).join("\n").trim();
}

// Lo que estaba en [Unreleased] pasa a ser la sección de `version`; [Unreleased] queda vacía.
export function promover(texto, version, fecha) {
  if (!seccion(texto, "Unreleased")) throw new Error("La sección [Unreleased] del CHANGELOG está vacía: no hay nada que publicar.");
  if (seccion(texto, version) !== null) throw new Error(`El CHANGELOG ya tiene la sección [${version}].`);
  const eol = texto.includes("\r\n") ? "\r\n" : "\n";
  return texto.replace(/^## \[Unreleased\]/m, `## [Unreleased]${eol}${eol}## [${version}] - ${fecha}`);
}

// ---- Verificación ----

function frontmatter(texto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(sinBom(texto));
  if (!m) return null;
  const campos = {};
  for (const l of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(l);
    if (k) campos[k[1]] = k[2].trim();
  }
  return campos;
}

const leerJson = (ruta) => JSON.parse(sinBom(readFileSync(ruta, "utf8")));

// Devuelve la lista de errores (vacía = todo bien). `tag` es opcional: "v0.3.0".
export function verificar(raiz, { tag } = {}) {
  const errores = [];

  const versiones = leerVersiones(raiz);
  for (const v of versiones.filter((x) => !x.version)) errores.push(`Falta la versión en ${v.archivo}.`);
  const distintas = [...new Set(versiones.map((v) => v.version).filter(Boolean))];
  if (distintas.length > 1) {
    errores.push(`Las versiones no coinciden: ${versiones.map((v) => `${v.archivo}=${v.version}`).join(", ")}.`);
  }
  const version = distintas[0];
  if (version && !SEMVER.test(version)) errores.push(`La versión "${version}" no es x.y.z.`);

  const changelog = join(raiz, "CHANGELOG.md");
  if (!existsSync(changelog)) errores.push("Falta CHANGELOG.md.");
  else if (version && !seccion(readFileSync(changelog, "utf8"), version)) {
    errores.push(`CHANGELOG.md no tiene una sección [${version}] con contenido.`);
  }

  if (tag && version && tag !== `v${version}`) errores.push(`El tag "${tag}" no corresponde a la versión ${version} (se esperaba v${version}).`);

  // Manifiestos: el marketplace apunta a un plugin que existe y se llama igual.
  try {
    const mp = leerJson(join(raiz, ".claude-plugin/marketplace.json"));
    for (const p of mp.plugins ?? []) {
      const dir = join(raiz, p.source ?? "");
      const manifiesto = join(dir, ".claude-plugin/plugin.json");
      if (!existsSync(manifiesto)) { errores.push(`El plugin "${p.name}" apunta a "${p.source}", que no tiene .claude-plugin/plugin.json.`); continue; }
      if (leerJson(manifiesto).name !== p.name) errores.push(`El nombre del plugin en marketplace.json ("${p.name}") no coincide con plugin.json.`);
    }
  } catch (e) {
    errores.push(`No se pudo leer el marketplace: ${e.message}`);
  }

  // Comandos y skills con frontmatter válido.
  const plugin = join(raiz, "agy-bridge");
  const comandos = join(plugin, "commands");
  if (existsSync(comandos)) {
    for (const f of readdirSync(comandos).filter((n) => n.endsWith(".md"))) {
      const fm = frontmatter(readFileSync(join(comandos, f), "utf8"));
      if (!fm?.description) errores.push(`commands/${f}: falta "description" en el frontmatter.`);
    }
  }
  const skills = join(plugin, "skills");
  if (existsSync(skills)) {
    for (const d of readdirSync(skills, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const archivo = join(skills, d.name, "SKILL.md");
      if (!existsSync(archivo)) { errores.push(`skills/${d.name}: falta SKILL.md.`); continue; }
      const fm = frontmatter(readFileSync(archivo, "utf8"));
      if (!fm?.name) errores.push(`skills/${d.name}/SKILL.md: falta "name" en el frontmatter.`);
      else if (fm.name !== d.name) errores.push(`skills/${d.name}/SKILL.md: "name" (${fm.name}) no coincide con la carpeta.`);
      if (!fm?.description) errores.push(`skills/${d.name}/SKILL.md: falta "description" en el frontmatter.`);
    }
  }

  return errores;
}
