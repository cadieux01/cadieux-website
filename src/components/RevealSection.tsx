'use client'

import { useRef, useEffect, type ReactNode } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

type Direction = 'up' | 'left' | 'right' | 'down'

interface RevealSectionProps {
  children: ReactNode
  direction?: Direction
}

function getClipPaths(direction: Direction): { from: string; to: string } {
  switch (direction) {
    case 'up':
      return { from: 'inset(100% 0% 0% 0%)', to: 'inset(0% 0% 0% 0%)' }
    case 'down':
      return { from: 'inset(0% 0% 100% 0%)', to: 'inset(0% 0% 0% 0%)' }
    case 'left':
      return { from: 'inset(0% 100% 0% 0%)', to: 'inset(0% 0% 0% 0%)' }
    case 'right':
      return { from: 'inset(0% 0% 0% 100%)', to: 'inset(0% 0% 0% 0%)' }
  }
}

export default function RevealSection({ children, direction = 'up' }: RevealSectionProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const paths = getClipPaths(direction)

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { clipPath: paths.from },
        {
          clipPath: paths.to,
          duration: 1.2,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 85%',
            toggleActions: 'play none none none',
          },
        }
      )
    })

    return () => ctx.revert()
  }, [direction])

  return <div ref={ref}>{children}</div>
}
