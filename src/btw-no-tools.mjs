// PreToolUse hook for /btw side questions (src/btw.mjs): blocks every tool call. Exit code 2 = the call is denied and this
// text goes back to Claude. A hook does not change the system prompt or the tool list, so the side question can still reuse
// the chat's prompt cache (removing tools with --tools/--disallowedTools would not).
process.stderr.write('This is a side question (/btw): tools cannot be used. Answer from the conversation so far.');
process.exit(2);
