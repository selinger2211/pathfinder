import { readFileSync, writeFileSync } from 'fs';

const filePath = '.pathfinder-data/pf_preferences.json';
const outer = JSON.parse(readFileSync(filePath, 'utf8'));
const inner = JSON.parse(outer.value);

const newTitles = [
  "Staff Product Manager",
  "Senior Staff Product Manager",
  "Director, Product Management",
  "Sr. Director, Product Management",
  "Director, Product",
  "Senior Director, Product Management",
  "VP, Product Management",
  "SVP, Product",
  "Head of Product Management",
];

const existing = new Set(inner.targetTitles);
for (const t of newTitles) {
  if (!existing.has(t)) {
    inner.targetTitles.push(t);
  }
}

outer.value = JSON.stringify(inner);
outer.sizeBytes = Buffer.byteLength(outer.value, 'utf8');
outer.updatedAt = new Date().toISOString();

writeFileSync(filePath, JSON.stringify(outer, null, 2) + '\n');

console.log('Final targetTitles:');
inner.targetTitles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
console.log(`\nTotal: ${inner.targetTitles.length}`);
