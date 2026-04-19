'use client'

import { useEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { initLenis, getLenis } from '@/lib/scroll'

gsap.registerPlugin(ScrollTrigger)

export default function SmoothScroll() {
  useEffect(() => {
    const lenis = initLenis()

    lenis.on('scroll', ScrollTrigger.update)

    gsap.ticker.add((time) => {
      lenis.raf(time * 1000)
    })

    gsap.ticker.lagSmoothing(0)

    return () => {
      const currentLenis = getLenis()
      if (currentLenis) {
        currentLenis.destroy()
      }
      gsap.ticker.remove((time) => {
        currentLenis?.raf(time * 1000)
      })
    }
  }, [])

  return null
}
