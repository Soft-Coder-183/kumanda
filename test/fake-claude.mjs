// A fake Claude Code for the tests: imitates the stream-json protocol of the real CLI (in the form seen on 2.1.x).
// Behaves by a keyword in the prompt: "permission" → asks for tool permission, "question" → AskUserQuestion,
// "long" → a long, slowly streaming reply (for interrupting), otherwise a short reply.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const arg = process.argv.slice(2);
const value = name => { const i = arg.indexOf(name); return i >= 0 ? arg[i + 1] : null; };
const session = value('--resume') || value('--session-id');
let mode = value('--permission-mode') === 'manual' ? 'default' : value('--permission-mode');
let effort = value('--effort') || 'setting';
const logDir = path.join(process.env.KUMANDA_CLAUDE_DIR, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'));
const transcript = path.join(logDir, `${session}.jsonl`);
fs.mkdirSync(logDir, { recursive: true });

const write = o => process.stdout.write(JSON.stringify(o) + '\n');
const record = o => fs.appendFileSync(transcript, JSON.stringify({ ...o, cwd: process.cwd(), sessionId: session, timestamp: new Date().toISOString() }) + '\n');
const wait = ms => new Promise(c => setTimeout(c, ms));
const waitingReplies = new Map();
let interrupted = false, counter = 0;

function assistant(content) {
  const usage = { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 1000, output_tokens: 50 }; // context: 1260
  const m = { type: 'assistant', message: { role: 'assistant', content, usage }, parent_tool_use_id: null, session_id: session };
  write(m); record(m);
}
function toolResult(id, text, error = false) {
  const m = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: error }] }, parent_tool_use_id: null, session_id: session };
  write(m); record(m);
}
async function streamText(text, delay = 0) {
  write({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null });
  for (const piece of text.match(/.{1,8}/gs) || []) {
    if (interrupted) return false;
    write({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } }, parent_tool_use_id: null });
    if (delay) await wait(delay);
  }
  assistant([{ type: 'text', text }]);
  return true;
}
function askPermission(name, input, extra = {}) {
  const request = `request-${++counter}`;
  const id = `toolu_${counter}`;
  assistant([{ type: 'tool_use', id, name, input }]);
  write({ type: 'control_request', request_id: request, request: { subtype: 'can_use_tool', tool_name: name, input, tool_use_id: id, ...extra } });
  return new Promise(resolve => waitingReplies.set(request, reply => resolve({ id, reply })));
}

async function turn(text) {
  interrupted = false;
  write({ type: 'system', subtype: 'init', session_id: session, model: 'claude-fake', permissionMode: mode, cwd: process.cwd() });
  // Like the real CLI: the reset times of the current windows come even when nothing is used up.
  const resets = Math.floor(Date.now() / 1000) + 3 * 3600;
  write({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: resets,
    unifiedWindows: { five_hour: { utilization: 0.25, resetsAt: resets }, seven_day: { utilization: 0.1, resetsAt: resets + 86400 } } } });
  record({ type: 'user', message: { role: 'user', content: text } });
  // The real CLI writes every API request to the transcript; Kumanda reads "the current effort" from there.
  record({ type: 'api-request', querySource: 'sdk', params: { model: 'claude-fake', output_config: { effort: effort === 'setting' ? 'medium' : effort } } });
  if (text.includes('permission')) {
    const command = /command:\s*(.+)$/m.exec(text)?.[1].trim() || 'echo hello'; // for the demo screenshots
    const { id, reply } = await askPermission('Bash', { command, description: 'Say hello' },
      { decision_reason: 'This command needs approval', permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: command }], behavior: 'allow', destination: 'localSettings' }] });
    if (reply.behavior === 'allow') { toolResult(id, 'hello'); await streamText(reply.updatedPermissions ? 'The command ran (rule saved).' : 'The command ran.'); }
    else { toolResult(id, reply.message, true); await streamText('The command was denied.'); }
  } else if (text.includes('question')) {
    const { id, reply } = await askPermission('AskUserQuestion', { questions: [{ question: 'Tea or coffee?', header: 'Drink', multiSelect: false, options: [{ label: 'Tea', description: 'Strong' }, { label: 'Coffee', description: 'Black' }] }] });
    const choice = reply.updatedInput?.answers?.['Tea or coffee?'] || '(no answer)';
    toolResult(id, `Answer: ${choice}`);
    await streamText(`Your choice: ${choice}`);
  } else if (text.includes('long')) {
    if (!(await streamText('word '.repeat(400), 25))) {
      const m = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null, session_id: session };
      write(m); record(m);
      write({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 5, session_id: session });
      return;
    }
  } else await streamText(`Reply: **${text}** (mode: ${mode}, effort: ${effort})`);
  write({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1234, total_cost_usd: 0.01, result: 'done', session_id: session });
}

let order = Promise.resolve();
// /btw side question (src/btw.mjs): one prompt from stdin, one JSON result; nothing is written to the transcript.
// If the flags are not as expected the reply says so (so the test catches it).
const btw = arg.includes('--no-session-persistence');
if (btw) {
  let input = '';
  process.stdin.setEncoding('utf8').on('data', v => { input += v; }).on('end', async () => {
    // Same tools as the chat (no --tools/--strict-mcp-config/--append-system-prompt, which would break the cache reuse);
    // tools blocked by a PreToolUse hook; the instruction is in front of the question.
    const settings = JSON.parse(value('--settings') || '{}');
    const right = arg.includes('--fork-session') && fs.existsSync(transcript) && settings.hooks?.PreToolUse?.[0]?.matcher === '*'
      && !arg.includes('--tools') && !arg.includes('--strict-mcp-config') && !arg.includes('--append-system-prompt')
      && input.startsWith('[Side question');
    const question = input.split('\n\n').pop().trim();
    if (question.includes('slow')) await wait(600);
    write(question.includes('explode')
      ? { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'The side question exploded' }
      : { type: 'result', subtype: 'success', is_error: false, result: right ? `Side reply: **${question}**` : 'Wrong flags' });
  });
} else readline.createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  const m = JSON.parse(line);
  if (m.type === 'user') {
    const text = m.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    order = order.then(() => turn(text));
  } else if (m.type === 'control_response') {
    const callback = waitingReplies.get(m.response.request_id);
    waitingReplies.delete(m.response.request_id);
    callback?.(m.response.response);
  } else if (m.type === 'control_request') {
    const r = m.request;
    if (r.subtype === 'interrupt') interrupted = true;
    if (r.subtype === 'set_permission_mode') mode = r.mode;
    if (r.subtype === 'apply_flag_settings' && 'effortLevel' in (r.settings || {})) effort = r.settings.effortLevel ?? 'setting'; // null = the user's setting
    if (r.subtype === 'set_permission_mode' && r.mode === 'bypassPermissions' && !arg.includes('--allow-dangerously-skip-permissions')) {
      write({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: 'bypass disabled' } });
    } else write({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: r.subtype === 'set_model' ? { model: `claude-${r.model}` } : {} } });
  }
}).on('close', () => order.then(() => process.exit(0)));
