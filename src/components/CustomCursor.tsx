'use client'

import { useEffect, useRef, useState } from 'react'

// Inner gold dot tracks the pointer 1:1; the outer ring eases (lags) behind it,
// giving the elastic "dough" trail. Hovering a clickable grows the ring / shrinks
// the dot; clicking pulses the ring. All of that is driven on ONE
// requestAnimationFrame loop writing `transform: translate3d()` straight to the
// DOM via refs — never animating left/top (layout) and never re-rendering React
// on mousemove. This is the GPU-composited, 60fps version of the prior
// gsap + left/top implementation; the look is intentionally identical.
const INNER = 8
const OUTER = 36

export default function CustomCursor() {
  const innerRef = useRef<HTMLDivElement>(null)
  const outerRef = useRef<HTMLDivElement>(null)
  const [isTouchDevice, setIsTouchDevice] = useState(false)

  useEffect(() => {
    // Disable entirely on touch / no-hover devices — they use the native cursor.
    const mediaQuery = window.matchMedia('(hover: none)')
    if (mediaQuery.matches) {
      setIsTouchDevice(true)
      return
    }

    const inner = innerRef.current
    const outer = outerRef.current
    if (!inner || !outer) return

    // Raw pointer target (updated in mousemove only — no math, no layout reads).
    let tx = 0
    let ty = 0
    // Outer ring eased position (trails the target).
    let ox = 0
    let oy = 0
    // Eased scales. Targets flip on hover/leave/click; the loop springs to them.
    let innerScale = 1
    let outerScale = 1
    let innerTarget = 1
    let outerTarget = 1

    let visible = false
    let started = false

    // Easing factors (per frame @60fps). POS_K reproduces the old ~0.15s
    // power2.out ring lag; SCALE_K the ~0.3s hover/scale tween.
    const POS_K = 0.18
    const SCALE_K = 0.22

    const write = () => {
      // No offsetWidth/Height reads — sizes are known constants, so the loop
      // never touches layout. translate3d keeps both elements GPU-composited.
      inner.style.transform =
        `translate3d(${tx - INNER / 2}px, ${ty - INNER / 2}px, 0) scale(${innerScale})`
      outer.style.transform =
        `translate3d(${ox - OUTER / 2}px, ${oy - OUTER / 2}px, 0) scale(${outerScale})`
    }

    let rafId = 0
    let running = false
    const frame = () => {
      // Inner dot tracks the pointer exactly (1 frame coalesced, like before).
      // Outer ring eases toward it → elastic trail.
      ox += (tx - ox) * POS_K
      oy += (ty - oy) * POS_K
      innerScale += (innerTarget - innerScale) * SCALE_K
      outerScale += (outerTarget - outerScale) * SCALE_K

      const settled =
        Math.abs(tx - ox) < 0.1 &&
        Math.abs(ty - oy) < 0.1 &&
        Math.abs(innerTarget - innerScale) < 0.001 &&
        Math.abs(outerTarget - outerScale) < 0.001

      if (settled) {
        ox = tx
        oy = ty
        innerScale = innerTarget
        outerScale = outerTarget
        write()
        running = false
        rafId = 0
        return
      }

      write()
      rafId = requestAnimationFrame(frame)
    }

    const ensureLoop = () => {
      if (!running) {
        running = true
        rafId = requestAnimationFrame(frame)
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      tx = e.clientX
      ty = e.clientY
      if (!started) {
        // First move: jump the ring to the pointer so it doesn't slide in
        // from the corner, then reveal both.
        started = true
        ox = tx
        oy = ty
      }
      if (!visible) {
        visible = true
        inner.style.opacity = '1'
        outer.style.opacity = '1'
      }
      ensureLoop()
    }

    const onMouseEnter = () => {
      outerTarget = 2.2
      innerTarget = 0.4
      ensureLoop()
    }

    const onMouseLeave = () => {
      outerTarget = 1
      innerTarget = 1
      ensureLoop()
    }

    let clickTimer: number | undefined
    const onClick = () => {
      outerTarget = 0.8
      ensureLoop()
      if (clickTimer !== undefined) window.clearTimeout(clickTimer)
      clickTimer = window.setTimeout(() => {
        // Restore to whatever state the ring should rest in (hover vs idle).
        outerTarget = innerTarget === 0.4 ? 2.2 : 1
        ensureLoop()
      }, 120)
    }

    let currentClickables: NodeListOf<Element> | Element[] = []
    const addClickableListeners = () => {
      const clickables = document.querySelectorAll('button, a, [data-char]')
      clickables.forEach((el) => {
        el.addEventListener('mouseenter', onMouseEnter)
        el.addEventListener('mouseleave', onMouseLeave)
      })
      currentClickables = clickables
      return clickables
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('click', onClick)
    addClickableListeners()

    // Debounce MutationObserver re-binding — every DOM mutation re-querying
    // `button, a, [data-char]` was a per-frame cost during heavy renders.
    let debounceId: number | undefined
    const observer = new MutationObserver(() => {
      if (debounceId !== undefined) window.clearTimeout(debounceId)
      debounceId = window.setTimeout(() => {
        currentClickables.forEach((el) => {
          el.removeEventListener('mouseenter', onMouseEnter)
          el.removeEventListener('mouseleave', onMouseLeave)
        })
        addClickableListeners()
      }, 250)
    })

    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('click', onClick)
      currentClickables.forEach((el) => {
        el.removeEventListener('mouseenter', onMouseEnter)
        el.removeEventListener('mouseleave', onMouseLeave)
      })
      observer.disconnect()
      if (debounceId !== undefined) window.clearTimeout(debounceId)
      if (clickTimer !== undefined) window.clearTimeout(clickTimer)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [isTouchDevice])

  if (isTouchDevice) return null

  return (
    <>
      <div
        ref={innerRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: INNER,
          height: INNER,
          borderRadius: '50%',
          backgroundColor: '#c9922e',
          pointerEvents: 'none',
          zIndex: 9999,
          opacity: 0,
          willChange: 'transform',
          transform: 'translate3d(-100px, -100px, 0)',
        }}
      />
      <div
        ref={outerRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: OUTER,
          height: OUTER,
          borderRadius: '50%',
          border: '1px solid rgba(201,146,46,0.4)',
          pointerEvents: 'none',
          zIndex: 9999,
          opacity: 0,
          willChange: 'transform',
          transform: 'translate3d(-100px, -100px, 0)',
        }}
      />
    </>
  )
}
