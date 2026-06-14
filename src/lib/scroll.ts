import Lenis from 'lenis'

let lenis: Lenis | null = null

export function initLenis() {
  lenis = new Lenis({
    // 1.0 (was 1.4) — the long 1.4s tail made wheel scrolling feel floaty
    // and laggy. A shorter duration tracks the wheel more tightly while
    // staying smooth.
    duration: 1.0,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation: 'vertical',
    smoothWheel: true,
    // Preserve native mobile scroll — momentum + safe-area handling are
    // better when we don't try to smooth the touch gesture ourselves.
    smoothTouch: false,
    // Don't hijack the wheel inside nested scroll containers (drawers,
    // modals) — those opt out with `data-lenis-prevent`, which lets their
    // native scroll run smoothly instead of fighting the page lerp.
    prevent: (node: Element) => node.closest('[data-lenis-prevent]') !== null,
  } as ConstructorParameters<typeof Lenis>[0])

  // NOTE: do NOT add a separate RAF loop here.
  // SmoothScroll.tsx drives lenis.raf() via gsap.ticker — one loop only.

  return lenis
}

export function getLenis() { return lenis }
