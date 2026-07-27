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

    // Keep the exact callback reference so cleanup removes THIS function.
    // Previously cleanup passed a fresh anonymous fn to gsap.ticker.remove(),
    // which never matched the added one — so the ticker callback leaked and
    // accumulated on every remount/navigation.
    const tickerCallback = (time: number) => {
      lenis.raf(time * 1000)
    }
    gsap.ticker.add(tickerCallback)

    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(tickerCallback)
      const currentLenis = getLenis()
      if (currentLenis) {
        currentLenis.destroy()
      }
    }
  }, [])

  return null
}
