# Protected-path grants are one-shot tokens, UI-confirmed, inert headless

`dispatch_task(allowProtected: true)` could have been a plain boolean the worker
inherits, or a settings toggle. Instead each grant is a per-dispatch random token
(`PI_PROTECTED_GRANT`): minted only after the user confirms a dialog showing
role/workdir/title, honored only when the token looks valid AND the worker's mode
is locked via `--op-mode` (never in interactive sessions), and stripped from every
worker spawn's inherited env so a grant cannot leak to a second dispatch. In a
headless orchestrator the param is ignored and the hard block stands.

Chosen because a boolean or persistent setting fails open under prompt injection:
a hostile brief could request the flag, or a leaked env var would bless every
future worker. The token + UI-gate + env-strip trio makes each grant traceable to
one explicit human approval for one worker. The grant skips only the
protected-path block — the write fence and containment still apply.
