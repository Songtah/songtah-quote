'use client'

/**
 * BurProfileDiagram
 * Clean technical-illustration style SVG profiles for dental milling burs.
 * Side-view silhouette, similar to catalog line-art.
 */

export type BurProfileType =
  | 'ball'        // B  — ball end (hemisphere)
  | 'ball_long'   // BL — ball end, long cutting neck
  | 'flat'        // F  — flat end
  | 'flat_long'   // FL — flat end, long cutting neck
  | 'radius'      // R  — torus / corner-radius
  | 'radius_long' // RL — torus, long neck
  | 'tcutter'     // T  — T-cutter (side wings)
  | 'thread'      // TH — thread mill
  | 'diamond'     // G  — diamond-coated (glass ceramic)
  | 'generic'     //    — plain cylinder / unknown

export const BUR_LABEL: Record<BurProfileType, string> = {
  ball:        'Ball',
  ball_long:   'Ball Long',
  flat:        'Flat',
  flat_long:   'Flat Long',
  radius:      'Radius',
  radius_long: 'Radius Long',
  tcutter:     'T-Cutter',
  thread:      'Thread',
  diamond:     'Diamond',
  generic:     '—',
}

// ── Palette ───────────────────────────────────────────────────
const S = '#5c6b82'    // main stroke
const SD = '#2e3d52'   // dark stroke (tip edge / detail)
const SL = '#8fa0b8'   // light stroke (secondary)

// ── Shared SVG defs (gradient + clip) ────────────────────────
// One gradient for shank, one for cutting zone.
// Safe to reuse same ID since only one diagram visible at a time.
function Defs() {
  return (
    <defs>
      {/* Horizontal gradient: left highlight → right shadow (metallic cylinder) */}
      <linearGradient id="bp-shank" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stopColor="#f5f7fa" />
        <stop offset="18%"  stopColor="#e2e8f0" />
        <stop offset="72%"  stopColor="#b8c6d6" />
        <stop offset="100%" stopColor="#8fa0b8" />
      </linearGradient>
      {/* Cutting zone: cooler / slightly deeper */}
      <linearGradient id="bp-cut" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stopColor="#eaf0f8" />
        <stop offset="20%"  stopColor="#d0dced" />
        <stop offset="75%"  stopColor="#9ab0cc" />
        <stop offset="100%" stopColor="#6880a0" />
      </linearGradient>
    </defs>
  )
}

// ── Shank (upper part, goes off-screen at top) ─────────────
// x1/x2 define the left/right edges of the cylinder
function Shank({ x1, x2, y1, y2 }: { x1: number; x2: number; y1: number; y2: number }) {
  return (
    <>
      {/* Main body */}
      <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1}
        fill="url(#bp-shank)" stroke={S} strokeWidth="1.2" />
      {/* Left highlight line */}
      <line x1={x1 + 2} y1={y1} x2={x1 + 2} y2={y2}
        stroke="white" strokeWidth="1.2" opacity="0.55" />
      {/* Break marks at top (indicates bur continues upward) */}
      <path d={`M ${x1} ${y1 + 3} Q ${(x1 + x2) / 2} ${y1 - 2} ${x2} ${y1 + 3}`}
        fill="none" stroke={SL} strokeWidth="0.8" />
    </>
  )
}

// ── Cutting zone body (without tip) ──────────────────────────
function CutZone({ x1, x2, y1, y2, flutes = 4 }: {
  x1: number; x2: number; y1: number; y2: number; flutes?: number
}) {
  const w = x2 - x1
  const h = y2 - y1
  const step = h / (flutes + 1)
  return (
    <>
      {/* Body */}
      <rect x={x1} y={y1} width={w} height={h}
        fill="url(#bp-cut)" stroke={S} strokeWidth="1.2" />
      {/* Left highlight */}
      <line x1={x1 + 2} y1={y1} x2={x1 + 2} y2={y2}
        stroke="white" strokeWidth="1.2" opacity="0.5" />
      {/* Flute tick marks — subtle diagonal lines on right side */}
      {Array.from({ length: flutes }).map((_, i) => {
        const y = y1 + step * (i + 1)
        return (
          <line key={i}
            x1={x2 - 5} y1={y - 2} x2={x2 - 1} y2={y + 2}
            stroke={SD} strokeWidth="0.9" opacity="0.5"
          />
        )
      })}
    </>
  )
}

