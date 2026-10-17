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

import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(SRC, specifier.slice(2));
      // tsconfig resolves extensionless aliases to .ts/.tsx; this project's
      // @/lib/* are all .ts. Fall through to the bare path for anything that
      // already carries an extension.
      const target = path.extname(base) ? base : `${base}.ts`;
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }

    // Relative, extensionless specifier from inside a .ts module — e.g.
    // subscription-setup.ts's `./subscription-dates`. TypeScript omits the
    // extension; Node's ESM resolver requires it, so the import dies with
    // ERR_MODULE_NOT_FOUND naming a file that does exist, just as `.ts`.
    //
    // Same failure the `@/` branch above exists to prevent, reached by the
    // other import style. Guarded three ways — relative, extensionless,
    // parent is .ts — and only taken when the .ts file is really there, so
    // anything else still falls through to Node untouched.
    if (
      specifier.startsWith(".") &&
      !path.extname(specifier) &&
      context.parentURL?.startsWith("file:") &&
      context.parentURL.endsWith(".ts")
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const target = `${path.resolve(parentDir, specifier)}.ts`;
      if (fs.existsSync(target)) {
        return { url: pathToFileURL(target).href, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },
});
