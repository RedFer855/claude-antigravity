// Pruebas de las piezas de la v2: cuota, git, costo de Claude y armado del prompt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseUsage, quotaGroup, remainingFor } from "../scripts/lib/cuota.mjs";
import { diffSummary, isRepo, snapshot, undo } from "../scripts/lib/git.mjs";
import { costForNeedle } from "../scripts/lib/costo.mjs";
import { buildPrompt, runVerification, truncate } from "../scripts/agy-run.mjs";

const fx = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", name), "utf8");

test("cuota: grupos por modelo", () => {
  assert.equal(quotaGroup("gemini-3.8-flash-medium"), "gemini");
  assert.equal(quotaGroup("gemini-4-hydrogen-xhigh"), "gemini");
  assert.equal(quotaGroup("gemini-4-argon-low"), "argon");
  assert.equal(quotaGroup("claude-sonnet-5-5-medium"), "claude_gpt");
  assert.equal(quotaGroup("gpt-oss-120b-medium"), "claude_gpt");
});

test("cuota: parsea /usage y toma la ventana más baja", () => {
  const u = parseUsage(JSON.parse(fx("usage.json")));
  assert.equal(u.gemini["5h"], 0.97);
  assert.equal(u.gemini.semanal, 0.93);
  assert.equal(u.argon.semanal, 0.03);
  assert.equal(remainingFor(u, "gemini-3.8-flash-high"), 0.93);
  assert.equal(remainingFor(u, "gemini-4-argon-medium"), 0.03);
  assert.equal(remainingFor(u, "claude-opus-5-5-high"), 1);
});

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "agy-git-"));
  const g = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir });
  g("init", "-q");
  writeFileSync(join(dir, "a.txt"), "uno\n");
  writeFileSync(join(dir, ".gitignore"), "ignorado.txt\n");
  g("add", "-A");
  g("commit", "-qm", "base");
  return dir;
}

test("git: snapshot no toca índice ni árbol, y deshacer solo revierte lo de agy", () => {
  const dir = tempRepo();
  assert.ok(isRepo(dir));
  // Cambio previo del usuario, sin commitear: debe sobrevivir.
  writeFileSync(join(dir, "a.txt"), "uno\ncambio del usuario\n");
  const antes = snapshot(dir, "t1-antes");
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  assert.match(status, /a\.txt/); // sigue sin commitear y sin agregar al índice
  assert.doesNotMatch(status, /^M /m);

  // "agy" modifica a.txt, crea b.txt y un archivo ignorado.
  writeFileSync(join(dir, "a.txt"), "uno\ncambio del usuario\nagy\n");
  writeFileSync(join(dir, "b.txt"), "nuevo\n");
  writeFileSync(join(dir, "ignorado.txt"), "x\n");
  const despues = snapshot(dir, "t1-despues");

  const d = diffSummary(dir, antes, despues);
  assert.deepEqual(d.archivos.map((f) => `${f.estado}:${f.archivo}`).sort(), ["A:b.txt", "M:a.txt"]);
  assert.equal(d.inserciones, 2);

  undo(dir, "refs/agy/t1-antes", "refs/agy/t1-despues");
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "uno\ncambio del usuario\n");
  assert.ok(!existsSync(join(dir, "b.txt")));
});

const usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 };
const msg = (id) => ({ type: "assistant", message: { id, usage, content: [] } });
const launch = (id) => ({ type: "assistant", message: { id, usage, content: [{ type: "tool_use", input: { command: "node agy-run.mjs --cwd x" } }] } });
const result = (did) => ({ type: "user", message: { content: [{ type: "tool_result", content: `{"delegacion_id": "${did}"}` }] } });
const prompt = (t) => ({ type: "user", message: { content: t } });

test("costo: suma la ventana entre prompts reales y deduplica mensajes", () => {
  const entries = [
    prompt("tarea anterior"), msg("m0"),
    prompt("delega esto"),
    msg("m1"), launch("m2"), launch("m2"), // misma respuesta en otra línea
    result("d123"),
    msg("m3"),
    { type: "user", message: { content: [{ type: "text", text: "siguiente pedido" }] } },
    msg("m4"),
  ];
  const c = costForNeedle(entries, "d123");
  assert.equal(c.mensajes, 3);
  assert.equal(c.output, 150);
  assert.equal(c.equivalente, Math.round(3 * (10 + 125 + 100 + 250)));
  assert.equal(costForNeedle(entries, "no-existe"), null);
});

test("costo: dos delegaciones en un turno no se cuentan dos veces", () => {
  const entries = [
    prompt("haz A y B"),
    msg("a1"), launch("a2"), result("dA"), msg("a3"),
    launch("b1"), result("dB"), msg("b2"),
    prompt("gracias"),
  ];
  const a = costForNeedle(entries, "dA");
  const b = costForNeedle(entries, "dB");
  assert.equal(a.mensajes, 3); // a1, a2, a3
  assert.equal(b.mensajes, 2); // b1, b2
});

test("prompt: modo preguntas y goal", () => {
  assert.match(buildPrompt("do X", { preguntas: true }), /^QUESTIONS MODE.*do X$/s);
  assert.match(buildPrompt("do X", { goal: true }), /^\/goal do X\n\nFINAL REPLY FORMAT/);
});

test("truncate recorta y avisa", () => {
  assert.deepEqual(truncate("abc", 5), { texto: "abc", truncada: false });
  const t = truncate("x".repeat(10), 4);
  assert.equal(t.truncada, true);
  assert.ok(t.texto.startsWith("xxxx"));
});

test("verificación: ok y fallo con código", () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-ver-"));
  assert.equal(runVerification("node -e \"console.log('bien')\"", dir).ok, true);
  const f = runVerification("node -e \"process.exit(3)\"", dir);
  assert.equal(f.ok, false);
  assert.equal(f.codigo, 3);
});
