#!/usr/bin/env node
// Runtime del puente: una delegación completa en una sola llamada.
// Revisa cuota, crea un punto de control git, ejecuta agy, mide el diff, corre la
// verificación y registra KPIs. Devuelve un JSON compacto pensado para el contexto de Claude.
//
// Uso:
//   node agy-run.mjs [run] --model <slug> [--cwd <dir>] [--goal | --preguntas]
//                    [--conversation <id>] [--verificar "<cmd>"] [--timeout <seg>]
//                    [--tipo <tipo>] [--recomendado <slug>] [--min-cuota 0.1]
//                    [--comando "<cmd>"]... [--prompt-file <ruta>] [--log <ruta>] [--no-log] [prompt...]
//   node agy-run.mjs cuota                       cuota de agy por grupo de modelos
//   node agy-run.mjs deshacer --id <delegacion_id> [--cwd <dir>] [--todo] [--forzar]
// --comando: comando que agy puede correr solo durante esta delegación (coincidencia exacta); se agrega
//   antes de lanzar agy y se quita siempre al terminar, aunque falle o se corte.
// deshacer: por defecto revierte solo lo que agy escribió con sus herramientas de archivo y no toca los
//   archivos editados después de la corrida. --todo incluye también otros cambios de la carpeta durante
//   la corrida; --forzar revierte aunque el archivo haya cambiado después.
// Sin prompt ni --prompt-file, lee el prompt de stdin.
// Código de salida 0 si estado=ok, 1 si no.
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { classify, createStreamState, feedLine } from "./lib/stream.mjs";
import { appendRecord, buildRecord, DEFAULT_LOG } from "./lib/kpis.mjs";
import { DATA_DIR } from "./lib/paths.mjs";
import { diffSummary, isRepo, raizRepo, snapshot, undo } from "./lib/git.mjs";
import { atribuir } from "./lib/atribucion.mjs";
import { argsPrefijo, quotaGroup, readUsage, remainingFor } from "./lib/cuota.mjs";
import { avisar } from "./lib/aviso.mjs";
import { capturar, hacerCumplir } from "./lib/guarda.mjs";
import { agregarTemporales, limpiarHuerfanos, quitarTemporales } from "./lib/permisos.mjs";

const DEFAULT_TIMEOUT_S = 900;
// agy recibe un --print-timeout menor que el corte duro, para que alcance a emitir su resultado.
const GRACE_S = 20;
// Tope de la respuesta de agy que vuelve al contexto de Claude; la completa queda en disco.
const MAX_RESPUESTA = 3000;
// Pide a agy un cierre corto para que la respuesta quepa en el tope.
const RESUMEN_SUFFIX =
  "\n\nFINAL REPLY FORMAT: end with a short, simple summary in plain prose (a few sentences, no tables, " +
  "no long lists), in the same language as the task requests. Mention only what changed or what matters.";
const VERIFY_TIMEOUT_MS = 300000;

const PREGUNTAS_PREFIX =
  "QUESTIONS MODE. Do not modify any file and do not run commands that change state. " +
  "Read the brief below and the files it references. Reply ONLY with up to 5 numbered blocking questions " +
  "whose answers would change the result, or exactly READY if nothing blocks you.\n\n";

export function resolveAgyBinary(env = process.env) {
  if (env.AGY_BIN) return env.AGY_BIN;
  const local = env.LOCALAPPDATA && join(env.LOCALAPPDATA, "agy", "bin", "agy.exe");
  return local && existsSync(local) ? local : "agy";
}

export function buildAgyArgs({ model, conversation, timeoutS }) {
  const args = ["--output-format", "stream-json", "--print-timeout", `${Math.max(timeoutS - GRACE_S, 30)}s`];
  if (model) args.push("--model", model);
  if (conversation) args.push("--conversation", conversation);
  return args;
}

export function buildPrompt(prompt, { goal, preguntas }) {
  const text = prompt.trim();
  if (preguntas) return PREGUNTAS_PREFIX + text;
  const body = text + RESUMEN_SUFFIX;
  return goal && !text.startsWith("/goal") ? `/goal ${body}` : body;
}

