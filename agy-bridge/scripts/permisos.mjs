#!/usr/bin/env node
// Gestión de permisos de agy para el puente.
//
//   node permisos.mjs ver      [--cwd <dir>]
//   node permisos.mjs aplicar                      sincroniza base + proyectos en settings.json
//   node permisos.mjs agregar  [--cwd <dir>] [--escritura] [--comando "<cmd>"]...
//   node permisos.mjs quitar   [--cwd <dir>] [--escritura] [--comando "<cmd>"]...
//   node permisos.mjs sugerir  [--cwd <dir>]       comandos denegados según el registro de KPIs
import { parseArgs } from "node:util";
import { DEFAULT_LOG } from "./lib/kpis.mjs";
import { loadState, PATHS, projectKey, projectRules, suggestFromLog, sync, updateProject } from "./lib/permisos.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cwd: { type: "string" },
    escritura: { type: "boolean", default: false },
    comando: { type: "string", multiple: true, default: [] },
    log: { type: "string" },
  },
});

const accion = positionals[0] ?? "ver";
const cwd = values.cwd ?? process.cwd();
const key = projectKey(cwd);
const print = (o) => process.stdout.write(JSON.stringify(o, null, 2) + "\n");

switch (accion) {
  case "ver": {
    const st = loadState();
    const cfg = st.proyectos[key] ?? { escritura: false, comandos: [] };
    print({
      proyecto: key,
      reglas_proyecto: projectRules(key, cfg),
      base: { allow: st.base.allow.length, deny: st.base.deny.length },
      settings: PATHS.settings,
      en_settings: { allow: st.settings.permissions?.allow?.length ?? 0, deny: st.settings.permissions?.deny?.length ?? 0 },
      proyectos_registrados: Object.keys(st.proyectos),
    });
    break;
  }
  case "aplicar":
    print(sync());
    break;
  case "agregar":
  case "quitar": {
    if (!values.escritura && !values.comando.length) {
      console.error("Indica --escritura y/o --comando \"<cmd>\".");
      process.exit(2);
    }
    const add = accion === "agregar";
    updateProject(cwd, (cfg) => {
      if (values.escritura) cfg.escritura = add;
      const set = new Set(cfg.comandos);
      for (const c of values.comando) add ? set.add(c.trim()) : set.delete(c.trim());
      cfg.comandos = [...set];
    });
    const out = { proyecto: key, reglas_proyecto: projectRules(key, loadState().proyectos[key] ?? { comandos: [] }) };
    if (add && values.comando.length) {
      out.aviso = "Coincidencia exacta: agy solo permite el comando idéntico a la regla (sin prefijos ni comodines). Registra cada comando completo con sus argumentos. Las reglas son globales: quita las de un solo uso al terminar.";
      const comodines = values.comando.filter((c) => /[*?]/.test(c));
      if (comodines.length) out.sospechosos = comodines.map((c) => `${c} → agy no interpreta comodines; solo coincidirá con ese texto literal`);
    }
    print(out);
    break;
  }
  case "sugerir":
    print({ proyecto: key, sugerencias: suggestFromLog(values.log ?? DEFAULT_LOG, cwd) });
    break;
  default:
    console.error(`Acción desconocida: ${accion}`);
    process.exit(2);
}
