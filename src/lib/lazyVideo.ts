// Deferred loading for the homepage's background videos.
//
// Every homepage <video> used to carry preload="auto", so all five files
// downloaded in full on page load — ~13.8 MB before the visitor had scrolled
// past the hero. All five are now deferred, but by two different triggers,
// because the hero is the one video that is already on screen at rest:
//   - The four background videos use this ref: preload="none", fetched never
//     before the visitor's first scroll and then ~200px before they reach the
//     viewport. Gating on scroll/intersection is right for them.
//   - The HERO defers on requestIdleCallback instead (see the effect in
//     PageContent.tsx). It must NOT use this ref — a visitor who never scrolls
//     would never see it play. The earlier note here claimed the hero had to
//     keep preload="auto" as "the LCP surface"; that was wrong. LCP is the
//     headline text, measured at 1,592 ms, and the video is not on its path.
// All five have a poster, so nothing is blank while the file loads.
//
// The `autoplay` ATTRIBUTE must NOT be set on a deferred video: it tells the
// browser to start playback as soon as possible, which starts the download and
// defeats preload="none". play() is called from here instead, at the moment the
// source is actually fetched.
//
// Once a video has loaded it is left alone — it plays for the life of the page
// and is never paused, on-screen or off. That is the existing behaviour and the
// only thing that changes here is WHEN the bytes are fetched.

const bound = new WeakSet<HTMLVideoElement>();

// How early a video starts loading, in px of scroll distance from the viewport.
const ROOT_MARGIN = "200px 0px";

// The look-ahead above is unconditionally satisfied by the section directly
// under the hero: it begins at exactly one viewport height, so `top < vh + 200`
// is true at rest and its observer fired on mount — measured at 1,504,461 B of
// product-video-06.mp4 fetched on a homepage load with no scroll at all.
//
// Shrinking ROOT_MARGIN would fix that one section and lose the pre-roll for
// every other. Gating on the first scroll keeps the 200px look-ahead for all of
// them and still fetches nothing until the visitor actually moves.
let scrolled = typeof window !== "undefined" && window.scrollY > 0;
const waiting: (() => void)[] = [];

function onFirstScroll(fn: () => void) {
  // Already scrolled (back-navigation restores the offset before we mount).
  if (scrolled) {
    fn();
    return;
  }
  waiting.push(fn);
  if (waiting.length > 1) return;
  const fire = () => {
    scrolled = true;
    window.removeEventListener("scroll", fire);
    while (waiting.length) waiting.shift()!();
  };
  window.addEventListener("scroll", fire, { passive: true });
}

/* React ref callback. Attach to any background video that ships with
   preload="none" and no autoplay attribute. */
export const lazyPlayOnEnter = (el: HTMLVideoElement | null) => {
  // React calls a ref with null on unmount and re-invokes it on re-render;
  // without this guard each render would attach another observer.
  if (!el || bound.has(el)) return;
  bound.add(el);

  const play = () => {
    // muted right before play() — a muted video is always allowed to autoplay,
    // an unmuted one is blocked and the browser then shows its controls.
    el.muted = true;
    void el.play().catch(() => {});
  };

  const load = () => {
    el.addEventListener("canplay", play);
    el.addEventListener("loadeddata", play);
    // Flip preload BEFORE load() so the fetch buffers the whole file rather
    // than stopping at metadata.
    el.preload = "auto";
    el.load();
    play();
  };

  // No IntersectionObserver (very old browser) — load straight away rather
  // than leave the section showing a still poster forever.
  if (typeof IntersectionObserver !== "function") {
    load();
    return;
  }

  onFirstScroll(() => {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        // One-shot: disconnect before loading so a scroll-out/scroll-in can
        // never restart the fetch or reset playback.
        io.disconnect();
        load();
      },
      { rootMargin: ROOT_MARGIN },
    );
    io.observe(el);
  });
};
