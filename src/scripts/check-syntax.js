const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const failures = [];
let checked = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

    checked += 1;
    const result = spawnSync(process.execPath, ['--check', fullPath], {
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      failures.push({
        file: path.relative(root, fullPath),
        output: (result.stderr || result.stdout || 'unknown syntax error').trim(),
      });
    }
  }
}

walk(root);

if (failures.length) {
  console.error(`Syntax check failed: ${failures.length}/${checked}`);
  for (const failure of failures) {
    console.error(`\n--- ${failure.file} ---\n${failure.output}`);
  }
  process.exit(1);
}

console.log(`Syntax check passed: ${checked} JavaScript files`);
