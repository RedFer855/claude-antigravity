// Puntos de control de git sin tocar el árbol de trabajo ni el índice del usuario.
// Un snapshot es un commit huérfano de rama (refs/agy/<id>) con el estado completo de la
// carpeta (incluye cambios sin commitear y archivos nuevos no ignorados), creado con un
// índice temporal. Así el diff de agy se mide contra el estado justo antes de delegar.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Sin conversión de fin de línea: el snapshot y la restauración deben ser byte a byte,
// o deshacer reescribiría archivos LF como CRLF (core.autocrlf=true en Windows).
// quotepath=false: los nombres con acentos salen tal cual y no como "\303\241", para poder compararlos.
function git(cwd, args, env) {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.quotepath=false", ...args], { cwd, env: env ? { ...process.env, ...env } : process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function isRepo(cwd) {
  try { return git(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true"; } catch { return false; }
}

// Raíz del repositorio. Los snapshots y los diffs son de todo el repo, así que sus rutas
// son relativas a esta raíz aunque `cwd` sea una subcarpeta.
export function raizRepo(cwd) {
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

function hasHead(cwd) {
  try { git(cwd, ["rev-parse", "--verify", "HEAD"]); return true; } catch { return false; }
}

export function snapshot(cwd, ref) {
  const dir = mkdtempSync(join(tmpdir(), "agy-idx-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    const head = hasHead(cwd);
    if (head) git(cwd, ["read-tree", "HEAD"], env);
    git(cwd, ["add", "-A"], env);
    const tree = git(cwd, ["write-tree"], env);
    const args = ["-c", "user.name=agy-bridge", "-c", "user.email=agy-bridge@local", "commit-tree", tree, "-m", ref];
    if (head) args.push("-p", "HEAD");
    const commit = git(cwd, args);
    git(cwd, ["update-ref", `refs/agy/${ref}`, commit]);
    return commit;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Cambios entre dos snapshots: por archivo, estado (A/M/D) y líneas agregadas (mas) y quitadas (menos),
// más los totales. Un archivo binario cuenta 0 líneas.
export function diffSummary(cwd, from, to) {
  const estados = git(cwd, ["diff", "--name-status", "--no-renames", from, to])
    .split(/\r?\n/).filter(Boolean)
    .map((l) => { const [estado, ...p] = l.split("\t"); return { estado, archivo: p.join("\t") }; });
  const lineas = new Map();
  for (const l of git(cwd, ["diff", "--numstat", "--no-renames", from, to]).split(/\r?\n/).filter(Boolean)) {
    const [mas, menos, ...p] = l.split("\t");
    lineas.set(p.join("\t"), [Number(mas) || 0, Number(menos) || 0]);
  }
  const archivos = estados.map((f) => {
    const [mas, menos] = lineas.get(f.archivo) ?? [0, 0];
    return { ...f, mas, menos };
  });
  return {
    archivos,
    inserciones: archivos.reduce((s, f) => s + f.mas, 0),
    borrados: archivos.reduce((s, f) => s + f.menos, 0),
  };
}

// ¿El archivo cambió después de la corrida de agy? Compara su contenido actual con el que quedó
// en el snapshot `to`. Si es distinto, alguien lo editó después y revertirlo pisaría ese trabajo.
function editadoDespues(top, to, estado, archivo) {
  const p = join(top, archivo);
  if (estado === "D") return existsSync(p); // agy lo borró y alguien lo volvió a crear
  if (!existsSync(p)) return estado === "M"; // lo borraron después; restaurarlo lo resucitaría
  try {
    return git(top, ["hash-object", "--", archivo]) !== git(top, ["rev-parse", `${to}:${archivo}`]);
  } catch {
    return true; // sin certeza, no se toca
  }
}

// Deshace lo que cambió entre `from` y `to`, dejando intactos otros cambios del usuario.
// - `archivos` (Set de rutas relativas a la raíz del repo): solo esos. Sin él, todo el diff.
// - Un archivo editado después de la corrida no se toca y se informa como conflicto, salvo `forzar`.
// Devuelve { revertidos, conflictos, omitidos } (rutas relativas a la raíz del repo).
export function undo(cwd, from, to, { archivos, forzar = false } = {}) {
  const top = raizRepo(cwd);
  const todos = diffSummary(top, from, to).archivos;
  const elegidos = archivos ? todos.filter((f) => archivos.has(f.archivo)) : todos;
  const omitidos = todos.filter((f) => !elegidos.includes(f)).map((f) => f.archivo);
  const revertidos = [];
  const conflictos = [];
  for (const { estado, archivo } of elegidos) {
    if (!forzar && editadoDespues(top, to, estado, archivo)) { conflictos.push(archivo); continue; }
    if (estado === "A") {
      const p = join(top, archivo);
      if (existsSync(p)) unlinkSync(p);
    } else {
      git(top, ["restore", `--source=${from}`, "--worktree", "--", archivo]);
    }
    revertidos.push(archivo);
  }
  return { revertidos, conflictos, omitidos };
}
