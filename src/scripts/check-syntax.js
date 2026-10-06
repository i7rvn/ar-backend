const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const failures = [];
let checked = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      checked += 1;
      const source = fs.readFileSync(fullPath, 'utf8');
      try {
        new Function('require', 'module', 'exports', source);
      } catch (err) {
        failures.push({ file: path.relative(root, fullPath), error: err.message });
      }
    }
  }
}

walk(root);

if (failures.length) {
  console.error(`Syntax check failed: ${failures.length}/${checked}`);
  for (const failure of failures) {
    console.error(`- ${failure.file}: ${failure.error}`);
  }
  process.exit(1);
}

console.log(`Syntax check passed: ${checked} JavaScript files`);
