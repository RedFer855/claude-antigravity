// Cuota de agy vía `agy -p /usage --output-format json` (no gasta tokens).
import { execFileSync } from "node:child_process";

// Grupo de cuota que consume cada modelo (plan Pro: Argon tiene bolsa aparte).
// Hydrogen no aparece como grupo propio en `/usage` (2026-11-12): cae en "gemini".
export function quotaGroup(model = "") {
  if (model.startsWith("gemini-4-argon")) return "argon";
  if (model.startsWith("claude-") || model.startsWith("gpt-")) return "claude_gpt";
  return "gemini";
}

const GROUP_IDS = { "Gemini Models": "gemini", "Claude and GPT models": "claude_gpt", "Gemini 4 Argon": "argon" };

// Resume el JSON de /usage a { grupo: { "5h": fracción, semanal: fracción, reinicio } }.
export function parseUsage(envelope) {
  const out = {};
  for (const g of envelope?.command?.data?.groups ?? []) {
    const key = GROUP_IDS[g.name] ?? g.name;
    const entry = (out[key] = {});
    for (const b of g.buckets ?? []) {
      const w = b.window === "5h" ? "5h" : "semanal";
      entry[w] = Math.round((b.remaining_fraction ?? 0) * 100) / 100;
      entry[`reinicio_${w}`] = b.reset_time ?? null;
    }
  }
  return out;
}

// Fracción disponible para un modelo: la menor entre sus ventanas.
export function remainingFor(usage, model) {
  const g = usage[quotaGroup(model)];
  if (!g) return null;
  const vals = [g["5h"], g.semanal].filter((v) => typeof v === "number");
  return vals.length ? Math.min(...vals) : null;
}

export function readUsage(binary) {
  const out = execFileSync(binary, ["-p", "/usage", "--output-format", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 });
  return parseUsage(JSON.parse(out.trim().split(/\r?\n/).at(-1)));
}
