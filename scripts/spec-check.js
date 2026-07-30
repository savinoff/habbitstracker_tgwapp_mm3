#!/usr/bin/env node
// spec-check.js
// Парсит docs/spec/**/*.md, собирает карту секций (file, qN).
// Грепает код (всё, что НЕ в docs/spec/) на маркеры `spec:path#qN`.
// Валит с ненулевым кодом, если:
//   - маркер ссылается на несуществующий файл;
//   - маркер ссылается на несуществующий qN в существующем файле;
//   - файл/секция в .md были переименованы/удалены, а в коде осталась старая ссылка.
//
// Запуск:
//   node scripts/spec-check.js          # проверить
//   node scripts/spec-check.js --list   # просто вывести карту
//
// spec:docs/spec/03-features/survey-morning.md#q2
// spec:04-data-model#q3
// spec:00-vision#q1

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SPEC_DIR = join(ROOT, 'docs', 'spec');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'web', 'server', 'data', 'backups', '.github', '.vscode', '.idea']);
const MARGIN_HEADING = /^##\s+q(\d+)\.\s+/;
const MARGIN_MARKER = /spec:([\w./-]+?)(?:\.md)?#q(\d+)/g;

function toPosix(p) {
  return p.split(sep).join('/');
}

async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(join(dir, e.name), acc);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

function specRel(absPath) {
  // docs/spec/03-features/survey-morning.md  ->  03-features/survey-morning
  return toPosix(relative(SPEC_DIR, absPath)).replace(/\.md$/, '');
}

function fileExists(absRoot, relPosix) {
  // relPosix может прийти как "03-features/survey-morning" или "docs/spec/...".
  // Нормализуем в путь от SPEC_DIR.
  let normalized = relPosix;
  normalized = normalized.replace(/^docs\/spec\//, '');
  normalized = normalized.replace(/\.md$/, '');
  return join(SPEC_DIR, normalized + '.md');
}

async function buildSpecMap() {
  const files = await walk(SPEC_DIR);
  const map = new Map(); // key: "<rel>#q<N>"  ->  { file, line, title }

  for (const abs of files) {
    const rel = specRel(abs);
    const text = await readFile(abs, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = MARGIN_HEADING.exec(lines[i]);
      if (!m) continue;
      const n = m[1];
      const title = lines[i].replace(MARGIN_HEADING, '').trim();
      map.set(`${rel}#q${n}`, { file: rel + '.md', line: i + 1, title });
    }
  }
  return { map, files: files.map(specRel) };
}

async function walkCode(acc = []) {
  // код — всё в репо, кроме docs/spec и SKIP_DIRS
  async function recurse(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await recurse(p);
      } else if (e.isFile()) {
        if (p.includes(`${sep}docs${sep}spec${sep}`)) continue;
        if (e.name.endsWith('.md') && !p.endsWith('README.md')) continue;
        acc.push(p);
      }
    }
  }
  await recurse(ROOT);
  return acc;
}

async function main() {
  const { map, files } = await buildSpecMap();
  const onlyList = process.argv.includes('--list');

  if (onlyList) {
    console.log(`Spec sections: ${map.size}`);
    for (const [k, v] of [...map.entries()].sort()) {
      console.log(`  ${k}  —  ${v.title}`);
    }
    console.log(`\nSpec files:`);
    for (const f of files.sort()) console.log(`  ${f}`);
    return;
  }

  const codeFiles = await walkCode();
  const errors = [];
  const warnings = [];
  const usedKeys = new Set();

  for (const abs of codeFiles) {
    const text = await readFile(abs, 'utf8');
    const lines = text.split(/\r?\n/);
    const rel = toPosix(relative(ROOT, abs));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      MARGIN_MARKER.lastIndex = 0;
      let m;
      while ((m = MARGIN_MARKER.exec(line)) !== null) {
        const filePart = m[1];
        const q = m[2];
        const absFile = fileExists(ROOT, filePart);
        const exists = await stat(absFile).then(() => true).catch(() => false);
        if (!exists) {
          errors.push(`${rel}:${i + 1} — spec file not found: ${filePart} (full: spec:${filePart}#q${q})`);
          continue;
        }
        // filePart уже без .md, нужно привести к ключу
        const relKey = filePart.replace(/^docs\/spec\//, '').replace(/\.md$/, '');
        const key = `${relKey}#q${q}`;
        usedKeys.add(key);
        if (!map.has(key)) {
          errors.push(`${rel}:${i + 1} — spec section not found: ${key}`);
        }
      }
    }
  }

  // Предупреждения: секции, на которые нет ссылок в коде (могут быть «архивные» или просто невостребованные).
  for (const key of map.keys()) {
    if (!usedKeys.has(key)) {
      warnings.push(`unused spec section: ${key}  (no code references it)`);
    }
  }

  console.log(`spec-check: scanned ${codeFiles.length} code files, ${map.size} spec sections.`);
  console.log(`spec-check: ${usedKeys.size} referenced, ${warnings.length} unreferenced.`);

  if (warnings.length) {
    console.log(`\nWarnings (non-fatal):`);
    for (const w of warnings) console.log(`  • ${w}`);
  }

  if (errors.length) {
    console.error(`\nErrors (${errors.length}):`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  console.log(`\n✓ spec-check passed.`);
}

main().catch((err) => {
  console.error('spec-check crashed:', err);
  process.exit(2);
});
