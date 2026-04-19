import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

type Direction = 'up' | 'left' | 'right' | 'down'

function getClipPaths(direction: Direction): { from: string; to: string } {
  switch (direction) {
    case 'up':
      return {
        from: 'inset(100% 0% 0% 0%)',
        to: 'inset(0% 0% 0% 0%)',
      }
    case 'down':
      return {
        from: 'inset(0% 0% 100% 0%)',
        to: 'inset(0% 0% 0% 0%)',
      }
    case 'left':
      return {
        from: 'inset(0% 100% 0% 0%)',
        to: 'inset(0% 0% 0% 0%)',
      }
    case 'right':
      return {
        from: 'inset(0% 0% 0% 100%)',
        to: 'inset(0% 0% 0% 0%)',
      }
  }
}

export function revealMask(element: HTMLElement, direction: Direction) {
  const paths = getClipPaths(direction)

  gsap.fromTo(
    element,
    { clipPath: paths.from },
    {
      clipPath: paths.to,
      duration: 1.2,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: element,
        start: 'top 85%',
        toggleActions: 'play none none none',
      },
    }
  )
}

export function parallaxLayer(element: HTMLElement, speed: number) {
  gsap.to(element, {
    y: speed * 100,
    ease: 'none',
    scrollTrigger: {
      trigger: element,
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
    },
  })
}

export function cameraShake(intensity: number) {
  const tl = gsap.timeline()

  tl.to(document.body, {
    x: intensity,
    y: intensity * 0.5,
    duration: 0.05,
    ease: 'power1.inOut',
  })
    .to(document.body, {
      x: -intensity,
      y: -intensity * 0.7,
      duration: 0.05,
      ease: 'power1.inOut',
    })
    .to(document.body, {
      x: intensity * 0.6,
      y: intensity * 0.3,
      duration: 0.05,
      ease: 'power1.inOut',
    })
    .to(document.body, {
      x: -intensity * 0.3,
      y: -intensity * 0.2,
      duration: 0.05,
      ease: 'power1.inOut',
    })
    .to(document.body, {
      x: 0,
      y: 0,
      duration: 0.08,
      ease: 'power2.out',
    })

  return tl
}

export function scatterText(chars: HTMLElement[], origin: { x: number; y: number }) {
  chars.forEach((char) => {
    const rect = char.getBoundingClientRect()
    const charCenterX = rect.left + rect.width / 2
    const charCenterY = rect.top + rect.height / 2

    const dx = charCenterX - origin.x
    const dy = charCenterY - origin.y
    const angle = Math.atan2(dy, dx)
    const distance = 80 + Math.random() * 200
    const rotation = (Math.random() - 0.5) * 720

    gsap.to(char, {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      rotation,
      opacity: 0,
      duration: 0.6 + Math.random() * 0.4,
      ease: 'power3.out',
    })
  })
}

export function shaderDistort(element: HTMLElement, intensity: number, duration: number) {
  const tl = gsap.timeline()

  tl.to(element, {
    filter: `blur(${intensity}px)`,
    duration: duration * 0.4,
    ease: 'power2.in',
  }).to(element, {
    filter: 'blur(0px)',
    duration: duration * 0.6,
    ease: 'power2.out',
  })

  return tl
}
