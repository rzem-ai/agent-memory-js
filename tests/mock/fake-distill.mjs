// Stand-in for `claude -p` in hook stop tests: reads the excerpt on stdin and
// prints whatever FAKE_DISTILL_OUTPUT holds (default: two facts).
let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  stdin += chunk;
}
if (!stdin.includes("User:")) {
  process.stdout.write("NONE\n");
} else {
  process.stdout.write(process.env.FAKE_DISTILL_OUTPUT ?? '["Alex uses pnpm for angus2", "agent-memory.js is TypeScript"]');
}