// ── Individual tip geometries ────────────────────────────────

/** Ball end: hemisphere at bottom */
function TipBall({ cx, y, r }: { cx: number; y: number; r: number }) {
  return (
    <path
      d={`M ${cx - r} ${y} A ${r} ${r} 0 0 1 ${cx + r} ${y}`}
      fill="url(#bp-cut)" stroke={SD} strokeWidth="1.6"
      strokeLinecap="round"
    />
  )
}

/** Flat end: straight horizontal bottom */
function TipFlat({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <line x1={x1} y1={y} x2={x2} y2={y}
      stroke={SD} strokeWidth="2.2" strokeLinecap="round" />
  )
}

/** Radius / torus end: flat with radiused corners */
function TipRadius({ x1, x2, y, r = 3 }: { x1: number; x2: number; y: number; r?: number }) {
  return (
    <path
      d={`M ${x1} ${y - r} Q ${x1} ${y} ${x1 + r} ${y} L ${x2 - r} ${y} Q ${x2} ${y} ${x2} ${y - r}`}
      fill="none" stroke={SD} strokeWidth="2" strokeLinecap="round"
    />
  )
}

// ── Ball end ─────────────────────────────────────────────────
function BallProfile() {
  const cx = 27, r = 7
  const shankBot = 64, cutBot = 82
  return (
    <>
      <Defs />
      <Shank x1={cx - r} x2={cx + r} y1={4} y2={shankBot} />
      <CutZone x1={cx - r} x2={cx + r} y1={shankBot} y2={cutBot} flutes={3} />
      <TipBall cx={cx} y={cutBot} r={r} />
    </>
  )
}

// ── Ball Long ─────────────────────────────────────────────────
function BallLongProfile() {
  const cx = 27, r = 7
  const shankBot = 44, cutBot = 82
  return (
    <>
      <Defs />
      <Shank x1={cx - r} x2={cx + r} y1={4} y2={shankBot} />
      <CutZone x1={cx - r} x2={cx + r} y1={shankBot} y2={cutBot} flutes={5} />
      <TipBall cx={cx} y={cutBot} r={r} />
    </>
  )
}

// ── Flat end ─────────────────────────────────────────────────
function FlatProfile() {
  const cx = 27, hw = 7
  const shankBot = 64, cutBot = 86
  return (
    <>
      <Defs />
      <Shank x1={cx - hw} x2={cx + hw} y1={4} y2={shankBot} />
      <CutZone x1={cx - hw} x2={cx + hw} y1={shankBot} y2={cutBot} flutes={3} />
      <TipFlat x1={cx - hw} x2={cx + hw} y={cutBot} />
    </>
  )
}

// ── Flat Long ─────────────────────────────────────────────────
function FlatLongProfile() {
  const cx = 27, hw = 7
  const shankBot = 44, cutBot = 86
  return (
    <>
      <Defs />
      <Shank x1={cx - hw} x2={cx + hw} y1={4} y2={shankBot} />
      <CutZone x1={cx - hw} x2={cx + hw} y1={shankBot} y2={cutBot} flutes={5} />
      <TipFlat x1={cx - hw} x2={cx + hw} y={cutBot} />
    </>
  )
}

// ── Radius / Torus ────────────────────────────────────────────
function RadiusProfile() {
  const cx = 27, hw = 7
  const shankBot = 64, cutBot = 86
  return (
    <>
      <Defs />
      <Shank x1={cx - hw} x2={cx + hw} y1={4} y2={shankBot} />
      <CutZone x1={cx - hw} x2={cx + hw} y1={shankBot} y2={cutBot} flutes={3} />
      <TipRadius x1={cx - hw} x2={cx + hw} y={cutBot} r={4} />
    </>
  )
}

// ── Radius Long ───────────────────────────────────────────────
function RadiusLongProfile() {
  const cx = 27, hw = 7
  const shankBot = 44, cutBot = 86
  return (
    <>
      <Defs />
      <Shank x1={cx - hw} x2={cx + hw} y1={4} y2={shankBot} />
      <CutZone x1={cx - hw} x2={cx + hw} y1={shankBot} y2={cutBot} flutes={5} />
      <TipRadius x1={cx - hw} x2={cx + hw} y={cutBot} r={4} />
    </>
  )
}

