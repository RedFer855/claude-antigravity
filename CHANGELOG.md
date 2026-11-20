# Changelog

Todos los cambios importantes del plugin `agy` se anotan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen
[SemVer](https://semver.org/lang/es/): `0.x.y` para arreglos, `0.x.0` para funciones nuevas
y `1.0.0` cuando el contrato de los comandos y de los archivos de datos sea estable.

Para publicar: `npm run release -- minor` (o `patch`, `major`, `x.y.z`). Lo que esté en
`[Unreleased]` pasa a la versión nueva.

## [Unreleased]

### Added
- CI en GitHub Actions: pruebas en Windows, Linux y macOS (Node 20 y 24), verificación de versiones y manifiestos, y búsqueda de secretos con gitleaks. El único check obligatorio es `CI completo`.
- Flujo de releases: `npm run release` sube la versión en todos los archivos y el CHANGELOG, `npm run etiquetar` crea el tag y el workflow `release` publica el GitHub Release con estas notas.
- Dependabot para las acciones de GitHub, CODEOWNERS y plantilla de PR.
- `AGENTS.md` con las reglas del repositorio.

### Changed
- `npm test` del plugin usa `node --test` sin glob, para funcionar igual en Windows, Linux y macOS con Node 20 o más.

## [0.2.4] - 2026-11-19

### Added
- Primera publicación pública del plugin: comandos `/agy:delegar`, `/agy:cuota` y `/agy:permisos`, skills `delegacion` y `gemini-prompting`, y el runtime `agy-run.mjs` con revisión de cuota, puntos de control en git, guarda de secretos, permisos, verificación y registro de KPIs.
