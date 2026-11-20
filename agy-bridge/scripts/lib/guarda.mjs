// Guarda post-turno de rutas prohibidas: los permisos previenen, esto comprueba.
// Antes de delegar se guarda el contenido de las rutas con secretos (.env*, settings.local.json);
// al terminar, lo que el agente cambió, borró o creó ahí se devuelve a como estaba y se informa.
// Va aparte del snapshot de git porque este ignora lo que está en .gitignore, y un .env casi
// siempre lo está.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Sin distinguir mayúsculas: en Windows y macOS `.ENV` es el mismo archivo que `.env`.
// Las plantillas (.env.example y similares) no guardan secretos y se pueden escribir.
export const PROHIBIDAS = [
  /(^|\/)\.env(?:$|\.(?!(?:example|sample|template|dist)$))/i,
  /(^|\/)\.claude\/settings\.local\.json$/i,
];
export const esProhibida = (rel) => PROHIBIDAS.some((p) => p.test(rel));

const OMITIR = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
const TOPE_BYTES = 5 * 1024 * 1024;

// Rutas prohibidas existentes (relativas, con "/"), hasta `maxDepth` niveles de carpetas.
export function listarProhibidas(cwd, maxDepth = 4) {
  const out = [];
  const recorrer = (dir, rel, nivel) => {
    let entradas;
    try { entradas = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (OMITIR.has(e.name) || nivel >= maxDepth) continue;
        recorrer(join(dir, e.name), r, nivel + 1);
      } else if (esProhibida(r)) out.push(r);
    }
  };
  recorrer(cwd, "", 0);
  return out;
}

// Contenido de cada ruta prohibida antes del turno. Un archivo sobre el tope no se guarda: no
// se podría restaurar, así que tampoco se vigila.
export function capturar(cwd) {
  const antes = new Map();
  for (const rel of listarProhibidas(cwd)) {
    try {
      const p = join(cwd, rel);
      if (lstatSync(p).size > TOPE_BYTES) continue;
      antes.set(rel, readFileSync(p));
    } catch { /* ilegible: no se vigila */ }
  }
  return antes;
}

// Compara con lo capturado y repone. Devuelve [{ archivo, accion, respaldo? }] con accion
// "restaurado" (cambiado o borrado) o "eliminado" (apareció durante el turno).
// Con `respaldo` (carpeta), lo que hay ahora se copia ahí antes de pisarlo o borrarlo: si el cambio
// no lo hizo agy sino el usuario durante la corrida, no se pierde. La entrada trae la ruta de la copia.
export function hacerCumplir(cwd, antes, { respaldo } = {}) {
  const revertidos = [];
  const ahora = new Set(listarProhibidas(cwd));
  const guardarCopia = (rel, p) => {
    if (!respaldo || !existsSync(p)) return undefined;
    const destino = join(respaldo, rel);
    mkdirSync(dirname(destino), { recursive: true });
    copyFileSync(p, destino);
    return destino;
  };
  for (const [rel, contenido] of antes) {
    const p = join(cwd, rel);
    let igual = false;
    try { igual = ahora.has(rel) && readFileSync(p).equals(contenido); } catch { /* se restaura */ }
    if (igual) continue;
    const copia = guardarCopia(rel, p);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, contenido);
    revertidos.push({ archivo: rel, accion: "restaurado", ...(copia && { respaldo: copia }) });
  }
  for (const rel of ahora) {
    if (antes.has(rel)) continue;
    const p = join(cwd, rel);
    const copia = guardarCopia(rel, p);
    if (existsSync(p)) unlinkSync(p);
    revertidos.push({ archivo: rel, accion: "eliminado", ...(copia && { respaldo: copia }) });
  }
  return revertidos;
}
