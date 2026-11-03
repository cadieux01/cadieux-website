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

    // `next/cache` → a local stub. lib/service-areas, a transitive import of
    // lib/order-checkout, calls `unstable_cache(…)` at MODULE scope, so the
    // real module has to load before any test body runs.
    //
    // It cannot. `next` ships no `exports` map, so ESM will not complete the
    // extensionless subpath; resolving it by hand to `next/cache.js` then
    // loads `server-only`, whose default entry THROWS outside a bundler; and
    // getting past that leaves `unstable_cache` undefined, because the shim
    // is CJS and Node's named-export detection cannot see through it. Three
    // failures deep for a wrapper nothing here is testing.
    //
    // So this is a substitution, not a resolution fix, and it is declared as
    // one. See tests/_next-cache-stub.mjs for what it does and does not do.
    // `server-only` is a marker package whose DEFAULT entry point throws on
    // load; the harmless `empty.js` is reached only under the `react-server`
    // export condition, which the bundler sets and plain Node does not. So
    // lib/admin-auth's deliberate `import "server-only"` guardrail exploded
    // with "This module cannot be imported from a Client Component module".
    //
    // Resolved to the same file the condition would have chosen, rather than
    // running the suite with `--conditions=react-server`, which would also
    // swap the React build out from under every other test. A test process IS
    // the server, so this is the honest branch of the two — and the guardrail
    // is unaffected, because it is the BUNDLER that enforces it.
    if (specifier === "server-only") {
      const target = path.join(SRC, "..", "node_modules", "server-only", "empty.js");
      if (fs.existsSync(target)) {
        return { url: pathToFileURL(target).href, shortCircuit: true };
      }
    }

    if (specifier === "next/cache") {
      const target = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "_next-cache-stub.mjs",
      );
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});
