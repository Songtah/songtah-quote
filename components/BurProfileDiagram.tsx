'use client'

/**
 * BurProfileDiagram
 * Side-view SVG silhouette illustrations for dental milling bur geometries.
 * Used in the OrderForm spec panel when the user selects a 型號 in a bur family.
 */

export type BurProfileType =
  | 'ball'        // B  — ball-end (hemisphere tip)
  | 'ball_long'   // BL — ball-end with long cutting neck
  | 'flat'        // F  — flat-end (squared-off tip)
  | 'flat_long'   // FL — flat-end with long cutting neck
  | 'radius'      // R  — corner-radius (flat with rounded edges)
  | 'radius_long' // RL — corner-radius with long cutting neck
  | 'tcutter'     // T  — T-cutter (side-cutting wings)
  | 'thread'      // TH — thread mill (screw profile on tip)
  | 'diamond'     // G  — diamond-coated (glass / hybrid ceramic)
  | 'generic'     // fallback — plain cylindrical profile

const LABEL: Record<BurProfileType, string> = {
  ball:        '球形 Ball',
  ball_long:   '長球形 Ball Long',
  flat:        '平頭 Flat',
  flat_long:   '長平頭 Flat Long',
  radius:      '圓角 Radius',
  radius_long: '長圓角 Radius Long',
  tcutter:     'T型刀 T-Cutter',
  thread:      '螺牙刀 Thread',
  diamond:     '鑽石砂輪',
  generic:     '圓柱形',
}

// ── Profile SVG paths ──────────────────────────────────────────
// viewBox = "0 0 60 106"
// Shaft collet: x=23–37, y=4–18 (narrower collar)
// Main shank:   x=22–38, y=18–(cutStart)
// Cutting zone: x=22–38, y=(cutStart)–tipEnd  (highlighted)
// Tip geometry: varies by type
//
// Color palette
const C_SHAFT   = '#f5ede3'   // shaft fill (warm light)
const C_SHAFT_S = '#c9a882'   // shaft stroke
const C_CUT     = '#f0dcc4'   // cutting zone fill
const C_CUT_S   = '#b8956a'   // cutting zone stroke (brand)
const C_TIP_S   = '#9e7652'   // tip edge highlight

interface ProfileProps { cutStart?: number }

// ── Ball end ──────────────────────────────────────────────────
function BallProfile({ cutStart = 68 }: ProfileProps) {
  // cx=30, shaft x=22–38, ball radius=8 below cutStart
  const r = 8
  const ballCy = cutStart + r
  return (
    <>
      {/* Shaft body */}
      <rect x="22" y="18" width="16" height={cutStart - 18}
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="1" />
      {/* Collet */}
      <rect x="23" y="4" width="14" height="16"
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="2" />
      {/* Cutting zone fill */}
      <rect x="22" y={cutStart} width="16" height={r + 2}
        fill={C_CUT} stroke="none" />
      {/* Ball tip */}
      <path
        d={`M 22 ${cutStart} L 22 ${ballCy} A ${r} ${r} 0 0 1 38 ${ballCy} L 38 ${cutStart} Z`}
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.5"
      />
      {/* Ball sheen */}
      <ellipse cx="27" cy={ballCy - 1} rx="3" ry="2"
        fill="white" opacity="0.35" />
    </>
  )
}

// ── Ball-Long end ────────────────────────────────────────────
function BallLongProfile() {
  const cutStart = 46
  const r = 8
  const ballCy = cutStart + r
  return (
    <>
      <rect x="22" y="18" width="16" height={cutStart - 18}
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="1" />
      <rect x="23" y="4" width="14" height="16"
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="2" />
      {/* Long cutting zone */}
      <rect x="22" y={cutStart} width="16" height={r + 2}
        fill={C_CUT} stroke="none" />
      <path
        d={`M 22 ${cutStart} L 22 ${ballCy} A ${r} ${r} 0 0 1 38 ${ballCy} L 38 ${cutStart} Z`}
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.5"
      />
      {/* Cutting-zone side marks */}
      <line x1="22" y1={cutStart} x2="22" y2={ballCy}
        stroke={C_CUT_S} strokeWidth="1.5" />
      <line x1="38" y1={cutStart} x2="38" y2={ballCy}
        stroke={C_CUT_S} strokeWidth="1.5" />
      <ellipse cx="27" cy={ballCy - 1} rx="3" ry="2"
        fill="white" opacity="0.35" />
    </>
  )
}

