// Costo de Claude por delegación, leído de los transcripts de Claude Code.
// La ventana va desde el último mensaje real del usuario antes de la llamada al runtime
// hasta el siguiente mensaje real del usuario: incluye preparar el brief, la llamada y la
// revisión. Si en ese mismo turno Claude hizo otras cosas, también entran (aproximación).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const PROJECTS_DIR = join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".claude", "projects");

// Pesos relativos al token de entrada normal (proporción de precios de la API).
// Sirve para resumir en un número; los componentes crudos también se guardan.
const WEIGHTS = { input: 1, cache_creation: 1.25, cache_read: 0.1, output: 5 };

function isRealUserPrompt(e) {
  if (e.type !== "user" || e.isMeta) return false;
  const c = e.message?.content;
  if (typeof c === "string") return true;
  return Array.isArray(c) && c.some((b) => b.type === "text");
}

export function parseTranscript(text) {
  return text.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// Mensajes de Claude que lanzan una delegación (llamada a agy-run.mjs, salvo cuota/deshacer).
function isLaunch(e) {
  if (e.type !== "assistant" || !Array.isArray(e.message?.content)) return false;
  return e.message.content.some((b) => b.type === "tool_use" && /agy-run\.mjs(?!\S*\s+(cuota|deshacer))/.test(JSON.stringify(b.input ?? {})));
}

// Suma el uso de Claude en la ventana de la delegación cuyo resultado contiene `needle`.
// La ventana va del prompt real del usuario (o del lanzamiento anterior en el mismo turno)
// hasta el siguiente prompt real (o el siguiente lanzamiento), para no contar dos veces.
export function costForNeedle(entries, needle) {
  const hit = entries.findIndex((e) => e.type === "user" && JSON.stringify(e.message?.content ?? "").includes(needle));
  if (hit < 0) return null;
  const idOf = (e) => e?.message?.id ?? e?.uuid;
  let launch = hit;
  while (launch > 0 && !isLaunch(entries[launch])) launch--;
  // Un mismo mensaje puede ocupar varias líneas: retrocede hasta su primera línea.
  let first = launch;
  while (first > 0 && idOf(entries[first - 1]) === idOf(entries[launch])) first--;
  // Si en este turno hubo otro lanzamiento antes, esta ventana empieza en el nuestro.
  let j = first - 1;
  while (j > 0 && !isRealUserPrompt(entries[j]) && !isLaunch(entries[j])) j--;
  const start = isLaunch(entries[j]) ? first : j;
  let end = hit + 1;
  while (end < entries.length && !isRealUserPrompt(entries[end]) && !(isLaunch(entries[end]) && idOf(entries[end]) !== idOf(entries[launch]))) end++;

  const seen = new Set();
  const t = { input: 0, cache_creation: 0, cache_read: 0, output: 0, mensajes: 0 };
  for (const e of entries.slice(start, end)) {
    const u = e.type === "assistant" && e.message?.usage;
    if (!u) continue;
    const key = e.message.id ?? e.requestId ?? e.uuid;
    if (seen.has(key)) continue; // un mismo mensaje se escribe en varias líneas
    seen.add(key);
    t.input += u.input_tokens ?? 0;
    t.cache_creation += u.cache_creation_input_tokens ?? 0;
    t.cache_read += u.cache_read_input_tokens ?? 0;
    t.output += u.output_tokens ?? 0;
    t.mensajes++;
  }
  t.equivalente = Math.round(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + t[k] * w, 0));
  return t;
}

// Transcripts modificados desde `since` (ms), en todas las carpetas de proyecto.
export function recentTranscripts(since, dir = PROJECTS_DIR) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const p of readdirSync(dir)) {
    const pd = join(dir, p);
    if (!statSync(pd).isDirectory()) continue;
    for (const f of readdirSync(pd)) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = join(pd, f);
      if (statSync(fp).mtimeMs >= since) files.push(fp);
    }
  }
  return files;
}

export function findCost(delegacionId, since, dir = PROJECTS_DIR) {
  for (const f of recentTranscripts(since, dir)) {
    const text = readFileSync(f, "utf8");
    if (!text.includes(delegacionId)) continue;
    const c = costForNeedle(parseTranscript(text), delegacionId);
    if (c) return c;
  }
  return null;
}
