// Shared Google Maps JS API loader options.
//
// `@react-google-maps/api` uses a singleton Loader under the hood, so
// calling `useJsApiLoader` / `useLoadScript` with *different* options
// (different ids or library arrays) from two pages of the same app
// throws "Loader must not be called again with different options".
//
// Every page that loads Google Maps must therefore import the same
// constants from here and pass them to the hook. The library array is
// a module-level constant so React/Effect dependency checks see a
// stable reference instead of a fresh array each render.

export const GOOGLE_MAPS_LOADER_ID = "cdx-google-maps-shared";

export const GOOGLE_MAPS_LIBRARIES: ("places" | "maps")[] = ["places", "maps"];
