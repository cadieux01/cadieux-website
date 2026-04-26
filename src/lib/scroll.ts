import Lenis from 'lenis'

let lenis: Lenis | null = null

export function initLenis() {
  lenis = new Lenis({
    duration: 1.4,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation: 'vertical',
    smoothWheel: true,
    // Preserve native mobile scroll — momentum + safe-area handling are
    // better when we don't try to smooth the touch gesture ourselves.
    smoothTouch: false,
  } as ConstructorParameters<typeof Lenis>[0])

  // NOTE: do NOT add a separate RAF loop here.
  // SmoothScroll.tsx drives lenis.raf() via gsap.ticker — one loop only.

  return lenis
}

export function getLenis() { return lenis }
