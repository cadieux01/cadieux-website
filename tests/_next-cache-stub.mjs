// Stands in for `next/cache` under `node --test`. Installed by the resolve
// branch in _alias-hook.mjs; see the note there for why the real module
// cannot be loaded outside a bundler.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not cache. `unstable_cache`
// returns the function unchanged, so every call runs the wrapped work. That
// is the SAFE direction for a test — a stub that memoised would let a test
// pass on a stale answer and hide a second query that should have happened.
// Nothing asserted in this suite depends on caching, and any future test that
// does must drive the real Next runtime rather than lean on this file.
//
// Not named *.test.mjs, so the runner will not treat it as a suite.

/** Pass-through. Tag/revalidate options are accepted and ignored. */
export const unstable_cache = (fn) => fn;

/** No-op: there is no render cache in this process to invalidate. */
export const revalidateTag = () => {};

/** No-op, same reason. */
export const revalidatePath = () => {};
