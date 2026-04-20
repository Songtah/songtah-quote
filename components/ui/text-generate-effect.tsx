'use client'

import { cn } from '@/lib/utils'
import { motion, useAnimate } from 'framer-motion'
import { useEffect } from 'react'

export function TextGenerateEffect({
  words,
  className,
}: {
  words: string
  className?: string
}) {
  const [scope, animate] = useAnimate()
  const wordsArray = words.split(' ')

  useEffect(() => {
    animate(
      'span',
      { opacity: 1, filter: 'blur(0px)' },
      { duration: 0.4, delay: (i: number) => i * 0.08 }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <motion.div ref={scope} className={cn('font-black', className)}>
      {wordsArray.map((word, idx) => (
        <motion.span
          key={word + idx}
          className="inline-block opacity-0"
          style={{ filter: 'blur(8px)' }}
        >
          {word}{' '}
        </motion.span>
      ))}
    </motion.div>
  )
}
