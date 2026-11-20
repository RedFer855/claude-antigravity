// Atribución de cambios: de todo lo que cambió en la carpeta durante una corrida, qué escribió agy
// con sus herramientas de archivo y qué no. Lo segundo puede ser un comando de agy (formateador,
// build) o trabajo en paralelo de Claude o del usuario; como no se sabe, no se le atribuye a agy y
// `deshacer` no lo revierte salvo que se pida con --todo.
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// En Windows y macOS el sistema de archivos no distingue mayúsculas.
const insensible = process.platform === "win32" || process.platform === "darwin";
const clave = (s) => (insensible ? s.toLowerCase() : s);

// Ruta canónica: sin enlaces simbólicos ni nombres cortos de Windows (RUNNER~1). Git devuelve la raíz del
// repo así (en macOS /var es un enlace a /private/var), mientras que agy y --cwd pueden usar otra forma de
// la misma carpeta; sin canonizar ambas, ningún archivo coincidiría. Si el archivo ya no existe, se
// canoniza su carpeta más cercana que sí exista.
export function canonica(p) {
  try {
    return realpathSync.native(p);
  } catch {
    const padre = dirname(p);
    return padre === p ? p : join(canonica(padre), basename(p));
  }
}

// Ruta (absoluta, relativa o file://) → ruta relativa a `raiz` con "/", o null si cae fuera.
export function relativaA(raiz, ruta) {
  if (!ruta) return null;
  let p = String(ruta);
  if (/^file:\/\//i.test(p)) {
    try { p = decodeURIComponent(new URL(p).pathname).replace(/^\/([A-Za-z]:)/, "$1"); } catch { return null; }
  }
  const rel = relative(canonica(raiz), canonica(resolve(raiz, p)));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

// `cambios` es el resultado de diffSummary; `escritos` son las rutas que agy escribió (del stream).
// Devuelve { archivos, otros, inserciones, borrados }: `archivos` son los de agy y los totales
// de líneas cuentan solo esos.
export function atribuir(cambios, escritos, raiz) {
  const propios = new Set();
  for (const e of escritos ?? []) {
    const r = relativaA(raiz, e);
    if (r) propios.add(clave(r));
  }
  const archivos = [];
  const otros = [];
  for (const f of cambios.archivos) (propios.has(clave(f.archivo)) ? archivos : otros).push(f);
  return {
    archivos,
    otros,
    inserciones: archivos.reduce((s, f) => s + f.mas, 0),
    borrados: archivos.reduce((s, f) => s + f.menos, 0),
  };
}
