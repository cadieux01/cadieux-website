// Resolves the `@/…` tsconfig path alias for `node --test`.
//
// The test runner has no bundler, so a test importing any module that uses
// the project's own alias dies with ERR_MODULE_NOT_FOUND on the IMPORT, not
// on anything the test is actually asserting. Mapping it here keeps the
// source files on the repo-wide convention instead of making modules use
// relative paths purely so they can be tested.
//
// Not named *.test.mjs, so `node --test "tests/**/*.test.mjs"` will not try
// to run it as a suite.

import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const base = path.join(SRC, specifier.slice(2));
    // tsconfig resolves extensionless aliases to .ts/.tsx; this project's
    // @/lib/* are all .ts. Fall through to the bare path for anything that
    // already carries an extension.
    const target = path.extname(base) ? base : `${base}.ts`;
    return { url: pathToFileURL(target).href, shortCircuit: true };
  },
});
