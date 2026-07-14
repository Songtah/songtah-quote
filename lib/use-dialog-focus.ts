'use client'

import { type RefObject, useEffect, useRef } from 'react'

let bodyScrollLockCount = 0
let originalBodyOverflow = ''

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Keeps keyboard focus inside a modal and restores it when the modal closes. */
export function useDialogFocus(
  dialogRef: RefObject<HTMLElement>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const initialFocus = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')
      ?? dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    const frame = requestAnimationFrame(() => initialFocus?.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!dialog.contains(document.activeElement)) return
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.offsetParent !== null)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      const activeElement = document.activeElement
      const focusStillBelongsToDialog = activeElement === document.body || dialog.contains(activeElement)
      if (focusStillBelongsToDialog && previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [dialogRef])
}

/** Reference-counted so overlapping exit/enter animations cannot unlock the page early. */
export function useBodyScrollLock() {
  useEffect(() => {
    if (bodyScrollLockCount === 0) originalBodyOverflow = document.body.style.overflow
    bodyScrollLockCount += 1
    document.body.style.overflow = 'hidden'

    return () => {
      bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1)
      if (bodyScrollLockCount === 0) document.body.style.overflow = originalBodyOverflow
    }
  }, [])
}
