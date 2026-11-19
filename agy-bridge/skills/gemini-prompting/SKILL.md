---
name: gemini-prompting
description: Cómo escribir el brief que Claude le pasa a Antigravity (agy / Gemini) al delegar una tarea o un documento. Úsala siempre antes de llamar al runtime de agy-bridge.
user-invocable: false
---

# Brief para agy

El objetivo es que **Claude escriba poco y agy haga el trabajo pesado**: leer, buscar, editar, iterar, dar formato. Cada token que escribe o lee Claude cuesta más que uno de Gemini.

## Reglas
- **Escribe el brief en inglés** (menos tokens de salida para Claude). Pide que la respuesta y los documentos estén en español.
- **Rutas, no contenido.** Da rutas absolutas y qué buscar en cada archivo; no pegues código ni texto que agy puede leer solo.
- **Contexto largo → engram o archivo, una vez.** Si el plan o las decisiones ya están en engram (`topic_key`) o en un archivo del repo, apunta ahí en vez de repetirlo. Si no están y se usarán en más de una delegación, guárdalos primero (`mem_save` con `topic_key`, o un archivo) y referencia la clave.
- **Instrucciones exactas** (pasos, criterio de terminado) van en el brief o en un archivo del repo; engram es para decisiones, convenciones y lecciones.
- **Lee con herramientas de archivo, no con la terminal**: dilo explícito; si no, agy usa `type`/`cat` y le rechazan el permiso.
- **Comandos permitidos**: nómbralos exactos. La verificación final la corre el runtime (`--verificar`), así que agy no necesita repetirla salvo para iterar.
- **Criterio de terminado verificable** y **límites** (qué no tocar).
- **Respuesta corta y fija**: Claude revisa el diff y la verificación que trae el runtime, no la narración.
- En continuaciones (`--conversation`) manda solo el delta.

## Plantilla (código)

```
<task>What to achieve, 1–3 sentences. Expected end state.</task>

<context>
- Project root: <absolute path>
- Read: <absolute paths + what matters in each>
- Engram: read topic_key <key> with mem_search / mem_get_observation (if applicable)
- Decisions already made (do not revisit): ...
</context>

<steps>1. ... 2. ...</steps>

<done_when>
- <verifiable condition, e.g. `npm test` passes>
</done_when>

<rules>
- Use file tools to read and edit files; do not use the terminal to read files.
- You may only run: <exact commands>. Do not try others.
- Only modify files under: <paths>. No new dependencies, no config changes, no unrelated refactors.
- If a missing detail would change the result, stop and say so instead of guessing.
- At the end, ONLY if you found something non-obvious (a gotcha, a problem, something left pending), save it to engram with mem_save, topic_key "agy/<task-slug>", type "learning". Otherwise do not write to engram.
</rules>

<response>
Reply in Spanish, only:
ARCHIVOS: files created or modified
VERIFICACIÓN: command run and result, or "no ejecutada"
PENDIENTE: what you could not do, or "nada"
</response>
```

Omite `<steps>` si es de un paso. Si el brief pasa de ~80 líneas, la tarea es muy grande: divídela o pásala a un archivo de plan.

## Plantilla (documentos Word / PDF)

Claude define **qué** dice el documento; agy redacta, arma y da formato.

```
<task>Create <docx|pdf> "<title>" for <audience>. Spanish.</task>

<sources>
- <absolute paths / engram topic_keys>. Use ONLY these sources for facts, figures and conclusions. Never add data from your own knowledge.
</sources>

<outline>
1. <section> — <key points, 1 line>
2. ...
</outline>

<format>
- Word: use the docx-vector-spec-generator skill if it fits, otherwise python-docx. PDF: generate directly with reportlab (no LibreOffice available).
- Output: <project>/docs/<file name>
- Length: <pages/words>. Tone: <tone>.
</format>

<rules>
- Use file tools to read sources. You may only run: python.
- Mark any statement you could not support with a source as [SIN FUENTE].
- Engram rule as above.
</rules>

<response>
Reply in Spanish, only:
ARCHIVO: path
SECCIONES: list with 1 line each
CIFRAS: every number used, with its source
PENDIENTE: ...
</response>
```

Para documentos usa casi siempre el modo preguntas primero (`--preguntas`): público, extensión o alcance mal entendidos obligan a rehacer todo. La revisión de Claude es contra `CIFRAS` y las fuentes (datos críticos); el formato visual lo revisa el usuario abriendo el archivo.

## Antipatrones (vistos en pruebas)
- "Revisa el proyecto y mejora X" → lee de más, cambia de más.
- Pedir "corre los tests" sin el comando exacto → intenta variantes no permitidas y se corta.
- Pegar el contenido de archivos en el brief → Claude paga dos veces lo que agy lee gratis.
- Brief sin `<response>` → narración larga.
- Varias tareas chicas en llamadas separadas → cada llamada cuesta 2.000–24.000 tokens fijos de agy; agrúpalas.

## Lecciones
Una línea por lección, con fecha. Se agregan a mano o con aprobación del usuario.

- (vacío)
