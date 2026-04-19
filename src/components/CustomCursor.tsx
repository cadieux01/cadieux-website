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

    const onMouseMove = (e: MouseEvent) => {
      const { clientX: x, clientY: y } = e

      setVisible(true)
      inner.style.left = `${x}px`
      inner.style.top = `${y}px`

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

    const addClickableListeners = () => {
      const clickables = document.querySelectorAll('button, a, [data-char]')
      clickables.forEach((el) => {
        el.addEventListener('mouseenter', onMouseEnter)
        el.addEventListener('mouseleave', onMouseLeave)
      })
      return clickables
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('click', onClick)
    const clickables = addClickableListeners()

    const observer = new MutationObserver(() => {
      clickables.forEach((el) => {
        el.removeEventListener('mouseenter', onMouseEnter)
        el.removeEventListener('mouseleave', onMouseLeave)
      })
      addClickableListeners()
    })

    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('click', onClick)
      clickables.forEach((el) => {
        el.removeEventListener('mouseenter', onMouseEnter)
        el.removeEventListener('mouseleave', onMouseLeave)
      })
      observer.disconnect()
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