// Recorta a ~`max` caracteres conservando el principio (60%) y el final (40%): en las plantillas de respuesta
// lo último es PENDIENTE y VERIFICACIÓN, que no se pueden perder. La respuesta completa queda en disco.
export function truncate(text, max = MAX_RESPUESTA) {
  if (text.length <= max) return { texto: text, truncada: false };
  const inicio = Math.ceil(max * 0.6);
  const fin = max - inicio;
  const omitidos = text.length - inicio - fin;
  return { texto: `${text.slice(0, inicio)}\n[… ${omitidos} caracteres omitidos; completa en respuesta_completa …]\n${text.slice(text.length - fin)}`, truncada: true };
}

// Cambios para el JSON: solo estado y ruta, sin los conteos por archivo.
const corto = (lista) => lista.map(({ estado, archivo }) => ({ estado, archivo }));
export function resumenCambios(c) {
  if (!c) return null;
  const out = { archivos: corto(c.archivos), inserciones: c.inserciones, borrados: c.borrados };
  if (c.otros.length) {
    out.otros = corto(c.otros);
    out.nota = `${c.otros.length} archivo(s) cambiaron en la carpeta durante la corrida sin que agy los escribiera con sus herramientas ` +
      "(comandos de agy o trabajo en paralelo tuyo o de Claude). No se cuentan como de agy y `deshacer` no los revierte salvo con --todo.";
  }
  return out;
}

export function runAgy({ binary, args, prompt, cwd, timeoutS }) {
  return new Promise((done) => {
    const state = createStreamState();
    const started = Date.now();
    let stderr = "";
    let buffer = "";
    let killed = false;

    // -p recibe el prompt como argumento; en Windows el límite de la línea de comandos es ~32k caracteres.
    const child = spawn(binary, [...argsPrefijo(), "-p", prompt, ...args], { cwd, windowsHide: true });
    const timer = setTimeout(() => { killed = true; child.kill(); }, timeoutS * 1000);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const l of lines) feedLine(state, l);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => { stderr += c; });

    const finish = (exitCode, spawnError) => {
      clearTimeout(timer);
      if (buffer) feedLine(state, buffer);
      if (spawnError) stderr += `\n${spawnError.message}`;
      const verdict = classify(state, { stderr, exitCode, killed });
      done({ verdict, stderr, wallSeconds: (Date.now() - started) / 1000 });
    };
    child.on("error", (err) => finish(1, err));
    child.on("close", (code) => finish(code ?? 1));
  });
}

export function runVerification(cmd, cwd) {
  try {
    const out = execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: VERIFY_TIMEOUT_MS });
    return { cmd, ok: true, codigo: 0, salida_final: tail(out) };
  } catch (e) {
    return { cmd, ok: false, codigo: e.status ?? null, salida_final: tail(`${e.stdout ?? ""}\n${e.stderr ?? ""}`) };
  }
}

