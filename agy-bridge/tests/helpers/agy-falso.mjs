// agy falso para las pruebas de punta a punta. Se lanza como `node agy-falso.mjs -p <prompt> ...`
// (AGY_BIN=node, AGY_BIN_ARGS=["<esta ruta>"]) y emite el mismo stream-json que agy real, haciendo lo que
// diga FAKE_AGY_PLAN (JSON):
//   escribe:          [{ ruta, contenido }]  escribe el archivo y emite el evento de la herramienta write_file
//   escribeSinEvento: [{ ruta, contenido }]  escribe el archivo sin evento (como un comando de agy o un cambio ajeno)
//   registrarSettings: ruta                  copia ahí el settings.json de agy tal como está durante la corrida
//   respuesta:        texto de la respuesta final
//   status:           "SUCCESS" (por defecto) o "ERROR"
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const plan = JSON.parse(process.env.FAKE_AGY_PLAN ?? "{}");
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const cid = "conv-falsa";

// Uso de cuota (lo pide el runtime si no se pasa --min-cuota 0).
if (process.argv.includes("/usage")) {
  emitir({ conversation_id: "", status: "SUCCESS", response: "", command: { name: "usage", data: { groups: [] } } });
  process.exit(0);
}

const escribir = (ruta, contenido) => {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido, "utf8");
};

emitir({ event: "init", conversation_id: cid, init: { model: "falso" } });

if (plan.registrarSettings) {
  const settings = join(homedir(), ".gemini", "antigravity-cli", "settings.json");
  if (existsSync(settings)) copyFileSync(settings, plan.registrarSettings);
}

let paso = 1;
for (const { ruta, contenido } of plan.escribe ?? []) {
  escribir(ruta, contenido);
  const tool = { name: "write_file", parameters: { Path: ruta } };
  emitir({ event: "step_update", step_update: { conversation_id: cid, step_index: paso, state: "DONE", step_type: "tool", tool_name: "write_file", tool_info: tool } });
  paso++;
}
for (const { ruta, contenido } of plan.escribeSinEvento ?? []) escribir(ruta, contenido);

emitir({
  event: "result",
  result: { conversation_id: cid, status: plan.status ?? "SUCCESS", response: plan.respuesta ?? "Hecho.", duration_seconds: 1, num_turns: 1, usage: { total_tokens: 10 } },
});
