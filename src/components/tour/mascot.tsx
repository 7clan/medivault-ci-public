'use client'

/**
 * Medi — the MediVault guide mascot (DIRECTIVE FEATURE C).
 *
 * A small, professional character: a rounded shield (the secure-vault
 * identity) wearing a stethoscope whose chest piece is a combination-dial
 * (the medical + vault cues), friendly but not childish. Built as an INLINE
 * SVG React component — no external image files, no downloaded assets — so
 * the offline desktop app and the CI's no-PHI/no-credentials gates are
 * unaffected. Flat design in the app's existing emerald/teal palette;
 * animation is subtle (a gentle float + an occasional blink) and fully
 * disabled under prefers-reduced-motion.
 */
import { useId } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useTourStrings } from './tour-content'

interface MascotProps {
  /** Rendered size in pixels (square). */
  size?: number
  className?: string
  /** Set false for static placements (e.g. dense menus). */
  animated?: boolean
}

export function Mascot({ size = 44, className, animated = true }: MascotProps) {
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, '')
  const gradientId = `mv-mascot-shield-${uid}`
  const reduceMotion = useReducedMotion()
  const animate = animated && !reduceMotion
  // Accessible name comes from the centralized strings module (locale-aware).
  const tourStrings = useTourStrings()
  const label = tourStrings.mascotAriaLabel

  return (
    <motion.div
      className={`select-none ${className ?? ''}`}
      style={{ width: size, height: size }}
      animate={animate ? { y: [0, -2.5, 0] } : undefined}
      transition={{ type: 'tween', duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        role="img"
        aria-label={label}
        className="drop-shadow-sm"
      >
        <title>{label}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0.55" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="55%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#0d9488" />
          </linearGradient>
        </defs>

        {/* Stethoscope tubing — draped over the shield's left side */}
        <path
          d="M15.5 13.5 C11.5 22, 11 34, 14 42.5 C15.8 47.2, 18.6 50.6, 22 52.6"
          fill="none"
          stroke="#0f766e"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Shield body */}
        <path
          d="M32 4.5 L53 12.3 V29.5 C53 43.5 44.4 53.6 32 59 C19.6 53.6 11 43.5 11 29.5 V12.3 Z"
          fill={`url(#${gradientId})`}
          stroke="#047857"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />

        {/* Soft top gloss */}
        <path
          d="M32 7 L50.6 13.6 V23.5 C43 20.4, 21 20.4, 13.4 23.5 V13.6 Z"
          fill="#ffffff"
          opacity="0.14"
        />

        {/* Face — eyes (occasional blink) */}
        <motion.g
          animate={animate ? { scaleY: [1, 1, 0.12, 1, 1] } : undefined}
          transition={{ duration: 4.4, times: [0, 0.86, 0.9, 0.94, 1], repeat: Infinity }}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        >
          <ellipse cx="26" cy="23" rx="3" ry="3.6" fill="#ffffff" />
          <ellipse cx="38" cy="23" rx="3" ry="3.6" fill="#ffffff" />
          <circle cx="26.4" cy="23.6" r="1.4" fill="#064e3b" />
          <circle cx="38.4" cy="23.6" r="1.4" fill="#064e3b" />
        </motion.g>

        {/* Smile */}
        <path
          d="M26.5 30 Q32 35.5 37.5 30"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.4"
          strokeLinecap="round"
        />

        {/* Medical cross */}
        <g fill="#ffffff" opacity="0.96">
          <rect x="29.7" y="38.8" width="4.6" height="13.4" rx="1.3" />
          <rect x="25.3" y="43.2" width="13.4" height="4.6" rx="1.3" />
        </g>

        {/* Stethoscope chest piece — a vault combination dial */}
        <circle cx="22" cy="55" r="4.6" fill="#ffffff" stroke="#0f766e" strokeWidth="2.4" />
        <circle cx="22" cy="55" r="1.7" fill="#0f766e" />
        <rect x="21.4" y="51.4" width="1.2" height="1.6" rx="0.6" fill="#0f766e" />
      </svg>
    </motion.div>
  )
}
