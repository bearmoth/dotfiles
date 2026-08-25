/**
 * Read-only bash command classification for EXPLORE mode.
 *
 * Strategy: fail closed.
 * 1. Reject any shell syntax we can't confidently reason about
 *    (redirection, command substitution, background jobs, subshells).
 * 2. Split the remaining input into simple commands on `|`, `&&`, `||`, `;`, newlines.
 * 3. Every simple command must match the read-only allowlist. Some commands
 *    are only read-only for certain subcommands (git, npm, docker, ...).
 */

export interface Verdict {
	readonly: boolean;
	reason: string;
}

const ro = (): Verdict => ({ readonly: true, reason: "" });
const no = (reason: string): Verdict => ({ readonly: false, reason });

// Unconditionally read-only commands (no argument inspection needed beyond redirects,
// which are rejected globally before we get here).
const SAFE_COMMANDS = new Set([
	"cat", "head", "tail", "less", "more", "bat",
	"grep", "egrep", "fgrep", "rg", "ag",
	"find", "fd", "locate",
	"ls", "eza", "exa", "tree", "pwd", "realpath", "readlink", "basename", "dirname",
	"file", "stat", "du", "df", "wc", "cksum", "md5", "md5sum", "shasum", "sha256sum",
	"echo", "printf", "true", "false", "test", "[", "seq", "yes",
	"sort", "uniq", "cut", "tr", "column", "comm", "join", "paste", "diff", "cmp", "strings", "xxd", "hexdump", "od", "nl", "rev", "fold", "expand", "unexpand",
	"jq", "yq", "awk",
	"which", "whereis", "type", "command", "env", "printenv", "hostname",
	"uname", "whoami", "id", "groups", "date", "cal", "uptime", "sw_vers", "arch", "nproc",
	"ps", "pgrep", "top", "lsof", "vm_stat", "free", "sysctl",
	"wc", "tput", "sleep", "time",
]);

// Commands read-only only for specific subcommands / flag shapes.
type SubRule = { sub: Set<string>; label: string };
const SUBCOMMAND_RULES: Record<string, SubRule> = {
	git: {
		label: "git",
		sub: new Set([
			"status", "log", "diff", "show", "branch", "tag", "remote", "blame",
			"describe", "shortlog", "reflog", "rev-parse", "rev-list", "ls-files",
			"ls-tree", "ls-remote", "cat-file", "grep", "count-objects", "cherry",
			"whatchanged", "name-rev", "merge-base", "var", "check-ignore", "stash",
		]),
	},
	npm: { label: "npm", sub: new Set(["ls", "list", "view", "info", "search", "outdated", "audit", "why", "explain", "root", "prefix", "config"]) },
	yarn: { label: "yarn", sub: new Set(["list", "info", "why", "audit"]) },
	pnpm: { label: "pnpm", sub: new Set(["ls", "list", "why", "outdated", "audit"]) },
	pip: { label: "pip", sub: new Set(["list", "show", "freeze", "check"]) },
	cargo: { label: "cargo", sub: new Set(["tree", "metadata", "search"]) },
	docker: { label: "docker", sub: new Set(["ps", "images", "inspect", "logs", "version", "info", "stats"]) },
	brew: { label: "brew", sub: new Set(["list", "info", "deps", "outdated", "search"]) },
	kubectl: { label: "kubectl", sub: new Set(["get", "describe", "logs", "version", "explain"]) },
	gh: { label: "gh", sub: new Set(["pr", "issue", "repo", "run", "api"]) }, // still gated below
};

// Reviewer-role extension: gh subcommand pairs that mutate only GitHub review
// state (never the working tree). Enabled via classify options, not by default.
const REVIEWER_GH_PAIRS = new Set(["pr review", "pr comment", "issue comment"]);

export interface ClassifyOptions {
	/** Allow the reviewer-role gh pairs (pr review/comment, issue comment). */
	reviewerGh?: boolean;
}

// Extra restrictions layered on subcommand rules.
function checkSubcommandExtras(cmd: string, args: string[], opts: ClassifyOptions): Verdict | undefined {
	if (cmd === "git") {
		// `git stash` alone mutates; only `git stash list/show` is read-only.
		if (args[0] === "stash" && !["list", "show"].includes(args[1] ?? "")) {
			return no("`git stash` mutates the working tree");
		}
		if (args[0] === "branch" && args.some((a) => /^-(d|D|m|M|c|C|f|u)$/.test(a) || a === "--delete" || a === "--move" || a === "--force")) {
			return no("`git branch` with mutation flags");
		}
		if (args[0] === "tag" && args.some((a) => a === "-d" || a === "-a" || a === "-f" || a === "--delete")) {
			return no("`git tag` with mutation flags");
		}
		if (args[0] === "remote" && args[1] && !["show", "-v", "get-url"].includes(args[1])) {
			return no("`git remote` subcommand may mutate config");
		}
		if (args[0] === "config" && !args.includes("--get") && !args.includes("--list") && !args.includes("-l")) {
			return no("`git config` may write config");
		}
	}
	if (cmd === "npm" && args[0] === "config" && args[1] !== "get" && args[1] !== "list") {
		return no("`npm config` may write config");
	}
	if (cmd === "gh") {
		const readonlyPairs = new Set(["pr list", "pr view", "pr diff", "pr status", "pr checks", "issue list", "issue view", "issue status", "repo view", "run list", "run view"]);
		const pair = `${args[0]} ${args[1]}`;
		if (readonlyPairs.has(pair)) return undefined;
		if (opts.reviewerGh && REVIEWER_GH_PAIRS.has(pair)) return undefined;
		return no("`gh` subcommand not classified as read-only");
	}
	return undefined;
}

