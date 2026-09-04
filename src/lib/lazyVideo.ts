// Deferred loading for the homepage's background videos.
//
// Every homepage <video> used to carry preload="auto", so all five files
// downloaded in full on page load — ~13.8 MB before the visitor had scrolled
// past the hero. Only the hero keeps preload="auto" (it is the LCP surface and
// must be ready immediately). The other four ship as preload="none" and are
// fetched by this ref, ~200px before they reach the viewport. All four already
// have a poster, so nothing is blank while the file loads.
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
};
