// Permisos de agy: lista base + reglas por proyecto, sincronizadas en el settings.json global.
// agy no documenta dónde guarda reglas por proyecto, así que las del proyecto se aplican en el
// settings global con rutas absolutas. Las reglas que agrega el puente se anotan en
// data/reglas-aplicadas.json para poder quitarlas sin tocar las que el usuario puso a mano.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DATA_DIR, PLUGIN_ROOT } from "./paths.mjs";

export const PATHS = {
  base: join(PLUGIN_ROOT, "permisos", "base.json"),
  proyectos: join(DATA_DIR, "permisos-proyectos.json"),
  aplicadas: join(DATA_DIR, "reglas-aplicadas.json"),
  temporales: join(DATA_DIR, "permisos-temporales.json"),
  settings: join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".gemini", "antigravity-cli", "settings.json"),
};

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

// Escritura atómica: se escribe un archivo temporal y se renombra, para que un corte a la mitad no deje
// el JSON (sobre todo el settings de agy) truncado. Si el renombrado falla (archivo abierto en Windows),
// se escribe directo.
function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const texto = JSON.stringify(data, null, 2) + "\n";
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, texto, "utf8");
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, texto, "utf8");
  }
}

// Respaldo del settings de agy antes de tocarlo: `.bak` es el estado justo anterior y `.bak-AAAA-MM-DD`
// conserva el primero del día, que no se sobrescribe (el `.bak` sí cambia en cada sincronización).
function respaldar(settingsPath, ahora = new Date()) {
  if (!existsSync(settingsPath)) return;
  copyFileSync(settingsPath, settingsPath + ".bak");
  const delDia = `${settingsPath}.bak-${ahora.toISOString().slice(0, 10)}`;
  if (!existsSync(delDia)) copyFileSync(settingsPath, delDia);
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
  respaldar(paths.settings);
  writeJson(paths.settings, settings);
  writeJson(paths.aplicadas, applied);
  return settings.permissions;
}

// ---- Comandos temporales: permitidos solo mientras dura una delegación ----
// Se registran en permisos-temporales.json antes de tocar el settings, así un corte a medias deja rastro
// y la limpieza de huérfanos los quita. Si dos delegaciones piden el mismo comando a la vez, la regla se
// quita cuando termina la última; y una regla que ya existía antes (del usuario, de la base o de un
// proyecto) nunca se quita.
//   { reglas: { "command(x)": { preexistente: bool, usuarios: [id, ...] } }, procesos: { id: { pid, creado } } }

const reglaComando = (c) => `command(${c})`;
const archivoTemporales = (paths) => paths.temporales ?? join(dirname(paths.aplicadas), "permisos-temporales.json");
const leerTemporales = (paths) => readJson(archivoTemporales(paths), { reglas: {}, procesos: {} });

export function agregarTemporales(id, comandos, paths = PATHS, { pid = process.pid, ahora = new Date() } = {}) {
  const reglas = [...new Set(comandos.map((c) => c.trim()).filter(Boolean).map(reglaComando))];
  if (!reglas.length) return [];
  const t = leerTemporales(paths);
  const settings = readJson(paths.settings, {});
  settings.permissions ??= {};
  const allow = (settings.permissions.allow ??= []);
  for (const r of reglas) {
    const existente = t.reglas[r];
    if (existente) {
      if (!existente.usuarios.includes(id)) existente.usuarios.push(id);
      continue;
    }
    const preexistente = allow.includes(r);
    t.reglas[r] = { preexistente, usuarios: [id] };
    if (!preexistente) allow.push(r);
  }
  t.procesos[id] = { pid, creado: ahora.toISOString() };
  writeJson(archivoTemporales(paths), t); // primero el rastro, luego el settings
  respaldar(paths.settings, ahora);
  writeJson(paths.settings, settings);
  return reglas;
}

// Quita lo que `id` agregó. Devuelve las reglas que salieron del settings.
export function quitarTemporales(id, paths = PATHS) {
  const t = leerTemporales(paths);
  const aQuitar = [];
  for (const [regla, e] of Object.entries(t.reglas)) {
    if (!e.usuarios.includes(id)) continue;
    e.usuarios = e.usuarios.filter((u) => u !== id);
    if (e.usuarios.length) continue;
    delete t.reglas[regla];
    if (!e.preexistente) aQuitar.push(regla);
  }
  delete t.procesos[id];
  let quitadas = [];
  if (aQuitar.length) {
    const st = loadState(paths);
    // Si mientras tanto el comando pasó a ser una regla de proyecto, se queda.
    const deseadas = new Set(desiredRules(st.base, st.proyectos).allow);
    quitadas = aQuitar.filter((r) => !deseadas.has(r));
    const settings = st.settings;
    if (quitadas.length && settings.permissions?.allow) {
      settings.permissions.allow = settings.permissions.allow.filter((r) => !quitadas.includes(r));
      respaldar(paths.settings);
      writeJson(paths.settings, settings);
    }
  }
  writeJson(archivoTemporales(paths), t); // el rastro se borra al final: si algo falló antes, queda para la próxima limpieza
  return quitadas;
}

function procesoVivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// Quita los temporales de corridas que ya no existen (proceso muerto, o más de `maxMs` de antigüedad
// por si el número de proceso se reutilizó). Devuelve las reglas quitadas.
export function limpiarHuerfanos(paths = PATHS, { maxMs = 2 * 60 * 60 * 1000, ahora = Date.now(), vivo = procesoVivo } = {}) {
  const quitadas = [];
  for (const [id, p] of Object.entries(leerTemporales(paths).procesos)) {
    if (ahora - Date.parse(p.creado) > maxMs || !vivo(p.pid)) quitadas.push(...quitarTemporales(id, paths));
  }
  return quitadas;
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
