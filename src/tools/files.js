import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { commandExists, runCommand } from "../lib/exec.js";
import { denyDeleteMessage, queueDestructive } from "../lib/policy.js";
import { assertInWorkspace, currentWorkspace, fileSnapshot, resolveUserPath } from "../lib/paths.js";
import { fail, json, ok } from "../lib/text.js";

export function registerFiles(server) {
  server.registerTool("read_file", {
    title: "Read file",
    description: "Read a file or list a directory inside a registered workspace. Binary content is returned as bounded base64.",
    inputSchema: {
      path: z.string(),
      maxBytes: z.number().int().min(1_024).max(1_000_000).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ path: input, maxBytes }) => {
    try { return json(fileSnapshot(resolveUserPath(input), { maxBytes: maxBytes ?? 200_000 })); }
    catch (error) { return fail(error.message); }
  });

  server.registerTool("search_text", {
    title: "Search text",
    description: "Read-only regex search across a workspace. Invokes the fixed `rg` executable with search-only arguments when available; if unavailable, uses a bounded literal-text fallback (never an untrusted JavaScript regex). Does not write or delete workspace files.",
    inputSchema: {
      pattern: z.string(),
      path: z.string().optional(),
      glob: z.string().optional(),
      maxMatches: z.number().int().min(1).max(200).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ pattern, path: input, glob, maxMatches }) => {
    try {
      const root = assertInWorkspace(input ? resolveUserPath(input) : currentWorkspace() || process.cwd());
      const limit = maxMatches ?? 40;
      return json(commandExists("rg") ? await searchWithRipgrep({ root, pattern, glob, limit }) : searchWithJavaScript({ root, pattern, glob, limit }));
    } catch (error) {
      return fail(error.message);
    }
  });

  server.registerTool("write_file", {
    title: "Write file",
    description: "Create or atomically overwrite a file inside a registered workspace. Creates parent directories; never deletes.",
    inputSchema: { path: z.string(), content: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ path: input, content }) => {
    try {
      const resolved = assertInWorkspace(resolveUserPath(input), { write: true });
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      if (fs.existsSync(resolved) && fs.statSync(resolved).size > 0 && content.length === 0) {
        const current = fs.readFileSync(resolved);
        return fail(denyDeleteMessage(queueDestructive({
          kind: "write_empty",
          summary: `truncate file to zero bytes: ${resolved}`,
          path: resolved,
          expectedSha256: sha256(current),
        })));
      }
      atomicWriteText(resolved, content);
      return ok(`wrote ${resolved} (${Buffer.byteLength(content)} bytes)`);
    } catch (error) {
      return fail(error.message);
    }
  });

  server.registerTool("apply_patch", {
    title: "Apply patch",
    description: "Check and apply a unified/git diff to one or more files. File deletion patches are previewed and require confirm_destructive.",
    inputSchema: {
      diff: z.string().min(1).max(500_000).describe("Unified diff / git-style patch"),
      cwd: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ diff, cwd }, extra) => {
    try {
      const root = assertInWorkspace(cwd ? resolveUserPath(cwd) : currentWorkspace() || process.cwd(), { write: true });
      if (patchDeletesFile(diff)) {
        const pending = queueDestructive({
          kind: "apply_patch_delete",
          summary: "patch would delete one or more files",
          cwd: root,
          diff,
          diffPreview: diff.slice(0, 4_000),
        });
        return fail(denyDeleteMessage(pending));
      }
      const gitApply = ["git", "-c", "core.autocrlf=false", "-c", "core.eol=lf", "apply"];
      const check = await runCommand([...gitApply, "--check", "--whitespace=nowarn", "-"], { cwd: root, shell: false, stdin: diff, signal: extra?.signal });
      if (!check.ok) return fail(check.stderr || check.stdout || "git apply --check failed");
      const result = await runCommand([...gitApply, "--whitespace=nowarn", "-"], { cwd: root, shell: false, stdin: diff, signal: extra?.signal });
      return result.ok ? ok(result.stdout || `applied patch in ${root}`) : fail(result.stderr || result.stdout || "git apply failed");
    } catch (error) {
      return fail(error.message);
    }
  });

  server.registerTool("edit_file", {
    title: "Edit file",
    description: "Replace an exact text occurrence in a file. By default the match must be unique; set replaceAll only when intentional.",
    inputSchema: {
      path: z.string(),
      oldText: z.string().min(1),
      newText: z.string(),
      replaceAll: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ path: input, oldText, newText, replaceAll = false }) => {
    try {
      const resolved = assertInWorkspace(resolveUserPath(input), { write: true });
      const current = fs.readFileSync(resolved, "utf8");
      const matches = countOccurrences(current, oldText);
      if (matches === 0) return fail(`oldText not found in ${resolved}`);
      if (!replaceAll && matches !== 1) return fail(`oldText matched ${matches} times in ${resolved}; provide a unique match or set replaceAll=true`);
      const next = replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, newText);
      if (current.length > 0 && next.length === 0) {
        return fail(denyDeleteMessage(queueDestructive({
          kind: "write_empty",
          summary: `edit would truncate file to zero bytes: ${resolved}`,
          path: resolved,
          expectedSha256: sha256(Buffer.from(current)),
        })));
      }
      atomicWriteText(resolved, next);
      return ok(`updated ${resolved} (${replaceAll ? matches : 1} replacement${matches === 1 ? "" : "s"})`);
    } catch (error) {
      return fail(error.message);
    }
  });
}

