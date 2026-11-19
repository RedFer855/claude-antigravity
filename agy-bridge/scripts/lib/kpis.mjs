// Registro de KPIs: una línea JSON por tarea delegada.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR } from "./paths.mjs";

export const DEFAULT_LOG = join(DATA_DIR, "tareas.jsonl");

export function buildRecord(verdict, meta) {
  return {
    fecha: meta.inicio ?? new Date().toISOString(),
    fin: meta.fin ?? null,
    delegacion_id: meta.delegacionId ?? null,
    id: verdict.conversation_id ?? null,
    proyecto: meta.cwd,
    tipo: meta.tipo ?? null,
    modelo: meta.model ?? verdict.modelo ?? null,
    modo: meta.preguntas ? "preguntas" : meta.goal ? "goal" : "normal",
    recomendado: meta.recomendado ?? null,      // lo que propuso Claude
    cambiado_por_usuario: meta.recomendado ? meta.recomendado !== meta.model : null,
    continuacion: Boolean(meta.conversation),
    estado: verdict.estado,
    motivo_fallo: verdict.motivo ?? null,
    // Al continuar una conversación, agy reporta la duración acumulada; ahí solo vale la total.
    duracion_s: meta.conversation ? null : verdict.duracion_s ?? null,
    duracion_total_s: meta.wallSeconds ?? null, // incluye arranque del proceso
    turnos: verdict.turnos ?? null,
    tokens: verdict.tokens ?? null,
    acciones_denegadas: verdict.acciones_denegadas ?? [],
    comando_denegado: verdict.comando_denegado ?? null,
    cambios: meta.cambios ? { archivos: meta.cambios.archivos.length, inserciones: meta.cambios.inserciones, borrados: meta.cambios.borrados } : null,
    verificacion: meta.verificacion ? { cmd: meta.verificacion.cmd, ok: meta.verificacion.ok } : null,
    snapshots: meta.antes ? { antes: meta.antes, despues: meta.despues } : null,
    // Se completan después: costo de Claude (costo-claude.mjs) y revisión de Claude.
    costo_claude: null,
    aprobado_en_revision: null,
    leccion: null,
  };
}

export function appendRecord(record, logPath = DEFAULT_LOG) {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(record) + "\n", "utf8");
}
