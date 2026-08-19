# Configuring Slack notifications for `/hstack:kernel-fit-scan` (consumer-side)

Reference file for `hstack-kernel-fit-scan`. Read it **only** when the engineer is
wiring Slack for the first time, or when a scan run reported a Slack auth /
channel / destination problem. It is not needed on a normal scan: the disk
artifact is canonical, and an unwired or unreachable Slack degrades gracefully
(log to stderr, exit 0).

Slack notifications are opt-in per consumer. Without wiring, the Skill still
works — findings land on disk and the engineer discovers them via
`/hstack:help`. To enable Slack nudges on `medium` / `high` confidence findings:

1. **Wire the MCP server.** Add the Slack MCP to your Claude Code MCP
   configuration so `mcp__claude_ai_Slack__slack_send_message` is callable from
   the session that runs `/hstack:kernel-fit-scan`. Follow Anthropic's Slack MCP
   install docs; the auth scope `chat:write` is required.

2. **Configure the destination channel.** Add a `kernel-fit` block to
   `hstack/config.yaml`:

   ```yaml
   kernel-fit:
     slack-channel: "#hstack-kernel-fit"   # public channel id or name; the bot must be invited
     slack-fallback: "dm"                  # "dm" | "off" — behavior when slack-channel is absent or unreachable
   ```

   `slack-channel` is optional. When absent and `slack-fallback: "dm"`, the Skill
   sends to the invoking engineer's DM via the bot. When `slack-fallback: "off"`,
   a missing channel behaves identically to an unreachable MCP (log to stderr,
   exit 0).

3. **Verify with a dry-run.** Run `/hstack:kernel-fit-scan --no-slack` first to
   confirm the detection layer produces output on your corpus, then re-run
   without the flag once Slack is wired. The first non-`--no-slack` run will
   surface any auth or channel issues as the documented graceful-degradation log
   line.

What you do NOT need to do: no code to write, no hook to install. The Skill is
prose-driven; the runtime LLM agent invokes the MCP when the tool is available in
the session and the config names a destination. The `{{TODO-MCP}}` placeholder in
the Skill's `tools` array is the framework convention naming the contract — the
consumer's MCP wiring satisfies it.
