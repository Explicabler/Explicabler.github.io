#!/usr/bin/env node
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] || '.';
const entries = readdirSync(root, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(root, d.name, 'index.html')));

const out = entries.map((d, i) => ({
  id: i + 1,
  slug: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  title: d.name.replace(/[_-]+/g, ' '),
  image: `/${encodeURIComponent(d.name)}/thumb.png`
}));

console.log(JSON.stringify(out, null, 2));
