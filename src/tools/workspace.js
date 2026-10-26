import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { runCommand } from "../lib/exec.js";
import { ALLOW_TOOL_ROOT_REGISTRATION, loadState, saveState, workspaceRoots } from "../lib/config.js";
import { assertAllowed, assertInRegisteredRoots, canonicalPath, currentWorkspace, resolveUserPath, walkTree } from "../lib/paths.js";
import { fail, json, ok } from "../lib/text.js";

export function registerWorkspace(server) {
  server.registerTool("workspace_list", {
    title: "List workspaces",
    description: "List registered project roots and the current workspace.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => json({ current: currentWorkspace() || null, roots: workspaceRoots(), home: os.homedir() }));

  server.registerTool("workspace_open", {
    title: "Open workspace",
    description: "Set the current project directory used as the default cwd for file, git, project, and shell tools.",
    inputSchema: { path: z.string().describe("Absolute, relative-to-current, or ~ path to a project directory") },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ path: input }) => {
    try {
      const resolved = assertInRegisteredRoots(resolveUserPath(input));
      if (!fs.statSync(resolved).isDirectory()) return fail(`${resolved} is not a directory`);
      const state = loadState();
      state.currentWorkspace = canonicalPath(resolved);
      saveState(state);
      return ok(`current workspace = ${state.currentWorkspace}`);
    } catch (error) {
      return fail(error.message);
    }
  });

  server.registerTool("workspace_add_root", {
    title: "Add workspace root",
    description: "Register an extra directory tree the agent may read and edit. Registration persists in bridge state.",
    inputSchema: { path: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ path: input }) => {
    try {
      if (!ALLOW_TOOL_ROOT_REGISTRATION) {
        return fail("workspace_add_root is disabled by default because it expands agent authority. Add the path to WORKSPACE_ROOTS in .env, or set ALLOW_TOOL_ROOT_REGISTRATION=true intentionally.");
      }
      const resolved = assertAllowed(resolveUserPath(input));
      if (!fs.statSync(resolved).isDirectory()) return fail(`${resolved} is not a directory`);
      const state = loadState();
      state.extraRoots = [...new Set([...(state.extraRoots || []), canonicalPath(resolved)])];
      saveState(state);
      return json({ extraRoots: state.extraRoots });
    } catch (error) {
      return fail(error.message);
    }
  });

  server.registerTool("workspace_tree", {
    title: "Workspace tree",
    description: "Bounded project tree snapshot; skips .git, node_modules, virtualenvs, and does not follow symlink directories.",
    inputSchema: {
      path: z.string().optional().describe("Directory to list. Defaults to current workspace."),
      maxDepth: z.number().int().min(1).max(8).optional(),
      maxEntries: z.number().int().min(10).max(2_000).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ path: input, maxDepth, maxEntries } = {}) => {
    try {
      const root = input ? resolveUserPath(input) : currentWorkspace();
      if (!root) return fail("no current workspace — call workspace_open first or pass path");
      return json(walkTree(root, { maxDepth: maxDepth ?? 3, maxEntries: maxEntries ?? 400 }));
    } catch (error) {
      return fail(error.message);
    }
  });

  server.registerTool("workspace_snapshot", {
    title: "Workspace snapshot",
    description: "Read-only high-level snapshot of the current workspace, Git HEAD/branch/status, package metadata, and top-level files. Uses only read-only Git queries; does not modify the repository or workspace.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    try {
      const root = currentWorkspace();
      if (!root) return fail("no current workspace — call workspace_open first");
      const top = fs.readdirSync(root).filter((name) => name !== ".DS_Store").sort().slice(0, 100);
      const pkgPath = path.join(root, "package.json");
      let pkg = null;
      if (fs.existsSync(pkgPath)) {
        const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        pkg = { name: parsed.name || null, version: parsed.version || null, scripts: Object.keys(parsed.scripts || {}) };
      }
      const git = await gitSnapshot(root);
      return json({ path: root, top, package: pkg, git });
    } catch (error) {
      return fail(error.message);
    }
  });
}

async function gitSnapshot(root) {
  if (!fs.existsSync(path.join(root, ".git"))) return { repository: false };
  const [head, branch, status] = await Promise.all([
    runCommand(["git", "rev-parse", "--short", "HEAD"], { cwd: root, shell: false, timeoutMs: 10_000, maxStdout: 16_000, maxStderr: 16_000 }),
    runCommand(["git", "branch", "--show-current"], { cwd: root, shell: false, timeoutMs: 10_000, maxStdout: 16_000, maxStderr: 16_000 }),
    runCommand(["git", "status", "--short"], { cwd: root, shell: false, timeoutMs: 10_000, maxStdout: 1_000_000, maxStderr: 16_000 }),
  ]);
  return {
    repository: true,
    head: head.ok ? head.stdout.trim() : null,
    branch: branch.ok ? branch.stdout.trim() : null,
    dirty: Boolean(status.stdout.trim()),
    status: status.stdout.split(/\r?\n/).filter(Boolean).slice(0, 100),
  };
}
