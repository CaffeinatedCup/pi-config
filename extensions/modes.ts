/**
 * Modes Extension — /architect, /learn, /code
 *
 * A "mode" is four levers, only one of which is a prompt:
 *
 *   1. TOOL GATING   — pi.setActiveTools() removes declarations from the provider
 *                      request, so a gated tool cannot be called at all.
 *   2. PROMPT        — a `sections.mode` patch. Pi diffs prompt sections and sends
 *                      only the changed one, so switching modes costs a section
 *                      patch instead of a full-prompt cache miss. (Returning
 *                      `systemPrompt`, as pirate.ts does, replaces everything.)
 *   3. INTERCEPTION  — tool_call handlers block what gating cannot express:
 *                      mutating bash, writes outside the vault.
 *   4. UI + PERSISTENCE — footer status, /modes, appendEntry() so the mode
 *                      survives /reload and resume.
 *
 * Mode text lives in the system prompt, never as `[MODE ACTIVE]` user messages,
 * so there are no stale transcript messages to filter out on exit.
 *
 *   /architect  read-only planning; write tools gone, bash allowlisted
 *   /learn      Socratic vault companion; writes confined to the vault
 *   /code       default; every edit explained, no silent rewrites
 *   /modes      show the active mode and what it permits
 *   /mode <n>   jump to a mode by name
 *
 * ctrl+alt+m cycles code → architect → learn → code. Repeating a mode's own
 * command returns to /code.
 *
 * Vault root: --vault <path>, or PI_MODES_VAULT_DIR, default ~/vault.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

type ModeName = "code" | "architect" | "learn";

const MODE_ORDER: ModeName[] = ["code", "architect", "learn"];
const ENTRY_TYPE = "modes-state";

interface ModeSpec {
	name: ModeName;
	/** Footer text shown while the mode is active. Empty string clears it. */
	status: string;
	theme: "warning" | "accent" | "muted";
	/** Tools stripped from the recorded baseline. Anything else is left alone. */
	exclude: string[];
	/** One-line summary for /modes and the switch notification. */
	blurb: string;
	/** Body of the `<mode>` system prompt section. */
	instructions: (vaultDir: string) => string;
}

const MODES: Record<ModeName, ModeSpec> = {
	code: {
		name: "code",
		status: "",
		theme: "muted",
		exclude: [],
		blurb: "Full tool access. Every edit explained; no silent rewrites.",
		instructions: () => `MODE: code (implementation)

Rules specific to this mode:
- Say what you are about to change and why before each edit or write. One line per file.
- Keep edits small and surgical. If a change needs to replace more than ~40 lines, say so and get agreement first.
- Never rewrite a whole file to fix a localized problem; use \`edit\` for targeted replacements.
- Do not run \`git add\`, \`git commit\`, or other git write commands. The user manages git.
- After the last change, give a short recap grouped by file: path — what changed — why.
- No vibe coding. If you are unsure what a file does, read it before editing it.`,
	},
	architect: {
		name: "architect",
		status: "⏸ architect",
		theme: "warning",
		exclude: ["edit", "write", "powershell"],
		blurb: "Read-only. edit/write removed; bash limited to inspection commands.",
		instructions: () => `MODE: architect (read-only planning)

Hard constraints, enforced by tooling rather than by your goodwill:
- \`edit\` and \`write\` are unavailable. Do not attempt them, simulate them in a reply, or shell around them.
- \`bash\` accepts inspection commands only. Anything that touches files, processes, packages, or git state is refused.

How to work:
- Explore first. Read the actual files before proposing a design, and cite paths (and line numbers) for claims about the code.
- Ask clarifying questions when requirements are ambiguous, and name the ambiguity out loud.
- Present tradeoffs as tradeoffs: at least two options, each with what it costs and what it gives up.
- Separate what you verified in the code from what you are inferring.

Output format:
## Assessment
## Options
## Recommended plan
Plan:
1. First concrete step, naming the files it touches
2. Second step
...
## Open questions

Do not make changes. Describe them. The user switches to /code to implement.`,
	},
	learn: {
		name: "learn",
		status: "✎ learn",
		theme: "accent",
		exclude: ["powershell"],
		blurb: "Socratic vault companion. Writes confined to the vault directory.",
		instructions: (vaultDir) => `MODE: learn (Socratic co-working in an Obsidian vault)

Hard constraints:
- \`write\` and \`edit\` are refused for any path outside \`${vaultDir}\`. Everything this mode produces belongs there.
- \`bash\` accepts read-only commands only. Use \`write\` for notes; parent directories are created for you.

Your job is to build the user's understanding, not to be a faster search engine:
- Do not open with the answer. Start by asking what the user already thinks is true, then work from the gap.
- Ask one question at a time. Prefer questions that expose a misconception over questions that test recall.
- When an answer is partly right, affirm the correct part precisely, then target the wrong part. Do not grade the whole answer as "close."
- Use a worked example or analogy, then hand the problem back: vary it slightly and ask the user to apply it.
- If you explain for more than a paragraph unprompted, end with a question. Keep the user constructing.

Vault work:
- Before creating or restructuring a note, load the \`vault-notes\` skill and follow it. It defines the frontmatter, naming, and linking conventions, and has a concept-note template.
- Capture durable ideas as notes under \`${vaultDir}\` as Markdown.
- Link with [[wikilinks]] to specific notes you have actually confirmed exist. Do not invent links.
- When adding to an existing note, append a section; never rewrite a note wholesale.
- Keep notes atomic: one idea per note, written to stand alone.

Write only what has actually been established in the conversation. Do not dump your own lecture into the vault.`,
	},
};

