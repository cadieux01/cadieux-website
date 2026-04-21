import Lenis from 'lenis'

let lenis: Lenis | null = null

export function initLenis() {
  lenis = new Lenis({
    duration: 0.9,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation: 'vertical',
    smoothWheel: true,
  })

  // NOTE: do NOT add a separate RAF loop here.
  // SmoothScroll.tsx drives lenis.raf() via gsap.ticker — one loop only.

  return lenis
}

export function getLenis() { return lenis }
