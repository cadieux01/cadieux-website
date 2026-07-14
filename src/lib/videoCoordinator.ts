// Guarantees at most one <video> is playing/decoding at a time.
//
// Mobile GPUs expose a small pool of hardware video decoders. The homepage
// stacks several full-bleed background videos in sticky sections that overlap
// (each section is pulled up with margin-top:-100vh), so as the user scrolls a
// seam two videos can be intersecting the viewport simultaneously — both would
// start decoding and the device drops frames. Routing every play() through
// here pauses whatever was playing before the new video starts, so decode
// never doubles up. A paused <video> stops decoding, which frees the decoder.

let current: HTMLVideoElement | null = null;

/** Play `el`, first pausing any other video this coordinator started. */
export function playExclusive(el: HTMLVideoElement): void {
  if (current && current !== el && !current.paused) {
    current.pause();
  }
  current = el;
  void el.play().catch(() => {});
}

/** Pause `el` (e.g. when it scrolls off-screen) and clear it if it was active. */
export function releaseVideo(el: HTMLVideoElement): void {
  if (!el.paused) el.pause();
  if (current === el) current = null;
}
