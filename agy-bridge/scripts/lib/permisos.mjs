// Permisos de agy: lista base + reglas por proyecto, sincronizadas en el settings.json global.
// agy no documenta dónde guarda reglas por proyecto, así que las del proyecto se aplican en el
// settings global con rutas absolutas. Las reglas que agrega el puente se anotan en
// data/reglas-aplicadas.json para poder quitarlas sin tocar las que el usuario puso a mano.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DATA_DIR, PLUGIN_ROOT } from "./paths.mjs";

export const PATHS = {
  base: join(PLUGIN_ROOT, "permisos", "base.json"),
  proyectos: join(DATA_DIR, "permisos-proyectos.json"),
  aplicadas: join(DATA_DIR, "reglas-aplicadas.json"),
  settings: join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".gemini", "antigravity-cli", "settings.json"),
};

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// Clave estable por proyecto: ruta absoluta con barras normales y sin barra final.
export function projectKey(cwd) {
  return resolve(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
}

export function projectRules(key, cfg) {
  const rules = [];
  if (cfg.escritura) rules.push(`write_file(${key}/)`);
  for (const c of cfg.comandos ?? []) rules.push(`command(${c})`);
  return rules;
}

// Prohibiciones de escritura de un proyecto con escritura. Van con ruta absoluta porque el sandbox de agy
// rechaza las rutas relativas ("deny .env: non-absolute file path") y deja de ejecutar todo comando.
// Como solo se escribe en proyectos registrados, esto protege lo mismo que la regla relativa de antes.
export function projectDenyRules(key, cfg) {
  return cfg.escritura ? [`write_file(${key}/.env)`, `write_file(${key}/.git/)`] : [];
}

// Reglas que el puente quiere ver en settings: base + todos los proyectos registrados.
export function desiredRules(base, proyectos) {
  const allow = new Set(base.allow ?? []);
  const deny = new Set(base.deny ?? []);
  for (const [key, cfg] of Object.entries(proyectos)) {
    for (const r of projectRules(key, cfg)) allow.add(r);
    for (const r of projectDenyRules(key, cfg)) deny.add(r);
  }
  return { allow: [...allow], deny: [...deny] };
}

// Mezcla pura: quita lo que el puente había aplicado antes y agrega lo deseado ahora,
// conservando las reglas propias del usuario. Devuelve el settings nuevo y lo aplicado.
export function mergeSettings(settings, desired, previous = { allow: [], deny: [] }) {
  const next = structuredClone(settings ?? {});
  next.permissions ??= {};
  for (const kind of ["allow", "deny"]) {
    const prevOwned = new Set(previous[kind] ?? []);
    const userOwn = (next.permissions[kind] ?? []).filter((r) => !prevOwned.has(r));
    next.permissions[kind] = [...new Set([...userOwn, ...desired[kind]])];
  }
  return { settings: next, applied: desired };
}

export function loadState(paths = PATHS) {
  return {
    base: readJson(paths.base, { allow: [], deny: [] }),
    proyectos: readJson(paths.proyectos, {}),
    aplicadas: readJson(paths.aplicadas, { allow: [], deny: [] }),
    settings: readJson(paths.settings, {}),
  };
}

export function sync(paths = PATHS) {
  const st = loadState(paths);
  const { settings, applied } = mergeSettings(st.settings, desiredRules(st.base, st.proyectos), st.aplicadas);
  if (existsSync(paths.settings)) copyFileSync(paths.settings, paths.settings + ".bak");
  writeJson(paths.settings, settings);
  writeJson(paths.aplicadas, applied);
  return settings.permissions;
}

export function updateProject(cwd, mutate, paths = PATHS) {
  const proyectos = readJson(paths.proyectos, {});
  const key = projectKey(cwd);
  const cfg = proyectos[key] ?? { escritura: false, comandos: [] };
  mutate(cfg);
  if (!cfg.escritura && !cfg.comandos.length) delete proyectos[key];
  else proyectos[key] = cfg;
  writeJson(paths.proyectos, proyectos);
  return sync(paths);
}

// Sugerencias a partir del registro de KPIs: comandos denegados en este proyecto, por frecuencia.
export function suggestFromLog(logPath, cwd) {
  if (!existsSync(logPath)) return [];
  const key = projectKey(cwd);
  const counts = new Map();
  for (const line of readFileSync(logPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.comando_denegado && projectKey(r.proyecto ?? "") === key) counts.set(r.comando_denegado, (counts.get(r.comando_denegado) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([comando, veces]) => ({ comando, veces }));
}