export function patchDeletesFile(diff) {
  return /^deleted file mode\b/m.test(diff)
    || /^\+\+\+\s+\/dev\/null\b/m.test(diff)
    || /^\+\+\+\s+NUL\b/im.test(diff);
}

async function searchWithRipgrep({ root, pattern, glob, limit }) {
  const args = ["--json", "--max-count", String(limit), "--max-filesize", "1M", "--hidden", "--glob", "!.git/**", "--glob", "!node_modules/**"];
  if (glob) args.push("--glob", glob);
  args.push(pattern, root);
  const result = await runCommand(["rg", ...args], { cwd: root, shell: false, timeoutMs: 30_000, maxStdout: 8 * 1024 * 1024, maxStderr: 16_000 });
  const hits = String(result.stdout || "").split("\n").filter(Boolean).flatMap((line) => {
    try {
      const row = JSON.parse(line);
      if (row.type !== "match") return [];
      return [{ path: row.data.path?.text, line: row.data.line_number, text: row.data.lines?.text?.trim() }];
    } catch { return []; }
  }).slice(0, limit);
  return { backend: "ripgrep", root, count: hits.length, hits, stderr: result.code > 1 || result.timedOut ? result.stderr : undefined };
}

function searchWithJavaScript({ root, pattern, glob, limit }) {
  const hits = [];
  const globRegex = glob ? globToRegExp(glob) : null;
  const walk = (dir) => {
    if (hits.length >= limit) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", ".venv", "__pycache__"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(full);
      else if (entry.isFile() && (!globRegex || globRegex.test(rel)) && entry.name !== ".DS_Store") {
        const stat = fs.statSync(full);
        if (stat.size > 1_000_000) continue;
        const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
        for (let index = 0; index < lines.length && hits.length < limit; index += 1) {
          if (lines[index].includes(pattern)) hits.push({ path: full, line: index + 1, text: lines[index].trim() });
        }
      }
      if (hits.length >= limit) break;
    }
  };
  walk(root);
  return { backend: "javascript-literal", note: "ripgrep unavailable; pattern was treated as literal text", root, count: hits.length, hits };
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function atomicWriteText(target, content) {
  const revalidated = assertInWorkspace(target, { write: true });
  if (revalidated !== target) throw new Error(`write path changed during validation: ${target}`);
  const mode = fs.existsSync(target) ? fs.statSync(target).mode : 0o644;
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, { mode });
  try { fs.renameSync(tmp, target); }
  catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    if (process.platform !== "win32") throw error;
    fs.writeFileSync(target, content, { mode });
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function countOccurrences(text, search) {
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(search, index)) !== -1) {
    count += 1;
    index += search.length;
  }
  return count;
}
