type VisualKind = 'digital' | 'print' | 'tooth' | 'shade' | 'production' | 'equipment' | 'tool' | 'software' | 'service' | 'review'

const MAIN_VISUALS: Record<string, { kind: VisualKind; caption: string }> = {
  'digital-manufacturing': { kind: 'digital', caption: '掃描・設計・加工' },
  'additive-manufacturing': { kind: 'print', caption: '列印・清洗・後固化' },
  'fixed-restorative': { kind: 'tooth', caption: '瓷材・金屬・修復材料' },
  'removable-prosthetics': { kind: 'tooth', caption: '人工牙・活動義齒' },
  'color-characterization': { kind: 'shade', caption: '比色・染色・表面處理' },
  'lab-production': { kind: 'production', caption: '技工製程・耗材' },
  'lab-equipment': { kind: 'equipment', caption: '設備・工作環境' },
  'clinical-tools': { kind: 'tool', caption: '器械・工具・配件' },
  'software-digital-service': { kind: 'software', caption: '軟體・數位服務' },
  'technical-service': { kind: 'service', caption: '安裝・維修・教育' },
  'other-review': { kind: 'review', caption: '等待確認與整理' },
}

function ArtworkGlyph({ kind }: { kind: VisualKind }) {
  const common = 'fill-none stroke-current'

  return (
    <svg viewBox="0 0 120 76" aria-hidden="true" className="h-full w-full text-brand-700">
      {kind === 'digital' && <>
        <rect x="17" y="12" width="64" height="45" rx="8" className={common} strokeWidth="4" />
        <path d="M34 65h30M49 57v8" className={common} strokeWidth="4" strokeLinecap="round" />
        <circle cx="92" cy="43" r="18" className={common} strokeWidth="4" />
        <circle cx="92" cy="43" r="6" className={common} strokeWidth="4" />
      </>}
      {kind === 'print' && <>
        <path d="M26 18h68v44H26zM38 29h44v22H38z" className={common} strokeWidth="4" strokeLinejoin="round" />
        <path d="M47 44h26M52 38h16M58 32h4" className={common} strokeWidth="4" strokeLinecap="round" />
        <path d="M19 62h82" className={common} strokeWidth="4" strokeLinecap="round" />
      </>}
      {kind === 'tooth' && <>
        <path d="M38 13c-13 0-20 12-16 25 4 12 9 11 12 24 2 8 9 7 12 0l4-13c2-7 8-7 10 0l4 13c3 7 10 8 12 0 3-13 8-12 12-24 4-13-3-25-16-25-8 0-10 5-17 5s-9-5-17-5z" className={common} strokeWidth="4" strokeLinejoin="round" />
      </>}
      {kind === 'shade' && <>
        <circle cx="47" cy="38" r="27" className={common} strokeWidth="4" />
        <circle cx="38" cy="29" r="5" fill="currentColor" opacity=".35" />
        <circle cx="57" cy="25" r="5" fill="currentColor" opacity=".6" />
        <circle cx="62" cy="45" r="5" fill="currentColor" opacity=".85" />
        <path d="M68 58 98 24M89 21l11 11" className={common} strokeWidth="5" strokeLinecap="round" />
      </>}
      {kind === 'production' && <>
        <path d="M24 63h72M34 63V31l14 10V28l16 12V22l22 14v27" className={common} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M46 52h8M68 52h8" className={common} strokeWidth="4" strokeLinecap="round" />
      </>}
      {kind === 'equipment' && <>
        <rect x="26" y="12" width="68" height="52" rx="10" className={common} strokeWidth="4" />
        <rect x="37" y="22" width="46" height="22" rx="5" className={common} strokeWidth="4" />
        <circle cx="44" cy="54" r="4" fill="currentColor" />
        <path d="M57 54h22" className={common} strokeWidth="4" strokeLinecap="round" />
      </>}
      {kind === 'tool' && <>
        <path d="m28 58 28-28M49 23l8-8 10 10-8 8M60 53l21-21M77 27l8-8 8 8-8 8" className={common} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 64h76" className={common} strokeWidth="4" strokeLinecap="round" />
      </>}
      {kind === 'software' && <>
        <rect x="18" y="13" width="84" height="50" rx="10" className={common} strokeWidth="4" />
        <path d="m39 42 10-9-10-9M58 46h22" className={common} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </>}
      {kind === 'service' && <>
        <path d="M31 52 62 21c8-8 18-7 25-1L73 34l13 13c-7 7-18 8-26 0L44 63z" className={common} strokeWidth="4" strokeLinejoin="round" />
        <circle cx="36" cy="58" r="5" className={common} strokeWidth="4" />
      </>}
      {kind === 'review' && <>
        <circle cx="54" cy="34" r="22" className={common} strokeWidth="4" />
        <path d="m70 50 22 16M47 28c2-7 14-8 17-1 4 9-10 9-10 16M54 52h.1" className={common} strokeWidth="4" strokeLinecap="round" />
      </>}
    </svg>
  )
}

export function MainCategoryArtwork({ categoryId }: { categoryId: string }) {
  const visual = MAIN_VISUALS[categoryId] ?? MAIN_VISUALS['other-review']

  return (
    <div className="relative h-28 overflow-hidden rounded-2xl bg-gradient-to-br from-cream-100 via-white to-brand-50 ring-1 ring-stone-900/[0.05]">
      <div className="absolute -right-5 -top-6 h-20 w-20 rounded-full bg-brand-200/25" />
      <div className="absolute -bottom-7 left-5 h-16 w-16 rounded-full bg-gold-200/30" />
      <div className="absolute inset-y-2 right-2 w-32"><ArtworkGlyph kind={visual.kind} /></div>
      <span className="absolute bottom-3 left-3 max-w-[48%] text-[11px] font-semibold leading-snug text-stone-500">
        {visual.caption}
      </span>
    </div>
  )
}

export function seriesVisualKind(category: string, mainCategory = ''): VisualKind {
  const text = `${category} ${mainCategory}`
  if (/人工牙|塑鋼牙|義齒/.test(text)) return 'tooth'
  if (/染|比色|釉|瓷粉|色/.test(text)) return 'shade'
  if (/3D|列印/.test(text)) return 'print'
  if (/掃描|氧化鋯|PMMA|玻璃陶瓷|蠟塊|CAD/.test(text)) return 'digital'
  if (/設備|爐|機|吸塵|工作桌/.test(text)) return 'equipment'
  if (/車針|工具|器材|配件|植體|刷具/.test(text)) return 'tool'
  if (/軟體|授權/.test(text)) return 'software'
  if (/服務|維修|安裝/.test(text)) return 'service'
  return 'production'
}

export function SeriesArtwork({ category, mainCategory, label }: { category: string; mainCategory?: string; label: string }) {
  const kind = seriesVisualKind(category, mainCategory)
  return (
    <div className="relative h-24 w-28 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-cream-100 to-brand-50 ring-1 ring-stone-900/[0.05] sm:h-28 sm:w-36">
      <div className="absolute inset-1"><ArtworkGlyph kind={kind} /></div>
      <span className="sr-only">{label} 類別圖像</span>
    </div>
  )
}
