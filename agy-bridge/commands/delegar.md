---
description: Forzar la delegación de una tarea o documento a Antigravity (agy). Claude escribe el brief, agy ejecuta, Claude revisa.
argument-hint: "[--model <slug>] [--goal] [--preguntas] [--continuar <id>] <qué hay que hacer>"
allowed-tools: Bash(node:*), Bash(git:*), Read, Grep, Glob, AskUserQuestion, Skill
---

El usuario está **forzando** la delegación a agy: no discutas si conviene.

Petición: $ARGUMENTS

Sigue la skill `delegacion` desde el paso 2. Detalles de esta invocación:
- Si vino `--model`, úsalo sin preguntar. Si no, recomienda uno (paso 2 de la skill).
- `--goal` y `--preguntas` se pasan tal cual al runtime. `--continuar <id>` equivale a `--conversation <id>` (manda solo el delta).
- Si la petición es un documento (Word, PDF, informe), usa la plantilla de documentos de `gemini-prompting` y el modo preguntas.
