import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_DIRECTORIES = [
  'web',
  'firestore/rules',
  'firestore/indexes',
  'firestore/seed',
  'sync',
  'shared',
  'tests',
  'docs',
];

const PRODUCTION_LIKE = /(^|[-_.])(prod|production)([-_.]|$)/i;

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }));
  return nested.flat();
}

export function assertDevelopmentEnvironment(config) {
  if (config.V2_ENVIRONMENT !== 'development' && config.V2_ENVIRONMENT !== 'staging') {
    throw new Error('V2_ENVIRONMENT must be development or staging.');
  }

  for (const [name, value] of Object.entries(config)) {
    if (name === 'V2_ENVIRONMENT' || typeof value !== 'string') continue;
    if (PRODUCTION_LIKE.test(value)) {
      throw new Error(`${name} contains a production-like value.`);
    }
  }
}

export async function findForbiddenProductionIdentifiers(v2Directory, identifiers) {
  const forbidden = identifiers.map((value) => value.trim()).filter(Boolean);
  if (forbidden.length === 0) return [];

  const matches = [];
  for (const file of await filesBelow(v2Directory)) {
    const contents = await readFile(file, 'utf8').catch(() => null);
    if (contents && forbidden.some((identifier) => contents.includes(identifier))) {
      matches.push(path.relative(v2Directory, file));
    }
  }
  return matches;
}

function parseEnvironment(contents) {
  return Object.fromEntries(contents
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
    }));
}

export async function validateV2Workspace(repositoryRoot, identifiers = []) {
  const v2Directory = path.join(repositoryRoot, 'v2');
  const errors = [];

  for (const directory of REQUIRED_DIRECTORIES) {
    await readdir(path.join(v2Directory, directory)).catch(() => {
      errors.push(`Missing required directory: v2/${directory}`);
    });
  }

  try {
    const template = await readFile(path.join(v2Directory, '.env.example'), 'utf8');
    assertDevelopmentEnvironment(parseEnvironment(template));
  } catch (error) {
    errors.push(error.message);
  }

  for (const match of await findForbiddenProductionIdentifiers(v2Directory, identifiers)) {
    errors.push(`Forbidden production identifier found in v2/${match}`);
  }

  return { errors };
}

async function main() {
  const repositoryRoot = path.resolve(process.argv[2] || '.');
  const identifiers = (process.env.V2_FORBIDDEN_PRODUCTION_IDS || '').split(/[\n,]/);
  const result = await validateV2Workspace(repositoryRoot, identifiers);
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log('V2 isolation guardrails passed.');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