// ── T-Cutter ─────────────────────────────────────────────────
// Narrow neck → wide horizontal wing at bottom (side-cutting)
function TCutterProfile() {
  const cx = 27
  const neckW = 5   // half-width of neck
  const wingW = 14  // half-width of wing
  const neckTop = 4
  const neckBot = 58
  const wingTop = 68
  const wingBot = 82
  return (
    <>
      <Defs />
      {/* Shank above neck */}
      <Shank x1={cx - neckW} x2={cx + neckW} y1={neckTop} y2={neckBot} />
      {/* Transition taper */}
      <path d={`M ${cx - neckW} ${neckBot} L ${cx - wingW} ${wingTop} L ${cx + wingW} ${wingTop} L ${cx + neckW} ${neckBot} Z`}
        fill="url(#bp-cut)" stroke={S} strokeWidth="1.2" />
      {/* Wing body */}
      <rect x={cx - wingW} y={wingTop} width={wingW * 2} height={wingBot - wingTop}
        fill="url(#bp-cut)" stroke={S} strokeWidth="1.2" />
      {/* Left highlight on wing */}
      <line x1={cx - wingW + 2} y1={wingTop} x2={cx - wingW + 2} y2={wingBot}
        stroke="white" strokeWidth="1" opacity="0.45" />
      {/* Bottom flat edge */}
      <TipFlat x1={cx - wingW} x2={cx + wingW} y={wingBot} />
    </>
  )
}

// ── Thread mill ───────────────────────────────────────────────
// Straight body with V-profile thread grooves + pointed tip
function ThreadProfile() {
  const cx = 27, hw = 7
  const shankBot = 50
  const tipBot = 88
  const pointed = 95
  const threadCount = 5
  const step = (tipBot - shankBot) / threadCount
  return (
    <>
      <Defs />
      <Shank x1={cx - hw} x2={cx + hw} y1={4} y2={shankBot} />
      {/* Thread body */}
      <rect x={cx - hw} y={shankBot} width={hw * 2} height={tipBot - shankBot}
        fill="url(#bp-cut)" stroke={S} strokeWidth="1.2" />
      <line x1={cx - hw + 2} y1={shankBot} x2={cx - hw + 2} y2={tipBot}
        stroke="white" strokeWidth="1.2" opacity="0.45" />
      {/* Thread groove marks (V-shaped notches on sides) */}
      {Array.from({ length: threadCount }).map((_, i) => {
        const y = shankBot + step * (i + 0.5)
        return (
          <g key={i}>
            <path d={`M ${cx - hw} ${y - 1.5} L ${cx - hw + 3} ${y} L ${cx - hw} ${y + 1.5}`}
              fill="none" stroke={SD} strokeWidth="1" />
            <path d={`M ${cx + hw} ${y - 1.5} L ${cx + hw - 3} ${y} L ${cx + hw} ${y + 1.5}`}
              fill="none" stroke={SD} strokeWidth="1" />
          </g>
        )
      })}
      {/* Pointed tip */}
      <path d={`M ${cx - hw} ${tipBot} L ${cx} ${pointed} L ${cx + hw} ${tipBot}`}
        fill="url(#bp-cut)" stroke={SD} strokeWidth="1.5" strokeLinejoin="round"
      />
    </>
  )
}

