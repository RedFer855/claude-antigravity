#!/usr/bin/env node
// Completa `costo_claude` en el registro de KPIs para las delegaciones que aún no lo tienen.
//   node costo-claude.mjs [--log <ruta>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_LOG } from "./lib/kpis.mjs";
import { findCost } from "./lib/costo.mjs";

const { values } = parseArgs({ options: { log: { type: "string" } } });
const logPath = values.log ?? DEFAULT_LOG;
if (!existsSync(logPath)) {
  process.stdout.write(JSON.stringify({ actualizados: 0, motivo: "sin registro" }) + "\n");
  process.exit(0);
}

const records = readFileSync(logPath, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l.replace(/^﻿/, "")));
let actualizados = 0;
for (const r of records) {
  if (r.costo_claude || !r.delegacion_id) continue;
  const since = Date.parse(r.fecha) - 60000;
  const c = findCost(r.delegacion_id, since);
  if (c) { r.costo_claude = c; actualizados++; }
}
writeFileSync(logPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
process.stdout.write(JSON.stringify({ actualizados, total: records.length }) + "\n");
