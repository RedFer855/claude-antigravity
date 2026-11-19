// Pruebas con salidas reales de agy 1.4.6 grabadas en tests/fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classify, createStreamState, feedLine } from "../scripts/lib/stream.mjs";
import { buildAgyArgs, buildPrompt } from "../scripts/agy-run.mjs";
import { buildRecord } from "../scripts/lib/kpis.mjs";

const fx = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", name), "utf8");

function parse(text) {
  const s = createStreamState();
  for (const l of text.split(/\r?\n/)) feedLine(s, l);
  return s;
}

test("lectura exitosa: estado ok con respuesta, tokens y herramienta", () => {
  const v = classify(parse(fx("ok.ndjson")));
  assert.equal(v.estado, "ok");
  assert.match(v.respuesta, /suma/);
  assert.equal(v.modelo, "gemini-3.8-flash-medium");
  assert.ok(v.tokens.total_tokens > 0);
  assert.deepEqual(v.herramientas, ["read_file"]);
  assert.deepEqual(v.archivos_escritos, []);
});

test("tokens: suma el usage de los pasos de esta llamada, no el acumulado de result", () => {
  const v = classify(parse(fx("ok.ndjson")));
  // ok.ndjson: paso 1 = 24094, paso 3 = 2914.
  assert.equal(v.tokens.total_tokens, 24094 + 2914);
  assert.equal(v.tokens.cache_read_tokens, 21927);
});

test("comando rechazado: SUCCESS vacío se clasifica como permiso_denegado", () => {
  const v = classify(parse(fx("deny.ndjson")), { stderr: fx("deny.stderr.txt") });
  assert.equal(v.estado, "permiso_denegado");
  assert.deepEqual(v.acciones_denegadas, ["command"]);
  assert.equal(v.comando_denegado, "node --version");
});

test("comando rechazado con paso en ERROR: igual identifica el comando", () => {
  const v = classify(parse(fx("deny-npm.ndjson")));
  assert.equal(v.estado, "permiso_denegado");
  assert.equal(v.comando_denegado, "npm --help");
});

test("denied_actions solo en stderr también cuenta", () => {
  const s = parse(fx("ok.ndjson"));
  const v = classify(s, { stderr: 'a tool required the "write_file" permission that headless mode cannot prompt for' });
  assert.equal(v.estado, "permiso_denegado");
  assert.deepEqual(v.acciones_denegadas, ["write_file"]);
});

test("escritura: registra el archivo escrito", () => {
  const v = classify(parse(fx("write.ndjson")));
  assert.equal(v.estado, "ok");
  assert.equal(v.archivos_escritos.length, 1);
  assert.match(v.archivos_escritos[0], /resta\.py$/);
});

test("sin evento result: timeout si se mató, error si no", () => {
  const s = parse(fx("ok.ndjson").split(/\r?\n/).filter((l) => !l.includes('"event":"result"')).join("\n"));
  assert.equal(classify(s, { killed: true }).estado, "timeout");
  assert.equal(classify(s, { exitCode: 1, stderr: "boom" }).estado, "error");
  // Aunque falte result, conserva el texto que alcanzó a llegar.
  assert.match(classify(s, { killed: true }).respuesta, /suma/);
});

test("respuesta vacía sin rechazos es 'vacio'", () => {
  const s = createStreamState();
  feedLine(s, JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "", usage: {} } }));
  assert.equal(classify(s).estado, "vacio");
});

test("status ERROR con respuesta es parcial", () => {
  const s = createStreamState();
  feedLine(s, JSON.stringify({ event: "result", result: { status: "ERROR", error: "API error (attempt 1): INTERNAL", response: "ARCHIVOS: a" } }));
  assert.equal(classify(s).estado, "parcial");
});

test("status distinto de SUCCESS es error", () => {
  const s = createStreamState();
  feedLine(s, JSON.stringify({ event: "result", result: { status: "ERROR", error: "quota", response: "" } }));
  const v = classify(s);
  assert.equal(v.estado, "error");
  assert.equal(v.motivo, "quota");
});

test("ignora líneas basura y BOM", () => {
  const s = createStreamState();
  feedLine(s, "\uFEFF" + JSON.stringify({ event: "init", conversation_id: "x", init: { model: "m" } }));
  feedLine(s, "no es json");
  feedLine(s, "{roto");
  assert.equal(s.conversationId, "x");
  assert.equal(s.model, "m");
});

test("buildPrompt agrega /goal una sola vez", () => {
  assert.match(buildPrompt("haz X", { goal: true }), /^\/goal haz X\n\nFINAL REPLY FORMAT/);
  assert.match(buildPrompt("/goal haz X", { goal: true }), /^\/goal haz X\n\nFINAL REPLY FORMAT/);
  assert.match(buildPrompt("  haz X ", { goal: false }), /^haz X\n\nFINAL REPLY FORMAT/);
});

test("buildAgyArgs: timeout con margen y flags opcionales", () => {
  const a = buildAgyArgs({ model: "gemini-3.8-flash-high", conversation: "abc", timeoutS: 300 });
  assert.deepEqual(a, ["--output-format", "stream-json", "--print-timeout", "280s", "--model", "gemini-3.8-flash-high", "--conversation", "abc"]);
  assert.ok(buildAgyArgs({ timeoutS: 10 }).includes("30s"));
});

test("buildRecord marca si el usuario cambió la recomendación", () => {
  const v = classify(parse(fx("ok.ndjson")));
  const r = buildRecord(v, { cwd: "D:/p", model: "gemini-3.8-flash-high", recomendado: "gemini-3.8-flash-medium", goal: true, wallSeconds: 9 });
  assert.equal(r.cambiado_por_usuario, true);
  assert.equal(r.modo, "goal");
  assert.equal(r.estado, "ok");
  assert.equal(r.aprobado_en_revision, null);
});