// Skip git global options that appear before the subcommand, so
// `git -C /path status` classifies on `status`. Unknown pre-subcommand
// options are left in place and fail closed downstream.
function skipGitGlobalOptions(args: string[]): string[] {
	let i = 0;
	while (i < args.length) {
		const a = args[i];
		// NOTE: `-c <key>=<val>` is deliberately NOT skipped: it can inject
		// executable config (e.g. core.fsmonitor) — fail closed downstream.
		if (["-C", "--git-dir", "--work-tree"].includes(a)) {
			if (i + 1 >= args.length) return []; // option missing its argument: no subcommand
			i += 2;
		} else if (/^(--git-dir|--work-tree)=/.test(a) || a === "--no-pager" || a === "-P") {
			i += 1;
		} else {
			break;
		}
	}
	return args.slice(i);
}

// Redirections that provably cannot write files: /dev/null targets and fd duplication.
const SAFE_REDIRECTS = /\d?>>?\s*\/dev\/null|&>\s*\/dev\/null|\d?>&\d/g;

// Shell syntax we refuse to analyze — fail closed.
const FORBIDDEN_SYNTAX: Array<[RegExp, string]> = [
	[/(^|[^\\$<])>/, "output redirection can write files"],
	[/<<[^<]/, "heredocs are not analyzable"],
	[/\$\(/, "command substitution is not analyzable"],
	[/`/, "backtick substitution is not analyzable"],
	[/<\(/, "process substitution is not analyzable"],
	[/(^|[^&])&\s*($|;)/, "background jobs are not allowed"],
	[/^\s*\(|;\s*\(/, "subshells are not analyzable"],
	[/\beval\b|\bexec\b|\bsource\b|^\s*\.\s/, "shell evaluation is not analyzable"],
];

function stripQuotes(command: string): string {
	// Remove quoted string contents so metacharacter checks and splitting
	// don't trip on literals like grep "a > b".
	return command.replace(/'[^']*'/g, "''").replace(/"(\\.|[^"\\])*"/g, '""');
}

export function classifyBashCommand(command: string, opts: ClassifyOptions = {}): Verdict {
	const stripped = stripQuotes(command).replace(SAFE_REDIRECTS, " ");

	for (const [pattern, reason] of FORBIDDEN_SYNTAX) {
		if (pattern.test(stripped)) return no(reason);
	}

	// Split into simple commands.
	const segments = stripped
		.split(/\|\||&&|;|\||\n/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	if (segments.length === 0) return no("empty command");

	for (const segment of segments) {
		const words = segment.split(/\s+/);
		while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift(); // skip VAR=x prefixes
		let cmd = words[0] ?? "";
		let args = words.slice(1);

		// Unwrap benign prefixes.
		while (["command", "time", "nice"].includes(cmd) && args.length > 0) {
			cmd = args[0];
			args = args.slice(1);
		}
		cmd = cmd.replace(/^.*\//, ""); // strip path prefix

		// Model enumeration is read-only; keep the pi exception exact so no
		// other pi invocation can cross the classifier boundary.
		if (cmd === "pi") {
			if (args.length === 1 && args[0] === "--list-models") continue;
			return no("only `pi --list-models` is a read-only pi invocation");
		}

		if (cmd === "find" || cmd === "fd") {
			if (args.some((a) => ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-x", "--exec", "--exec-batch", "-X"].includes(a))) {
				return no("`find`/`fd` with delete/exec actions can mutate");
			}
			continue;
		}

		if (cmd === "xargs") {
			return no("`xargs` runs arbitrary commands");
		}

		if (SAFE_COMMANDS.has(cmd)) continue;

		// Web fetches: read-only when they neither send mutations nor write files.
		if (cmd === "curl") {
			const bad = args.find((a) =>
				/^(-X|--request|--method|-d|--data(-\w+)?|-F|--form|-T|--upload-file|-o|-O|--output(-dir)?|--remote-name(-all)?|-c|--cookie-jar|--create-dirs)$/.test(a) ||
				/^-[a-zA-Z]*[XdFTOo]/.test(a),
			);
			if (bad) return no(`\`curl ${bad}\` can mutate or write files`);
			continue;
		}
		if (cmd === "wget") {
			// Only allow streaming to stdout.
			const i = args.indexOf("-O");
			if (i === -1 || args[i + 1] !== "-") return no("`wget` writes files unless `-O -`");
			continue;
		}

		if (cmd === "sed") {
			if (args.includes("-i") || args.some((a) => a.startsWith("-i"))) return no("`sed -i` edits files in place");
			continue;
		}

		const rule = SUBCOMMAND_RULES[cmd];
		if (rule) {
			if (cmd === "git") args = skipGitGlobalOptions(args);
			const sub = args.find((a) => !a.startsWith("-")) ?? "";
			if (!rule.sub.has(sub)) return no(`\`${rule.label} ${sub || "(none)"}\` is not a read-only subcommand`);
			const extra = checkSubcommandExtras(cmd, args, opts);
			if (extra) return extra;
			continue;
		}

		return no(`\`${cmd}\` is not on the read-only allowlist`);
	}

	return ro();
}