// ── Flat end ─────────────────────────────────────────────────
function FlatProfile({ cutStart = 68 }: ProfileProps) {
  const tipBot = cutStart + 14
  return (
    <>
      <rect x="22" y="18" width="16" height={cutStart - 18}
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="1" />
      <rect x="23" y="4" width="14" height="16"
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="2" />
      {/* Flat cutting head — same width */}
      <rect x="22" y={cutStart} width="16" height={tipBot - cutStart}
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.5" />
      {/* Bottom flat edge highlight */}
      <line x1="22" y1={tipBot} x2="38" y2={tipBot}
        stroke={C_TIP_S} strokeWidth="2" strokeLinecap="round" />
    </>
  )
}

// ── Flat-Long end ─────────────────────────────────────────────
function FlatLongProfile() {
  const cutStart = 46
  const tipBot = cutStart + 28
  return (
    <>
      <rect x="22" y="18" width="16" height={cutStart - 18}
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="1" />
      <rect x="23" y="4" width="14" height="16"
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="2" />
      <rect x="22" y={cutStart} width="16" height={tipBot - cutStart}
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.5" />
      <line x1="22" y1={tipBot} x2="38" y2={tipBot}
        stroke={C_TIP_S} strokeWidth="2" strokeLinecap="round" />
    </>
  )
}

// ── Radius (corner-radius) end ───────────────────────────────
function RadiusProfile({ cutStart = 68 }: ProfileProps) {
  const tipBot = cutStart + 14
  const cr = 4 // corner radius
  return (
    <>
      <rect x="22" y="18" width="16" height={cutStart - 18}
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="1" />
      <rect x="23" y="4" width="14" height="16"
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="2" />
      {/* Rounded-corner tip */}
      <path
        d={`M 22 ${cutStart} L 22 ${tipBot - cr} Q 22 ${tipBot} ${22 + cr} ${tipBot} L ${38 - cr} ${tipBot} Q 38 ${tipBot} 38 ${tipBot - cr} L 38 ${cutStart} Z`}
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.5"
      />
    </>
  )
}

// ── Radius-Long end ──────────────────────────────────────────
function RadiusLongProfile() {
  const cutStart = 46
  const tipBot = cutStart + 28
  const cr = 4
  return (
    <>
      <rect x="22" y="18" width="16" height={cutStart - 18}
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="1" />
      <rect x="23" y="4" width="14" height="16"
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="2" />
      <path
        d={`M 22 ${cutStart} L 22 ${tipBot - cr} Q 22 ${tipBot} ${22 + cr} ${tipBot} L ${38 - cr} ${tipBot} Q 38 ${tipBot} 38 ${tipBot - cr} L 38 ${cutStart} Z`}
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.5"
      />
    </>
  )
}

// ── T-Cutter ─────────────────────────────────────────────────
function TCutterProfile() {
  // Wide horizontal wing at the bottom
  const neckStart = 55
  const wingY = 68
  const tipBot = 82
  const wingW = 20  // wing extends to x=10 and x=50 (half-width=20 from center)
  const cx = 30
  return (
    <>
      <rect x="22" y="18" width="16" height={neckStart - 18}
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="1" />
      <rect x="23" y="4" width="14" height="16"
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="2" />
      {/* Neck */}
      <rect x="25" y={neckStart} width="10" height={wingY - neckStart}
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.5" />
      {/* Horizontal wing */}
      <rect x={cx - wingW} y={wingY} width={wingW * 2} height={tipBot - wingY}
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.5" rx="2" />
      {/* Wing tip highlights */}
      <line x1={cx - wingW} y1={tipBot} x2={cx + wingW} y2={tipBot}
        stroke={C_TIP_S} strokeWidth="2" strokeLinecap="round" />
    </>
  )
}

// ── Thread Mill ───────────────────────────────────────────────
function ThreadProfile() {
  const cutStart = 52
  const tipBot = 88
  const threadCount = 5
  const threadH = (tipBot - cutStart) / threadCount
  return (
    <>
      <rect x="22" y="18" width="16" height={cutStart - 18}
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="1" />
      <rect x="23" y="4" width="14" height="16"
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="2" />
      {/* Thread body */}
      <rect x="22" y={cutStart} width="16" height={tipBot - cutStart}
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.5" />
      {/* Thread grooves */}
      {Array.from({ length: threadCount }).map((_, i) => {
        const y = cutStart + i * threadH + threadH / 2
        return (
          <line key={i}
            x1="22" y1={y} x2="38" y2={y}
            stroke={C_TIP_S} strokeWidth="1" strokeDasharray="2,1"
          />
        )
      })}
      {/* Pointed tip */}
      <path
        d={`M 22 ${tipBot} L 30 ${tipBot + 5} L 38 ${tipBot} Z`}
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.2"
      />
    </>
  )
}