// ---------------------------------------------------------------------------
// Read-only bash policy (architect + learn)
// ---------------------------------------------------------------------------

const SAFE_BINS = new Set([
	"ls", "cat", "head", "tail", "grep", "egrep", "fgrep", "rg", "find", "fd", "tree",
	"pwd", "stat", "wc", "file", "date", "echo", "printf", "which", "type", "env", "printenv",
	"du", "df", "sort", "uniq", "cut", "tr", "jq", "basename", "dirname", "realpath", "readlink",
	"uname", "whoami", "hostname", "uptime", "free", "ps", "diff", "comm", "column",
]);

/** Refused outright even though some look harmless: they write, execute, or reach the network. */
const NEVER_BINS = new Set([
	"rm", "mv", "cp", "mkdir", "rmdir", "touch", "ln", "tee", "dd", "chmod", "chown", "install",
	"sed", "awk", "perl", "python", "python2", "python3", "node", "deno", "ruby", "lua",
	"php", "bun", "bash", "sh", "zsh", "fish", "eval", "exec", "xargs", "sudo", "su", "doas",
	"kill", "pkill", "systemctl", "service", "mount", "umount", "reboot", "shutdown",
	"uv", "pip", "pip3", "cargo", "make", "cmake", "meson", "ninja",
	"docker", "podman", "kubectl", "tar", "zip", "unzip", "rsync", "curl", "wget", "ssh", "scp",
	"vi", "vim", "nvim", "emacs", "nano", "code", "less", "more",
]);

/** git verbs that are always inspection. */
const SAFE_GIT_VERBS = new Set([
	"status", "log", "diff", "show", "grep", "blame", "ls-files", "ls-tree", "rev-parse",
	"describe", "shortlog", "reflog", "cat-file", "version",
]);

/**
 * git verbs with both read-only and mutating forms. Allowed only with no
 * positional argument, so `git branch -a` passes but `git branch new-thing`
 * and `git tag v1.0` are refused.
 */
const GIT_LIST_ONLY = new Set(["branch", "tag", "remote"]);
const SAFE_GIT_LIST_FLAGS = new Set([
	"-a", "-r", "-v", "-vv", "-l", "-n", "-u", "-q", "--all", "--remotes", "--list",
	"--show-current", "--contains", "--no-merged", "--abbrev", "--verbose",
]);

/** find operators that execute programs or mutate. */
const FIND_WRITE_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprintf", "-fls"]);

/**
 * Flags that write a file, per binary. Scoped per binary on purpose: a global
 * `-o` rule would refuse `grep -o`, which only prints matches.
 */
const OUTPUT_FLAGS: Record<string, string[]> = {
	sort: ["-o", "--output"],
	uniq: ["--output"],
	jq: ["-M", "--output-file"],
	col: ["-o"],
	grep: ["--zgrep"],
};

/** Binaries whose verb decides read vs write, handled specially below. */
const VERB_BINS = new Set(["git", "npm", "pnpm", "yarn"]);

const SAFE_NPM_VERBS = new Set(["list", "ls", "outdated", "view", "info", "explain", "why", "audit", "doctor"]);

/** Blank out quoted regions so `grep "<div>" f` is not read as a redirect. */
function withoutQuotes(command: string): string {
	return command.replace(/'(?:[^']|\\')*'|"(?:[^"]|\\")*"/g, (match) => match.slice(0, 1) + "Q");
}

/** Flag name without any `=value` suffix. */
function flagBase(arg: string): string {
	return arg.split("=")[0]!;
}

function flagNameOf(args: string[]): string[] {
	return args.filter((a) => a.startsWith("-")).map(flagBase);
}

/**
 * Returns undefined when the command is inspection-only, otherwise the reason
 * it must be blocked. Deliberately conservative: an exotic-but-harmless command
 * gets refused, which is the right default for a read-only mode.
 *
 * This is a guardrail against the model wandering, not a sandbox against a
 * determined agent — real isolation needs a container (see gondolin example).
 */
