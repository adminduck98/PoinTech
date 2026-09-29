/**
 * The admin permission matrix exists twice and must not drift.
 *
 *   src/lib/auth.ts                        — decides what the UI shows
 *   supabase/functions/admin-api/index.ts  — decides what the server allows
 *
 * They cannot share a module: one is bundled by Vite for the browser, the other
 * by the Supabase CLI for Deno, and the edge function is deployed from its own
 * directory. Both files carry a comment asking the next person to keep them in
 * sync, which is exactly the kind of instruction that gets missed.
 *
 * Drift is not cosmetic. If the UI grants more than the server, users get
 * buttons that fail; if the server grants more than the UI, a capability is
 * reachable that nobody meant to expose — and that second direction is how the
 * "any signed-in employee could promote themselves" bug survived.
 *
 * This reads ROLE_PERMISSIONS out of both files with the TypeScript parser and
 * compares them, so a one-sided edit fails the suite instead of shipping.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { PROJECT_ROOT } from '../helpers/edge.mjs';

const expect = globalThis.__EXPECT__;
const section = globalThis.__SECTION__;

const FRONTEND = 'src/lib/auth.ts';
const EDGE = 'supabase/functions/admin-api/index.ts';

/**
 * Pull `ROLE_PERMISSIONS` out of a TypeScript source file as plain data.
 *
 * Deliberately AST-based rather than a regex or an import: neither file can be
 * imported from Node (one uses `import.meta.env`, the other Deno globals), and
 * a regex over nested object literals would be its own source of bugs.
 */
function readRoleMatrix(relativePath) {
  const full = path.join(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(full, 'utf8');
  const sourceFile = ts.createSourceFile(full, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);

  let node = null;
  const visit = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'ROLE_PERMISSIONS' &&
      n.initializer
    ) {
      node = n.initializer;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);

  if (!node) throw new Error(`ROLE_PERMISSIONS not found in ${relativePath}`);
  if (!ts.isObjectLiteralExpression(node)) {
    throw new Error(`ROLE_PERMISSIONS in ${relativePath} is not an object literal`);
  }

  const literalName = (name) =>
    ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;

  const readStringArray = (expr) => {
    if (!ts.isArrayLiteralExpression(expr)) {
      throw new Error(`expected an array literal in ${relativePath}`);
    }
    return expr.elements.map((el) => {
      if (!ts.isStringLiteral(el)) {
        throw new Error(`expected string literals in ${relativePath}`);
      }
      return el.text;
    });
  };

  const matrix = {};
  for (const roleProp of node.properties) {
    if (!ts.isPropertyAssignment(roleProp)) continue;
    const role = literalName(roleProp.name);
    if (!role || !ts.isObjectLiteralExpression(roleProp.initializer)) continue;

    const entry = {};
    for (const modeProp of roleProp.initializer.properties) {
      if (!ts.isPropertyAssignment(modeProp)) continue;
      const mode = literalName(modeProp.name);
      if (mode !== 'read' && mode !== 'write') continue;
      // Order is irrelevant to the meaning — compare as sets.
      entry[mode] = readStringArray(modeProp.initializer).sort();
    }
    matrix[role] = entry;
  }
  return matrix;
}

let frontend;
let edge;
let loadError = null;
try {
  frontend = readRoleMatrix(FRONTEND);
  edge = readRoleMatrix(EDGE);
} catch (err) {
  loadError = err;
}

section('обе копии матрицы читаются');
expect('ROLE_PERMISSIONS найден в обоих файлах', loadError === null, loadError?.message ?? '');

if (!loadError) {
  const frontendRoles = Object.keys(frontend).sort();
  const edgeRoles = Object.keys(edge).sort();

  expect(
    'набор ролей совпадает',
    JSON.stringify(frontendRoles) === JSON.stringify(edgeRoles),
    `UI: ${frontendRoles.join(', ')} | сервер: ${edgeRoles.join(', ')}`
  );

  expect('матрица не пустая', frontendRoles.length > 0, `ролей: ${frontendRoles.length}`);

  section('права каждой роли идентичны');
  for (const role of frontendRoles) {
    for (const mode of ['read', 'write']) {
      const ui = frontend[role]?.[mode] ?? [];
      const server = edge[role]?.[mode] ?? [];
      const same = JSON.stringify(ui) === JSON.stringify(server);

      // Name the direction of the drift: granting more on the server than the
      // UI shows is the dangerous one.
      const onlyServer = server.filter((c) => !ui.includes(c));
      const onlyUi = ui.filter((c) => !server.includes(c));
      const detail = same
        ? ''
        : [
            onlyServer.length ? `сервер разрешает лишнее: ${onlyServer.join(', ')}` : '',
            onlyUi.length ? `UI показывает лишнее: ${onlyUi.join(', ')}` : '',
          ].filter(Boolean).join(' | ');

      expect(`${role}.${mode}`, same, detail);
    }
  }
}
