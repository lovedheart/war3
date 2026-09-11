/**
 * CLI validator for data/*.json.
 *
 *   npx tsx tools/validate-data.ts            # human summary, exit 0 unless errors
 *   npx tsx tools/validate-data.ts --json     # machine-readable on stdout
 *   npx tsx tools/validate-data.ts --strict   # warnings also fail the run
 *
 * Exit codes: 0 clean · 1 validation errors (or warnings under --strict) · 2 unreadable input.
 */
import { loadRawTables } from '../src/data/load.js';
import { validateAll } from '../src/data/schema.js';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const strict = argv.includes('--strict');

let raw: ReturnType<typeof loadRawTables>;
try {
  raw = loadRawTables();
} catch (e) {
  console.error('FATAL: could not read data/*.json:', (e as Error).message);
  process.exit(2);
}

const { errors, warnings } = validateAll(raw);
const counts = {
  units: Object.keys(raw.units).length,
  buildings: Object.keys(raw.buildings).length,
  abilities: Object.keys(raw.abilities).length,
  items: Object.keys(raw.items).length + Object.keys(raw.recipes).length,
  tech: Object.keys(raw.tech).length,
  races: Object.keys(raw.races).length,
};

if (asJson) {
  process.stdout.write(JSON.stringify({ counts, errors, warnings }, null, 2) + '\n');
} else {
  console.log('data/*.json table sizes:', counts);
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
  if (errors.length) {
    console.log('\n--- ERRORS ---');
    for (const e of errors.slice(0, 100)) console.log('  ✗ ' + e);
    if (errors.length > 100) console.log(`  … ${errors.length - 100} more`);
  }
  if (warnings.length) {
    // Warnings are dominated by raw-SLK ability codes with no curated entry;
    // group them so the useful ones stay visible.
    const slk = warnings.filter((w) => w.includes('raw SLK code'));
    const other = warnings.filter((w) => !w.includes('raw SLK code'));
    console.log(`\n--- WARNINGS (${warnings.length}) ---`);
    console.log(`  • ${slk.length}× raw SLK ability codes not present in abilities.json (id-space mismatch, harmless)`);
    for (const w of other.slice(0, 60)) console.log('  ! ' + w);
    if (other.length > 60) console.log(`  … ${other.length - 60} more`);
  }
}

const fail = errors.length > 0 || (strict && warnings.length > 0);
process.exit(fail ? 1 : 0);