function tail(text, lines = 15) {
  return text.trim().split(/\r?\n/).slice(-lines).join("\n");
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

async function cmdRun(values, positionals) {
  const raw = values["prompt-file"] ? readFileSync(values["prompt-file"], "utf8") : positionals.join(" ") || (await readStdin());
  if (!raw.trim()) {
    console.error("Falta el prompt (argumento, --prompt-file o stdin).");
    process.exit(2);
  }

  const cwd = resolve(values.cwd ?? process.cwd());
  const timeoutS = Number(values.timeout ?? DEFAULT_TIMEOUT_S);
  const binary = resolveAgyBinary();
  const model = values.model ?? null;
  const preguntas = values.preguntas;
  const delegacionId = `d${Date.now()}`;
  const inicio = new Date().toISOString();
  const meta = { cwd, model, goal: values.goal, preguntas, conversation: values.conversation, tipo: values.tipo, recomendado: values.recomendado, delegacionId, inicio };
  const log = (verdict, extra) => { if (!values["no-log"]) appendRecord(buildRecord(verdict, { ...meta, ...extra, fin: new Date().toISOString() }), values.log ?? DEFAULT_LOG); };

  // 1. Cuota: si el grupo del modelo está por debajo del mínimo, no se gasta nada.
  let cuota = null;
  if (values["min-cuota"] !== "0") {
    try {
      const usage = readUsage(binary);
      cuota = { grupo: quotaGroup(model ?? ""), restante: remainingFor(usage, model ?? "") };
      if (cuota.restante !== null && cuota.restante < Number(values["min-cuota"] ?? 0.1)) {
        const verdict = { estado: "sin_cuota", motivo: `cuota ${cuota.grupo} al ${Math.round(cuota.restante * 100)}%`, conversation_id: null, modelo: model };
        log(verdict, { wallSeconds: 0 });
        print({ ...verdict, delegacion_id: delegacionId, cuota });
        process.exit(1);
      }
    } catch {
      cuota = { grupo: quotaGroup(model ?? ""), restante: null };
    }
  }

  // 2. Punto de control antes de que agy toque nada (no aplica al modo preguntas).
  const repo = !preguntas && isRepo(cwd);
  const raiz = repo ? raizRepo(cwd) : cwd;
  const antes = repo ? snapshot(cwd, `${delegacionId}-antes`) : null;
  // Rutas con secretos (.env*, settings.local.json): se guardan ahora y se comprueban al terminar.
  const prohibidas = capturar(cwd);

  // 2b. Comandos permitidos solo para esta delegación. Se quitan siempre al terminar (finally), si se
  // corta el proceso (señal) o, si ni eso alcanza, en la limpieza de huérfanos de la próxima corrida.
  try { limpiarHuerfanos(); } catch { /* la limpieza nunca debe impedir delegar */ }
  const temporales = values.comando?.length ? agregarTemporales(delegacionId, values.comando) : [];
  const soltar = () => { if (temporales.length) { try { quitarTemporales(delegacionId); } catch { /* queda para la limpieza de huérfanos */ } } };
  const alCortar = () => { soltar(); process.exit(130); };
  process.once("SIGINT", alCortar);
  process.once("SIGTERM", alCortar);

  let estadoFinal;
  try {
    estadoFinal = await correrDelegacion({ values, raw, cwd, raiz, repo, antes, prohibidas, binary, model, preguntas, timeoutS, delegacionId, cuota, temporales, log });
  } finally {
    soltar();
    process.removeListener("SIGINT", alCortar);
    process.removeListener("SIGTERM", alCortar);
  }
  process.exit(estadoFinal === "ok" ? 0 : 1);
}

// Pasos 3 a 5: ejecutar agy, medir lo que cambió, verificar, guardar y responder.
async function correrDelegacion({ values, raw, cwd, raiz, repo, antes, prohibidas, binary, model, preguntas, timeoutS, delegacionId, cuota, temporales, log }) {
  const dir = join(DATA_DIR, "delegaciones");

  // 3. Ejecutar agy.
  const prompt = buildPrompt(raw, { goal: values.goal, preguntas });
  const { verdict, wallSeconds } = await runAgy({ binary, args: buildAgyArgs({ model, conversation: values.conversation, timeoutS }), prompt, cwd, timeoutS });

  // 4. Cambios reales y verificación. Antes del snapshot, para que no cuente lo que se repone.
  // Lo que la guarda pisa o borra se copia antes a guarda/<id>/: si fue una edición tuya, no se pierde.
  const revertidos = hacerCumplir(cwd, prohibidas, { respaldo: join(DATA_DIR, "guarda", delegacionId) });
  const despues = repo ? snapshot(cwd, `${delegacionId}-despues`) : null;
  // De lo que cambió en la carpeta, solo se atribuye a agy lo que escribió con sus herramientas de archivo.
  const cambios = repo ? atribuir(diffSummary(raiz, antes, despues), verdict.archivos_escritos, raiz) : null;
  if (cambios) {
    // Lo necesita `deshacer`; va aunque se use --no-log.
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${delegacionId}.cambios.json`), JSON.stringify({
      antes, despues, raiz,
      archivos: cambios.archivos.map((f) => f.archivo),
      otros: cambios.otros.map((f) => f.archivo),
    }, null, 2) + "\n", "utf8");
  }
  let verificacion = null;
  if (values.verificar && !preguntas && ["ok", "parcial"].includes(verdict.estado)) {
    verificacion = runVerification(values.verificar, cwd);
    if (!verificacion.ok) {
      verdict.estado = "verificacion_fallida";
      verdict.motivo = `falló: ${values.verificar} (código ${verificacion.codigo})`;
    } else if (verdict.estado === "parcial") {
      verdict.estado = "ok";
      verdict.motivo = `verificación ok pese a error de agy: ${verdict.motivo}`;
    }
  }

  // 5. Guardar brief y respuesta completos; al contexto de Claude solo va el recorte.
  let respuestaCompleta = null;
  if (!values["no-log"]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${delegacionId}.brief.md`), prompt, "utf8");
    respuestaCompleta = join(dir, `${delegacionId}.respuesta.md`);
    writeFileSync(respuestaCompleta, verdict.respuesta ?? "", "utf8");
  }
  log(verdict, { wallSeconds, cambios, verificacion, antes, despues });
  avisar({ cwd, estado: verdict.estado, respuesta: verdict.respuesta, wallSeconds });

  const r = truncate(verdict.respuesta ?? "");
  print({
    estado: verdict.estado,
    motivo: verdict.motivo,
    delegacion_id: delegacionId,
    conversation_id: verdict.conversation_id,
    modelo: verdict.modelo,
    respuesta: r.texto,
    respuesta_truncada: r.truncada,
    respuesta_completa: respuestaCompleta,
    duracion_total_s: Math.round(wallSeconds * 10) / 10,
    tokens_agy: verdict.tokens?.total_tokens ?? null,
    acciones_denegadas: verdict.acciones_denegadas,
    comando_denegado: verdict.comando_denegado,
    comandos_temporales: temporales.length ? temporales : undefined,
    rutas_prohibidas_revertidas: revertidos.length ? revertidos : undefined,
    cambios: resumenCambios(cambios),
    verificacion,
    cuota,
  });
  return verdict.estado;
}

