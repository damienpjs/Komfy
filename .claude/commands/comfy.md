---
description: Launch the ComfyUI server (the Tailscale instance the Komfy app consumes)
argument-hint: "[sdpa|split|subquad] [local]"
---

Launch Komfy's ComfyUI server using the **comfy-server** subagent.

The canonical launch is `scripts/start-comfy.sh` (also `npm run comfy`). It
resolves the Tailscale IP itself and encodes the machine's tuned flags — do
**not** rebuild the command by hand unless the script is missing.

Because the script `exec`s ComfyUI in the **foreground**, run it in the
background and capture the log, then run the agent's checks:

- Tailscale is up (`tailscale status`);
- no instance already listening on the port before launch;
- after launch, `curl http://$(tailscale ip -4):<port>/queue` answers.

Pass these arguments straight through to the script: $ARGUMENTS
(e.g. `split` for the memory-saving backend, `sdpa local` to bind 127.0.0.1).

Never expose the server outside the tailnet (see CLAUDE.md §Security).
