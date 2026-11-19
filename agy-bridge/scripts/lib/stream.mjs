// Lectura y clasificación de la salida stream-json de agy.
// Formato observado en agy 1.4.6: una línea JSON por evento.
//   {"event":"init","conversation_id":...,"init":{model,cwd,tools,...}}
//   {"event":"step_update","step_update":{step_index,state,step_type,tool_name?,tool_info?,text_delta?,usage?}}
//   {"event":"result","result":{conversation_id,status,response,duration_seconds,num_turns,usage,denied_actions?}}

// Herramientas de agy que modifican archivos; el parámetro con la ruta varía según la herramienta.
const WRITE_TOOLS = new Set(["write_to_file", "write_file", "replace_file_content", "multi_replace_file_content", "edit_file"]);
const PATH_KEYS = ["TargetFile", "Path", "path", "AbsolutePath", "FilePath"];

export function createStreamState() {
  return {
    conversationId: null,
    model: null,
    result: null,
    text: "",
    tools: [],          // {name, detail} por cada herramienta terminada
    commands: [],       // líneas de comando que el agente intentó ejecutar
    filesWritten: new Set(),
    stepsDone: 0,
    // Suma del usage de cada paso de esta llamada. El usage de `result` acumula
    // toda la conversación cuando se continúa con --conversation.
    stepUsage: null,
    lastEvent: null,
  };
}

export function feedLine(state, rawLine) {
  const line = rawLine.replace(/^﻿/, "").trim();
  if (!line.startsWith("{")) return;
  let ev;
  try { ev = JSON.parse(line); } catch { return; }
  state.lastEvent = ev.event ?? null;

  if (ev.event === "init") {
    state.conversationId = ev.conversation_id ?? state.conversationId;
    state.model = ev.init?.model ?? null;
    return;
  }

  if (ev.event === "step_update") {
    const s = ev.step_update ?? {};
    state.conversationId ??= s.conversation_id ?? null;
    if (s.step_type === "agent_response" && typeof s.text_delta === "string") state.text += s.text_delta;
    // El comando se anota al empezar el paso: si agy lo rechaza, a veces no llega un DONE con parámetros.
    const cmd = s.step_type === "tool" ? s.tool_info?.parameters?.CommandLine : null;
    if (cmd && state.commandSteps?.get(s.step_index) !== cmd) {
      (state.commandSteps ??= new Map()).set(s.step_index, cmd);
      state.commands.push(cmd);
    }
    if (s.state !== "DONE") return;
    state.stepsDone++;
    if (s.usage) {
      state.stepUsage ??= {};
      for (const [k, n] of Object.entries(s.usage)) state.stepUsage[k] = (state.stepUsage[k] ?? 0) + Number(n || 0);
    }
    if (s.step_type !== "tool") return;
    const name = s.tool_name ?? s.tool_info?.name ?? "desconocida";
    const params = s.tool_info?.parameters ?? {};
    if (WRITE_TOOLS.has(name)) {
      const p = PATH_KEYS.map((k) => params[k]).find(Boolean);
      if (p) state.filesWritten.add(p);
    }
    state.tools.push({ name, detail: params.CommandLine ?? PATH_KEYS.map((k) => params[k]).find(Boolean) ?? null });
    return;
  }

  if (ev.event === "result") {
    state.result = ev.result ?? null;
    state.conversationId ??= state.result?.conversation_id ?? null;
  }
}

// Convierte el estado final (más stderr y cómo terminó el proceso) en un veredicto.
// estado: ok | permiso_denegado | vacio | error | timeout
export function classify(state, { stderr = "", exitCode = 0, killed = false } = {}) {
  const r = state.result;
  const denied = r?.denied_actions ?? [];
  const deniedFromStderr = [...stderr.matchAll(/required the "([^"]+)" permission/g)].map((m) => m[1]);
  const deniedActions = [...new Set([...denied.map((d) => d.action), ...deniedFromStderr])];
  const response = (r?.response ?? state.text ?? "").trim();

  let estado;
  let motivo = null;
  if (!r) {
    estado = killed ? "timeout" : "error";
    motivo = killed ? "agy no terminó antes del límite de tiempo" : (lastLine(stderr) || `agy salió con código ${exitCode} sin resultado`);
  } else if (deniedActions.length) {
    estado = "permiso_denegado";
    motivo = `agy rechazó: ${deniedActions.join(", ")}`;
  } else if (r.status !== "SUCCESS") {
    // agy reintenta errores transitorios de la API y a veces termina el trabajo aunque el
    // status quede en ERROR; si hay respuesta, es "parcial" y la verificación decide.
    estado = response ? "parcial" : "error";
    motivo = r.error ?? `status ${r.status}`;
  } else if (!response) {
    estado = "vacio";
    motivo = "agy terminó sin respuesta";
  } else {
    estado = "ok";
  }

  return {
    estado,
    motivo,
    conversation_id: state.conversationId,
    modelo: state.model,
    respuesta: response,
    duracion_s: r?.duration_seconds ?? null,
    turnos: r?.num_turns ?? null,
    tokens: state.stepUsage ?? r?.usage ?? null,
    acciones_denegadas: deniedActions,
    // Si se denegó un comando, el último que intentó es casi siempre el culpable.
    comando_denegado: deniedActions.includes("command") ? state.commands.at(-1) ?? null : null,
    archivos_escritos: [...state.filesWritten],
    herramientas: state.tools.map((t) => t.name),
    pasos: state.stepsDone,
  };
}

function lastLine(text) {
  return text.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
}
