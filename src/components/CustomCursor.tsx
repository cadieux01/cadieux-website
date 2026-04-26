'use client'

import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'

export default function CustomCursor() {
  const innerRef = useRef<HTMLDivElement>(null)
  const outerRef = useRef<HTMLDivElement>(null)
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(hover: none)')
    if (mediaQuery.matches) {
      setIsTouchDevice(true)
      return
    }

    const inner = innerRef.current
    const outer = outerRef.current
    if (!inner || !outer) return

    // Batch inner cursor writes through rAF — coalesces mousemove flurries
    // (browsers can fire >120/sec on 120Hz pointers) into one paint per frame.
    let pendingX = 0
    let pendingY = 0
    let rafId = 0
    const flush = () => {
      rafId = 0
      inner.style.left = `${pendingX}px`
      inner.style.top = `${pendingY}px`
    }

    const onMouseMove = (e: MouseEvent) => {
      const { clientX: x, clientY: y } = e
      pendingX = x
      pendingY = y
      setVisible(true)
      if (!rafId) rafId = requestAnimationFrame(flush)

      gsap.to(outer, {
        left: x,
        top: y,
        duration: 0.15,
        ease: 'power2.out',
      })
    }

    const onMouseEnter = () => {
      gsap.to(outer, { scale: 2.2, duration: 0.3, ease: 'power2.out' })
      gsap.to(inner, { scale: 0.4, duration: 0.3, ease: 'power2.out' })
    }

    const onMouseLeave = () => {
      gsap.to(outer, { scale: 1, duration: 0.3, ease: 'power2.out' })
      gsap.to(inner, { scale: 1, duration: 0.3, ease: 'power2.out' })
    }

    const onClick = () => {
      gsap.to(outer, {
        scale: 0.8,
        duration: 0.1,
        ease: 'power2.in',
        onComplete: () => {
          gsap.to(outer, { scale: 1, duration: 0.2, ease: 'power2.out' })
        },
      })
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
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: '#c9922e',
          pointerEvents: 'none',
          zIndex: 9999,
          transform: 'translate(-50%, -50%)',
          opacity: visible ? 1 : 0,
        }}
      />
      <div
        ref={outerRef}
        style={{
          position: 'fixed',
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '1px solid rgba(201,146,46,0.4)',
          pointerEvents: 'none',
          zIndex: 9999,
          transform: 'translate(-50%, -50%)',
          opacity: visible ? 1 : 0,
        }}
      />
    </>
  )
}