function cmdCuota() {
  print(readUsage(resolveAgyBinary()));
}

function cmdDeshacer(values) {
  const cwd = resolve(values.cwd ?? process.cwd());
  if (!values.id) {
    console.error("Falta --id <delegacion_id>.");
    process.exit(2);
  }
  // Qué archivos escribió agy: lo guardó la delegación. Sin ese registro (versión anterior del plugin)
  // no se puede saber, y revertir todo el diff exige pedirlo con --todo.
  const ruta = join(DATA_DIR, "delegaciones", `${values.id}.cambios.json`);
  const registro = existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : null;
  if (!registro && !values.todo) {
    console.error(`No hay registro de los archivos que escribió agy en ${values.id} (¿corrió con una versión anterior del plugin?). Usa --todo para revertir todo lo que cambió en la carpeta durante esa corrida.`);
    process.exit(2);
  }
  const r = undo(cwd, `refs/agy/${values.id}-antes`, `refs/agy/${values.id}-despues`, {
    archivos: values.todo || !registro ? undefined : new Set(registro.archivos),
    forzar: values.forzar,
  });
  const out = { deshecho: values.id, revertidos: r.revertidos };
  if (r.conflictos.length) {
    out.conflictos = r.conflictos;
    out.nota = "Estos archivos cambiaron después de la corrida de agy y no se tocaron para no pisar ese trabajo. Revísalos y, si quieres revertirlos igual, repite con --forzar.";
  }
  if (r.omitidos.length) out.no_de_agy_sin_tocar = r.omitidos;
  print(out);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: "string" },
      cwd: { type: "string" },
      goal: { type: "boolean", default: false },
      preguntas: { type: "boolean", default: false },
      conversation: { type: "string" },
      verificar: { type: "string" },
      timeout: { type: "string" },
      tipo: { type: "string" },
      recomendado: { type: "string" },
      "min-cuota": { type: "string" },
      "prompt-file": { type: "string" },
      log: { type: "string" },
      "no-log": { type: "boolean", default: false },
      comando: { type: "string", multiple: true, default: [] },
      id: { type: "string" },
      todo: { type: "boolean", default: false },
      forzar: { type: "boolean", default: false },
    },
  });
  const sub = ["run", "cuota", "deshacer"].includes(positionals[0]) ? positionals.shift() : "run";
  if (sub === "cuota") return cmdCuota();
  if (sub === "deshacer") return cmdDeshacer(values);
  return cmdRun(values, positionals);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