// ── Diamond-coated (glass ceramic) ───────────────────────────
function DiamondProfile() {
  // Looks like a ball-end but with diamond-grit texture marks
  const cutStart = 62
  const r = 10
  const ballCy = cutStart + r
  return (
    <>
      <rect x="22" y="18" width="16" height={cutStart - 18}
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="1" />
      <rect x="23" y="4" width="14" height="16"
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="2" />
      {/* Ball */}
      <path
        d={`M 22 ${cutStart} L 22 ${ballCy} A ${r} ${r} 0 0 1 38 ${ballCy} L 38 ${cutStart} Z`}
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.5"
      />
      {/* Diamond grit dots */}
      {[
        [25, cutStart + 4], [30, cutStart + 3], [35, cutStart + 5],
        [23, cutStart + 9], [28, cutStart + 9], [33, cutStart + 8], [37, cutStart + 10],
        [25, cutStart + 14], [30, cutStart + 14], [35, cutStart + 14],
      ].map(([dx, dy], i) => (
        <circle key={i} cx={dx} cy={dy} r="1.2"
          fill={C_TIP_S} opacity="0.7" />
      ))}
    </>
  )
}

// ── Generic cylindrical ───────────────────────────────────────
function GenericProfile() {
  return (
    <>
      <rect x="22" y="18" width="16" height={52}
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="1" />
      <rect x="23" y="4" width="14" height="16"
        fill={C_SHAFT} stroke={C_SHAFT_S} strokeWidth="1.2" rx="2" />
      <rect x="22" y="70" width="16" height="14"
        fill={C_CUT} stroke={C_CUT_S} strokeWidth="1.5" rx="1" />
    </>
  )
}

// ── Profile renderer ─────────────────────────────────────────
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

// ── Detection logic ─────────────────────────────────────────
/**
 * Parse the bur geometry type from an option string.
 * Examples:
 *   "T9 · 3.0B"   → 'ball'
 *   "T14 · 2.0BL" → 'ball_long'
 *   "T16 · 1.5FL" → 'flat_long'
 *   "T23 · 1.5T"  → 'tcutter'
 *   "T5 · G2.5R"  → 'diamond'
 *   "平 1.0"       → 'flat'
 *   "刃 1.0"       → 'ball'
 *   "2.0"          → 'ball'  (ZR bur default)
 */
export function detectBurProfile(option: string): BurProfileType {
  // Strip leading tool number "T9 · " or "T23 · " etc.
  const core = option.replace(/^T\d+\s*[·•]\s*/, '').trim()

  // G-prefix → diamond-coated (glass ceramic burs)
  if (/^G/.test(core)) return 'diamond'

  // Suffix detection (order matters: check longer suffixes first)
  if (/TH$/i.test(core)) return 'thread'
  if (/BL$/i.test(core)) return 'ball_long'
  if (/FL$/i.test(core)) return 'flat_long'
  if (/RL$/i.test(core)) return 'radius_long'
  if (/\bT$/.test(core)) return 'tcutter'
  if (/B$/i.test(core))  return 'ball'
  if (/F$/i.test(core))  return 'flat'
  if (/R$/i.test(core))  return 'radius'

  // Chinese labels
  if (option.includes('平') || option.includes('平頭')) return 'flat'
  if (option.includes('刃')) return 'ball'

  // Pure number/size → generic ball (ZR/PMMA cylinders are usually ball-end)
  if (/^\d/.test(core)) return 'ball'

  return 'generic'
}

// ── Main component ───────────────────────────────────────────
export function BurProfileDiagram({
  option,
  profileType,
}: {
  option?: string
  profileType?: BurProfileType
}) {
  const type = profileType ?? (option ? detectBurProfile(option) : 'generic')
  const label = LABEL[type]

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <svg
        viewBox="0 0 60 106"
        style={{ width: 52, height: 92 }}
        aria-label={label}
      >
        {/* Background collet ring at top */}
        <rect x="19" y="2" width="22" height="6" rx="3"
          fill="#e8ddd4" stroke="#c9a882" strokeWidth="0.8" />
        <ProfileShape type={type} />
      </svg>
      <span className="text-[10px] text-gray-400 text-center leading-tight whitespace-nowrap">
        {label}
      </span>
    </div>
  )
}

// ── Multi-type gallery (for reference/debug) ─────────────────
export function BurProfileGallery() {
  const types: BurProfileType[] = [
    'ball', 'flat', 'radius',
    'ball_long', 'flat_long', 'radius_long',
    'tcutter', 'thread', 'diamond', 'generic',
  ]
  return (
    <div className="flex flex-wrap gap-6 p-6 bg-white rounded-xl border border-gray-100">
      {types.map((t) => (
        <BurProfileDiagram key={t} profileType={t} />
      ))}
    </div>
  )
}
