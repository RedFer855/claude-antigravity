# AGENTS.md — claude-antigravity

> Contrato para cualquier agente de IA y para quien contribuya. Corto a propósito.

## Qué es

Plugin de Claude Code (`agy`) que delega trabajo a Antigravity CLI. Lo que se instala vive **solo** en
`agy-bridge/`; todo lo demás (`scripts/`, `.github/`, README, CHANGELOG) es del repositorio y no se distribuye.

## Reglas

1. **Repo público.** Nunca datos de proyectos privados, briefs ni respuestas reales de delegaciones, rutas de usuario
   (`C:\Users\...`), nombres de clientes ni secretos. gitleaks revisa, pero no basta: se revisa a mano antes de commitear.
2. **Cero dependencias.** El plugin usa solo Node (>= 20) y git. No se agrega ningún paquete npm.
3. **Pruebas.** Todo comportamiento nuevo del runtime lleva prueba con `node:test` en `agy-bridge/tests/`. Los fixtures
   de agy (`tests/fixtures/`) son salidas reales sin datos personales.
4. **Datos del usuario.** `tareas.jsonl`, `permisos-proyectos.json` y `reglas-aplicadas.json` viven en
   `CLAUDE_PLUGIN_DATA` y deben sobrevivir a una actualización. Si cambia el formato de alguno: campo `esquema` y migración
   que lea el formato anterior. Nunca se rompe el historial de quien ya lo usa.
5. **Versiones.** No se edita la versión a mano ni en un PR normal. La versión está en cuatro sitios y la mueve
   `npm run release -- <patch|minor|major|x.y.z>`; después `npm run etiquetar` crea el tag y el workflow `release`
   publica el GitHub Release. SemVer: `0.x.y` arreglos, `0.x.0` funciones, `1.0.0` cuando el contrato sea estable.
6. **CHANGELOG.** Cada PR anota su cambio en `[Unreleased]`; el release lo pasa a la versión nueva.
7. **Flujo de git.** GitHub Flow: todo entra a `main` por PR con *squash*, con el check `CI completo` en verde.
   Ramas `tipo/descripcion-corta`; Conventional Commits (`feat(runtime): …`, `fix(guarda): …`, `ci: …`).
8. **Redacción.** Español, directo, sin adornos. Fechas absolutas (AAAA-MM-DD). Los briefs que el plugin manda a agy
   van en inglés (ahorra tokens); la documentación para personas va en español, con README en los dos idiomas.

## Verificación

Antes de abrir el PR:

```bash
npm test                     # pruebas de scripts/ y de agy-bridge/ (las mismas que corre el CI)
npm run verificar            # versiones coherentes, CHANGELOG, manifiestos, frontmatter
```

## Mapa

| Ruta | Qué es |
| :-- | :-- |
| `agy-bridge/` | El plugin: comandos, skills, runtime (`scripts/agy-run.mjs`), permisos base y pruebas |
| `.claude-plugin/marketplace.json` | Entrada del marketplace; apunta a `./agy-bridge` |
| `scripts/` | Herramientas del repo: `verificar.mjs` y `release.mjs` (con sus pruebas) |
| `.github/workflows/` | `ci.yml` (check `CI completo`) y `release.yml` (publica al subir un tag `v*`) |
| `CHANGELOG.md` | Historial de versiones; de aquí salen las notas del release |
