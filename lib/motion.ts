import type { Variants } from 'framer-motion'

/** Fade + subtle slide-up for page sections */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] } },
}

/** Container that staggers children */
export const stagger: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
}

/** Fast stagger for list rows */
export const staggerFast: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
}

/** List row: fade + slide from left */
export const listItem: Variants = {
  hidden: { opacity: 0, x: -8 },
  show:   { opacity: 1, x: 0, transition: { duration: 0.25, ease: 'easeOut' } },
}

/** Fade only (for overlays, dropdowns) */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { duration: 0.2 } },
  exit:   { opacity: 0, transition: { duration: 0.15 } },
}

/** Slide down (for collapsible panels) */
export const slideDown: Variants = {
  hidden: { opacity: 0, y: -8 },
  show:   { opacity: 1, y: 0,  transition: { duration: 0.2, ease: 'easeOut' } },
  exit:   { opacity: 0, y: -8, transition: { duration: 0.15 } },
}