// ── Diamond coated (glass ceramic) ───────────────────────────
// Ball-end with stippled texture to indicate diamond grit
function DiamondProfile() {
  const cx = 27, r = 8
  const shankBot = 58, cutBot = 80
  // Grit dot positions (relative to cutting zone)
  const dots: [number, number][] = [
    [cx - 4, shankBot + 5], [cx, shankBot + 4], [cx + 4, shankBot + 6],
    [cx - 5, shankBot + 12], [cx - 1, shankBot + 11], [cx + 3, shankBot + 13],
    [cx + 5, shankBot + 8],
    [cx - 3, shankBot + 18], [cx + 2, shankBot + 18],
  ]
  return (
    <>
      <Defs />
      <Shank x1={cx - r} x2={cx + r} y1={4} y2={shankBot} />
      {/* Cutting body */}
      <rect x={cx - r} y={shankBot} width={r * 2} height={cutBot - shankBot}
        fill="url(#bp-cut)" stroke={S} strokeWidth="1.2" />
      <line x1={cx - r + 2} y1={shankBot} x2={cx - r + 2} y2={cutBot}
        stroke="white" strokeWidth="1.2" opacity="0.45" />
      {/* Grit dots */}
      {dots.map(([dx, dy], i) => (
        <circle key={i} cx={dx} cy={dy} r="1.1" fill={SD} opacity="0.6" />
      ))}
      {/* Ball tip */}
      <path
        d={`M ${cx - r} ${cutBot} A ${r} ${r} 0 0 1 ${cx + r} ${cutBot}`}
        fill="url(#bp-cut)" stroke={SD} strokeWidth="1.6" strokeLinecap="round"
      />
      {/* Grit on ball */}
      {[[cx - 5, cutBot + 3], [cx, cutBot + 2], [cx + 4, cutBot + 4], [cx - 2, cutBot + 6]].map(([dx, dy], i) => (
        <circle key={i} cx={dx} cy={dy} r="1.1" fill={SD} opacity="0.55" />
      ))}
    </>
  )
}

// ── Generic (plain cylinder / unknown) ───────────────────────
function GenericProfile() {
  const cx = 27, hw = 7
  return (
    <>
      <Defs />
      <Shank x1={cx - hw} x2={cx + hw} y1={4} y2={80} />
      <TipFlat x1={cx - hw} x2={cx + hw} y={80} />
    </>
  )
}

// ── Router ────────────────────────────────────────────────────
function ProfileShape({ type }: { type: BurProfileType }) {
  switch (type) {
    case 'ball':        return <BallProfile />
    case 'ball_long':   return <BallLongProfile />
    case 'flat':        return <FlatProfile />
    case 'flat_long':   return <FlatLongProfile />
    case 'radius':      return <RadiusProfile />
    case 'radius_long': return <RadiusLongProfile />
    case 'tcutter':     return <TCutterProfile />
    case 'thread':      return <ThreadProfile />
    case 'diamond':     return <DiamondProfile />
    case 'generic':     return <GenericProfile />
  }
}

// ── Detection from option string ─────────────────────────────
/**
 * Detect bur geometry from an option label string.
 * Examples: "T9 · 3.0B" → 'ball',  "T16 · 1.5FL" → 'flat_long',
 *           "T5 · G2.5R" → 'diamond',  "平 1.0" → 'flat'
 */
export function detectBurProfile(option: string): BurProfileType {
  if (!option) return 'generic'

  // Strip "T9 · " prefix
  const core = option.replace(/^T\d+\s*[·•·]\s*/, '').trim()

  // G-prefix → diamond coated (glass ceramic burs)
  if (/^G/i.test(core)) return 'diamond'

  // Match suffix (longest first to avoid partial matches)
  if (/TH$/i.test(core))                  return 'thread'
  if (/BL$/i.test(core))                  return 'ball_long'
  if (/FL$/i.test(core))                  return 'flat_long'
  if (/RL$/i.test(core))                  return 'radius_long'
  if (/\bT$/i.test(core))                 return 'tcutter'
  if (/B$/i.test(core))                   return 'ball'
  if (/F$/i.test(core))                   return 'flat'
  if (/R$/i.test(core))                   return 'radius'

  // Chinese labels
  if (option.includes('平') || option.includes('平頭')) return 'flat'
  if (option.includes('刃'))                            return 'ball'

  // Pure diameter (e.g. "2.0") → most CAD/CAM ZR burs are ball-end
  if (/^\d/.test(core)) return 'ball'

  return 'generic'
}

// ── Main component ────────────────────────────────────────────
export function BurProfileDiagram({
  option,
  profileType,
}: {
  option?: string
  profileType?: BurProfileType
}) {
  const type: BurProfileType =
    profileType ?? (option ? detectBurProfile(option) : 'generic')

  if (type === 'generic') return null   // nothing to show for unknown

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <svg
        viewBox="0 0 54 102"
        width={44}
        height={84}
        aria-label={BUR_LABEL[type]}
        style={{ display: 'block' }}
      >
        <ProfileShape type={type} />
      </svg>
      <span className="text-[9px] text-slate-400 tracking-wide font-medium">
        {BUR_LABEL[type]}
      </span>
    </div>
  )
}