function readOnlyBashRejection(command: string): string | undefined {
	const stripped = withoutQuotes(command);

	// Shell syntax that mutates state or hides a second command.
	if (/[<>]/.test(stripped)) return "output redirection";
	if (/\$\(|`/.test(stripped)) return "command substitution";
	if (/[(){}]/.test(stripped)) return "subshell or brace group";

	const segments = stripped.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
	if (segments.length === 0) return "empty command";

	for (const segment of segments) {
		const parts = segment.split(/\s+/).filter(Boolean);
		// Skip leading VAR=value assignments when finding the binary.
		let i = 0;
		while (i < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i]!)) i++;
		const bin = parts[i]?.split("/").pop();
		if (!bin) continue;
		const args = parts.slice(i + 1);

		if (NEVER_BINS.has(bin)) return `${bin} can mutate, execute, or reach the network`;

		if (bin === "find") {
			const action = args.find((a) => FIND_WRITE_ACTIONS.has(a));
			if (action) return `find ${action} executes or deletes`;
			continue;
		}

		if (VERB_BINS.has(bin)) {
			const verb = args.find((a) => !a.startsWith("-"));
			if (!verb) return `${bin} with no subcommand is not inspection`;
			if (bin === "git") {
				if (flagNameOf(args).some((f) => f.startsWith("--output"))) return `git ${verb} --output writes a file`;
				if (SAFE_GIT_VERBS.has(verb)) continue;
				if (GIT_LIST_ONLY.has(verb)) {
					const rest = args.slice(args.indexOf(verb) + 1);
					if (rest.some((a) => !a.startsWith("-"))) return `git ${verb} with an argument mutates`;
					if (rest.some((a) => !SAFE_GIT_LIST_FLAGS.has(flagBase(a)))) {
						return `git ${verb} with an unrecognized flag (${rest.join(" ")}) may mutate`;
					}
					continue;
				}
				return `git ${verb} is not a read-only subcommand`;
			}
			if (!SAFE_NPM_VERBS.has(verb)) return `${bin} ${verb} is not inspection-only`;
			continue;
		}

		if (!SAFE_BINS.has(bin)) return `${bin} is not on the read-only allowlist`;
		const writes = OUTPUT_FLAGS[bin] ?? [];
		const offender = args.find((a) => writes.includes(flagBase(a)));
		if (offender) return `${bin} ${offender} writes a file`;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PersistedState {
	mode?: ModeName;
	toolsBeforeModes?: string[];
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return path;
}

/** True when `target` is `root` or beneath it. Both arguments must be resolved. */
function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function modesExtension(pi: ExtensionAPI): void {
	let mode: ModeName = "code";
	let toolsBeforeModes: string[] | undefined;
	// Session cwd, so a relative --vault path resolves against where pi runs.
	let cwd = process.cwd();
	let vaultDir = expandHome(process.env.PI_MODES_VAULT_DIR ?? "~/vault");

	function vaultRoot(): string {
		return resolve(cwd, expandHome(vaultDir));
	}

	function spec(): ModeSpec {
		return MODES[mode];
	}

	function modeEnabled(): boolean {
		return mode !== "code";
	}

	function updateStatus(ctx: ExtensionContext): void {
		const current = spec();
		ctx.ui.setStatus("modes", current.status ? ctx.ui.theme.fg(current.theme, current.status) : undefined);
	}

	function persist(): void {
		pi.appendEntry(ENTRY_TYPE, { mode, toolsBeforeModes } satisfies PersistedState);
	}

	function toolNamesFor(target: ModeSpec): string[] {
		// Union of the recorded baseline and whatever is active right now, minus what
		// the mode forbids. The union matters because extensions can register tools
		// after session_start (pi.registerTool is valid in command handlers too); a
		// snapshot-only filter would silently drop those.
		const known = new Set([...(toolsBeforeModes ?? []), ...pi.getActiveTools()]);
		return [...known].filter((name) => !target.exclude.includes(name));
	}

	/** The only place the active tool set changes. */
	function applyMode(next: ModeName, ctx: ExtensionContext): void {
		if (!toolsBeforeModes) toolsBeforeModes = pi.getActiveTools();
		mode = next;
		pi.setActiveTools(toolNamesFor(MODES[next]));
		updateStatus(ctx);
		persist();
	}

	function announce(next: ModeName, previous: ModeName, ctx: ExtensionContext): void {
		const target = MODES[next];
		const lines = [next === previous ? `Mode: ${next}` : `Mode: ${previous} → ${next}`, target.blurb];
		if (target.exclude.length > 0) lines.push(`Removed tools: ${target.exclude.join(", ")}`);
		if (next === "learn") lines.push(`Vault: ${vaultRoot()}`);
		if (next === "architect") lines.push("Bash is limited to read-only inspection commands.");
		ctx.ui.notify(lines.join("\n"), next === "code" ? "info" : "warning");
	}

	function setMode(next: ModeName, ctx: ExtensionContext): void {
		// Repeating the active mode falls back to code.
		const target = next !== "code" && mode === next ? "code" : next;
		const previous = mode;
		applyMode(target, ctx);
		announce(target, previous, ctx);
	}

	for (const name of MODE_ORDER) {
		pi.registerCommand(name, {
			description: `${MODES[name].blurb}${name === "code" ? "" : " (repeat to return to code)"}`,
			handler: async (_args, ctx) => setMode(name, ctx),
		});
	}

	pi.registerCommand("mode", {
		description: "Switch mode by name: /mode code|architect|learn",
		getArgumentCompletions(prefix) {
			const items = MODE_ORDER.map((name) => ({ value: name, label: name, description: MODES[name].blurb }));
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const name = args.trim().toLowerCase();
			if (!MODE_ORDER.includes(name as ModeName)) {
				ctx.ui.notify(`Unknown mode "${args}". Choose: ${MODE_ORDER.join(", ")}`, "error");
				return;
			}
			setMode(name as ModeName, ctx);
		},
	});

	pi.registerCommand("modes", {
		description: "Show the active mode and what it permits",
		handler: async (_args, ctx) => {
			const active = pi.getActiveTools();
			const lines = MODE_ORDER.map((name) =>
				`${name === mode ? "→" : " "} ${name.padEnd(10)} ${MODES[name].blurb}`,
			);
			if (modeEnabled()) {
				lines.push("", `Active tools (${active.length}): ${active.join(", ")}`);
				if (mode === "learn") lines.push(`Vault: ${vaultRoot()}`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerShortcut("ctrl+alt+m", {
		description: "Cycle modes: code → architect → learn",
		handler: async (ctx) => {
			const next = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]!;
			const previous = mode;
			applyMode(next, ctx);
			announce(next, previous, ctx);
		},
	});

	pi.registerFlag("vault", {
		description: "Obsidian vault directory for learn mode",
		type: "string",
		default: "",
	});

	// --- Lever 2: the prompt patch ------------------------------------------
	// Only for user-initiated runs. Background custom messages would otherwise
	// re-inject the mode text on every notification.
	pi.on("before_agent_start", async (event) => {
		if (event.messageType !== "user") return;
		// `sections` starts each entry with no tag; Pi wraps it as <mode>…</mode>
		// and diffs it against what the model already has.
		event.systemPromptOptions.sections.mode = spec().instructions(vaultRoot());
	});

	// --- Lever 3: enforcement -----------------------------------------------
	// Paired with the prompt text above so the model's instructions can never
	// disagree with what the tool layer actually allows.
	pi.on("tool_call", async (event, ctx) => {
		const current = spec();

		// Defense in depth: gating already dropped these from the request. If one
		// arrives anyway, refuse it rather than trusting the client's tool list.
		if (current.exclude.includes(event.toolName)) {
			return {
				block: true,
				reason: `${mode} mode does not allow the ${event.toolName} tool. Describe the change instead, or ask the user to switch to /code.`,
			};
		}

		if (modeEnabled() && event.toolName === "bash") {
			const command = String((event.input as Record<string, unknown>).command ?? "");
			const rejected = readOnlyBashRejection(command);
			if (rejected) {
				return {
					block: true,
					reason: `${mode} mode allows inspection-only bash (${rejected}). Refused: \`${command}\`
Use read/grep/find/ls, or say what you needed and let the user switch to /code.`,
				};
			}
		}

		if (mode === "learn" && (event.toolName === "write" || event.toolName === "edit")) {
			const rawPath = String((event.input as Record<string, unknown>).path ?? "");
			const target = isAbsolute(rawPath) ? rawPath : resolve(ctx.cwd, rawPath);
			const vault = vaultRoot();
			if (!isInside(vault, resolve(target))) {
				return {
					block: true,
					reason: `learn mode writes only inside the vault (${vault}). Refused: ${target}
Keep notes in the vault. Describe changes to project code instead of making them, or ask for /code.`,
				};
			}
		}

		return undefined;
	});

	// --- Lever 4: restore ----------------------------------------------------
	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		const flag = pi.getFlag("vault");
		if (typeof flag === "string" && flag.trim()) vaultDir = expandHome(flag.trim());

		let restored: PersistedState | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE) restored = entry.data as PersistedState;
		}
		if (restored?.mode && MODE_ORDER.includes(restored.mode)) mode = restored.mode;
		toolsBeforeModes = restored?.toolsBeforeModes ?? pi.getActiveTools();

		// Applied unconditionally: in code mode this is a no-op re-set of the same
		// set, and it keeps a stale persisted exclusion list from surviving a resume.
		pi.setActiveTools(toolNamesFor(spec()));
		updateStatus(ctx);
	});
}
