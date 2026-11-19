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
function git(cwd, args, env) {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args], { cwd, env: env ? { ...process.env, ...env } : process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function isRepo(cwd) {
  try { return git(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true"; } catch { return false; }
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

// Cambios entre dos snapshots: archivos con estado (A/M/D) y totales de líneas.
export function diffSummary(cwd, from, to) {
  const files = git(cwd, ["diff", "--name-status", "--no-renames", from, to])
    .split(/\r?\n/).filter(Boolean)
    .map((l) => { const [estado, ...p] = l.split("\t"); return { estado, archivo: p.join("\t") }; });
  const short = git(cwd, ["diff", "--shortstat", from, to]);
  const n = (re) => Number(short.match(re)?.[1] ?? 0);
  return { archivos: files, inserciones: n(/(\d+) insertion/), borrados: n(/(\d+) deletion/) };
}

// Deshace solo lo que cambió entre `from` y `to`, dejando intactos otros cambios del usuario.
export function undo(cwd, from, to) {
  const { archivos } = diffSummary(cwd, from, to);
  for (const { estado, archivo } of archivos) {
    if (estado === "A") {
      const p = join(cwd, archivo);
      if (existsSync(p)) unlinkSync(p);
    } else {
      git(cwd, ["restore", `--source=${from}`, "--worktree", "--", archivo]);
    }
  }
  return archivos;
}
