// A fake VS Code for the tests: records its arguments in the test's data folder instead of opening a window.
import fs from 'node:fs';
import path from 'node:path';

fs.appendFileSync(path.join(process.env.KUMANDA_DATA, 'vscode-calls.jsonl'), JSON.stringify(process.argv.slice(2)) + '\n');
