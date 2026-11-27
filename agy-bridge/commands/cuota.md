---
description: Ver la cuota disponible de Antigravity (Gemini y Claude/GPT) y de Claude
allowed-tools: Bash(node:*)
---

1. Ejecuta `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-run.mjs" cuota` (no gasta tokens de agy).
2. Si tienes `mcp__ccd_session_mgmt__get_usage`, consulta también el uso de Claude.
3. Muestra una tabla corta: grupo, % restante en 5 h, % restante semanal y cuándo se reinicia. Agrega una línea de lectura, por ejemplo: "Gemini holgado y Claude al 75% → conviene delegar más".
