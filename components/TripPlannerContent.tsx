'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'

// ── Constants ──────────────────────────────────────────────────────────────────
const HOUR_PX    = 64          // px per hour
const SNAP_MIN   = 15          // minimum drag increment
const SNAP_PX    = (HOUR_PX / 60) * SNAP_MIN  // 16px per 15 min
const START_HOUR = 6
const END_HOUR   = 24
const TIMELINE_H = (END_HOUR - START_HOUR) * HOUR_PX  // 1152px
const START_MIN  = START_HOUR * 60                     // 360 min
const COL_MIN_W  = 180         // minimum column width px

// ── Types ──────────────────────────────────────────────────────────────────────
type ActivityType = '交通' | '餐飲' | '參觀' | '會議' | '住宿' | '其他'

interface Trip {
  id: string
  name: string
  destination: string
  startDate: string   // YYYY-MM-DD
  endDate: string
  createdAt: string
}

interface Activity {
  id: string
  tripId: string
  name: string
  location: string
  date: string        // YYYY-MM-DD (which day)
  startMin: number    // minutes from midnight
  endMin: number
  type: ActivityType
  clients: string
  salesperson: string
  notes: string
}

interface DragState {
  actId: string
  mode: 'move' | 'resize'
  startMouseY: number
  startMouseX: number
  origStart: number
  origEnd: number
  origDate: string
  duration: number
  dates: string[]
  colW: number
  // live values (mutated during drag)
  liveDate: string
  liveStart: number
  liveEnd: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function snapMin(min: number): number {
  return Math.round(min / SNAP_MIN) * SNAP_MIN
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}
function getDates(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = new Date(start + 'T00:00:00')
  const last = new Date(end + 'T00:00:00')
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}
function fmtMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}
function fmtDate(d: string, i: number): string {
  const dt = new Date(d + 'T00:00:00')
  const wd = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()]
  return `Day ${i + 1} · ${dt.getMonth() + 1}/${dt.getDate()}（${wd}）`
}
function pixelToMin(px: number): number {
  return snapMin(START_MIN + (px / HOUR_PX) * 60)
}
function minToPixel(min: number): number {
  return (min - START_MIN) * (HOUR_PX / 60)
}

// ── Colors ────────────────────────────────────────────────────────────────────
const TYPE_STYLE: Record<ActivityType, { bg: string; border: string; text: string; dot: string }> = {
  '交通': { bg: 'bg-blue-50',    border: 'border-blue-400',   text: 'text-blue-900',   dot: 'bg-blue-400' },
  '餐飲': { bg: 'bg-amber-50',   border: 'border-amber-400',  text: 'text-amber-900',  dot: 'bg-amber-400' },
  '參觀': { bg: 'bg-emerald-50', border: 'border-emerald-400',text: 'text-emerald-900',dot: 'bg-emerald-400' },
  '會議': { bg: 'bg-violet-50',  border: 'border-violet-400', text: 'text-violet-900', dot: 'bg-violet-400' },
  '住宿': { bg: 'bg-teal-50',    border: 'border-teal-400',   text: 'text-teal-900',   dot: 'bg-teal-400' },
  '其他': { bg: 'bg-gray-50',    border: 'border-gray-400',   text: 'text-gray-900',   dot: 'bg-gray-400' },
}
const TYPES: ActivityType[] = ['交通', '餐飲', '參觀', '會議', '住宿', '其他']

// ── Storage ────────────────────────────────────────────────────────────────────
const TRIPS_KEY = 'st-trips-v1'
const ACTS_KEY  = 'st-activities-v1'

// ── Activity Form Modal ────────────────────────────────────────────────────────
interface ActivityFormProps {
  initial: Partial<Activity> & { date: string }
  onSave: (a: Activity) => void
  onDelete?: () => void
  onClose: () => void
}

function ActivityForm({ initial, onSave, onDelete, onClose }: ActivityFormProps) {
  const [form, setForm] = useState<Omit<Activity, 'id' | 'tripId'>>({
    name:        initial.name        ?? '',
    location:    initial.location    ?? '',
    date:        initial.date,
    startMin:    initial.startMin    ?? snapMin(START_MIN + 120), // default 08:00
    endMin:      initial.endMin      ?? snapMin(START_MIN + 180), // default 09:00
    type:        initial.type        ?? '其他',
    clients:     initial.clients     ?? '',
    salesperson: initial.salesperson ?? '',
    notes:       initial.notes       ?? '',
  })

  const setF = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = () => {
    if (!form.name.trim()) return
    if (form.endMin <= form.startMin) return
    onSave({ ...form, id: initial.id ?? genId(), tripId: initial.tripId ?? '' })
  }

  const timeOptions: number[] = []
  for (let m = 0; m <= 24 * 60; m += SNAP_MIN) timeOptions.push(m)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">{initial.id ? '編輯活動' : '新增活動'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400">✕</button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* 活動名稱 */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">活動名稱 *</label>
            <input value={form.name} onChange={e => setF('name', e.target.value)}
              placeholder="例：機場接送、晚宴、工廠參觀"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          {/* 類型 */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">類型</label>
            <div className="flex flex-wrap gap-2">
              {TYPES.map(t => (
                <button key={t} onClick={() => setF('type', t)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                    form.type === t
                      ? `${TYPE_STYLE[t].bg} ${TYPE_STYLE[t].border} ${TYPE_STYLE[t].text}`
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* 時間 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">開始時間</label>
              <select value={form.startMin} onChange={e => setF('startMin', +e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {timeOptions.map(m => (
                  <option key={m} value={m}>{fmtMin(m)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">結束時間</label>
              <select value={form.endMin} onChange={e => setF('endMin', +e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {timeOptions.filter(m => m > form.startMin).map(m => (
                  <option key={m} value={m}>{fmtMin(m)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 地點 */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">地點</label>
            <input value={form.location} onChange={e => setF('location', e.target.value)}
              placeholder="飯店名稱、地址、場所"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          {/* 參與客戶 */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">參與客戶</label>
            <input value={form.clients} onChange={e => setF('clients', e.target.value)}
              placeholder="客戶名稱，多人以逗號分隔"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          {/* 負責業務 */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">負責業務</label>
            <input value={form.salesperson} onChange={e => setF('salesperson', e.target.value)}
              placeholder="業務姓名"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          {/* 備註 */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">備註</label>
            <textarea value={form.notes} onChange={e => setF('notes', e.target.value)}
              rows={2} placeholder="補充說明"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
          </div>
        </div>
        <div className="p-5 border-t border-gray-100 flex justify-between items-center">
          {onDelete
            ? <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded-xl hover:bg-red-50">刪除</button>
            : <div />
          }
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50">取消</button>
            <button onClick={handleSave}
              disabled={!form.name.trim() || form.endMin <= form.startMin}
              className="px-5 py-2 rounded-xl text-sm bg-gray-900 text-white font-medium hover:bg-gray-700 disabled:opacity-40">
              儲存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Trip Form Modal ────────────────────────────────────────────────────────────
function TripForm({ onSave, onClose }: { onSave: (t: Trip) => void; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [name, setName]        = useState('')
  const [dest, setDest]        = useState('')
  const [start, setStart]      = useState(today)
  const [end, setEnd]          = useState(today)

  const handleSave = () => {
    if (!name.trim() || !start || !end || start > end) return
    onSave({ id: genId(), name: name.trim(), destination: dest.trim(), startDate: start, endDate: end, createdAt: new Date().toISOString() })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">建立新行程</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">行程名稱 *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="例：2025 日本醫材參訪"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">目的地</label>
            <input value={dest} onChange={e => setDest(e.target.value)}
              placeholder="例：日本大阪"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">出發日期</label>
              <input type="date" value={start} onChange={e => setStart(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">返回日期</label>
              <input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
        </div>
        <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50">取消</button>
          <button onClick={handleSave}
            disabled={!name.trim() || !start || !end || start > end}
            className="px-5 py-2 rounded-xl text-sm bg-gray-900 text-white font-medium hover:bg-gray-700 disabled:opacity-40">
            建立行程
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export function TripPlannerContent() {
  // ── State ─────────────────────────────────────────────────────────────────────
  const [trips, setTrips]           = useState<Trip[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [tripId, setTripId]         = useState<string | null>(null)

  // Drag
  const dragRef = useRef<DragState | null>(null)
  const [dragLive, setDragLive] = useState<{ actId: string; date: string; startMin: number; endMin: number } | null>(null)

  // Modals
  const [createPos, setCreatePos]     = useState<{ date: string; startMin: number } | null>(null)
  const [editActivity, setEditActivity] = useState<Activity | null>(null)
  const [showTripModal, setShowTripModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Click vs drag detection
  const clickRef = useRef<{ x: number; y: number; time: number } | null>(null)

  // Timeline ref (for scroll)
  const timelineRef = useRef<HTMLDivElement>(null)

  // ── localStorage ─────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const t = localStorage.getItem(TRIPS_KEY)
      const a = localStorage.getItem(ACTS_KEY)
      if (t) setTrips(JSON.parse(t))
      if (a) setActivities(JSON.parse(a))
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem(TRIPS_KEY, JSON.stringify(trips)) } catch {}
  }, [trips])

  useEffect(() => {
    try { localStorage.setItem(ACTS_KEY, JSON.stringify(activities)) } catch {}
  }, [activities])

  // ── Derived ───────────────────────────────────────────────────────────────────
  const selectedTrip  = useMemo(() => trips.find(t => t.id === tripId) ?? null, [trips, tripId])
  const dates         = useMemo(() => selectedTrip ? getDates(selectedTrip.startDate, selectedTrip.endDate) : [], [selectedTrip])
  const tripActivities = useMemo(() => activities.filter(a => a.tripId === tripId), [activities, tripId])

  // ── Drag handlers ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      e.preventDefault()

      const deltaY = e.clientY - d.startMouseY
      const deltaMin = snapMin((deltaY / HOUR_PX) * 60)

      if (d.mode === 'move') {
        // Time shift
        const newStart = clamp(snapMin(d.origStart + deltaMin), 0, 24 * 60 - d.duration)
        const newEnd   = newStart + d.duration

        // Day shift (X axis)
        const deltaX  = e.clientX - d.startMouseX
        const colDelta = Math.round(deltaX / d.colW)
        const origIdx  = d.dates.indexOf(d.origDate)
        const newIdx   = clamp(origIdx + colDelta, 0, d.dates.length - 1)
        const newDate  = d.dates[newIdx]

        d.liveDate = newDate; d.liveStart = newStart; d.liveEnd = newEnd
        setDragLive({ actId: d.actId, date: newDate, startMin: newStart, endMin: newEnd })

      } else {
        // Resize (only endMin changes)
        const newEnd = clamp(snapMin(d.origEnd + deltaMin), d.origStart + SNAP_MIN, 24 * 60)
        d.liveEnd = newEnd
        setDragLive({ actId: d.actId, date: d.origDate, startMin: d.origStart, endMin: newEnd })
      }
    }

    const onUp = (e: MouseEvent) => {
      const d = dragRef.current
      if (d) {
        // Check if it was actually a click (tiny movement, short duration)
        const click = clickRef.current
        const dx = Math.abs(e.clientX - (click?.x ?? e.clientX))
        const dy = Math.abs(e.clientY - (click?.y ?? e.clientY))
        const isClick = dx < 5 && dy < 5

        if (!isClick) {
          // Save new position
          setActivities(prev => prev.map(a =>
            a.id === d.actId
              ? { ...a, date: d.liveDate, startMin: d.liveStart, endMin: d.liveEnd }
              : a
          ))
        }
      }
      dragRef.current = null
      clickRef.current = null
      setDragLive(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleCreateTrip = (t: Trip) => {
    setTrips(prev => [t, ...prev])
    setTripId(t.id)
    setShowTripModal(false)
  }

  const handleDeleteTrip = (id: string) => {
    setTrips(prev => prev.filter(t => t.id !== id))
    setActivities(prev => prev.filter(a => a.tripId !== id))
    if (tripId === id) setTripId(null)
    setDeleteConfirm(null)
  }

  const handleSaveActivity = (a: Activity) => {
    a.tripId = tripId!
    setActivities(prev => {
      const existing = prev.findIndex(x => x.id === a.id)
      if (existing >= 0) {
        const next = [...prev]; next[existing] = a; return next
      }
      return [...prev, a]
    })
    setCreatePos(null)
    setEditActivity(null)
  }

  const handleDeleteActivity = (id: string) => {
    setActivities(prev => prev.filter(a => a.id !== id))
    setEditActivity(null)
  }

  // Start drag on activity
  const startDrag = useCallback((
    e: React.MouseEvent,
    act: Activity,
    mode: 'move' | 'resize',
    colW: number
  ) => {
    e.stopPropagation()
    clickRef.current = { x: e.clientX, y: e.clientY, time: Date.now() }
    dragRef.current = {
      actId: act.id, mode,
      startMouseY: e.clientY,
      startMouseX: e.clientX,
      origStart: act.startMin,
      origEnd:   act.endMin,
      origDate:  act.date,
      duration:  act.endMin - act.startMin,
      dates,
      colW,
      liveDate:  act.date,
      liveStart: act.startMin,
      liveEnd:   act.endMin,
    }
  }, [dates])

  // Click on column (empty area) → create activity
  const handleColumnClick = useCallback((e: React.MouseEvent, date: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const py = e.clientY - rect.top + (e.currentTarget as HTMLElement).scrollTop
    const min = clamp(pixelToMin(py), 0, 24 * 60 - 60)
    setCreatePos({ date, startMin: min })
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" style={{ userSelect: dragRef.current ? 'none' : 'auto' }}>

      {/* ── Top bar: trip selector ── */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <select
            value={tripId ?? ''}
            onChange={e => setTripId(e.target.value || null)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 min-w-[200px]"
          >
            <option value="">-- 選擇行程 --</option>
            {trips.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}{t.destination ? ` · ${t.destination}` : ''} ({t.startDate} → {t.endDate})
              </option>
            ))}
          </select>
          {selectedTrip && (
            <button
              onClick={() => setDeleteConfirm(selectedTrip.id)}
              className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
            >
              刪除行程
            </button>
          )}
        </div>
        <button
          onClick={() => setShowTripModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          新增行程
        </button>
      </div>

      {/* ── Legend ── */}
      {selectedTrip && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {TYPES.map(t => (
            <div key={t} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${TYPE_STYLE[t].dot}`} />
              <span className="text-xs text-gray-500">{t}</span>
            </div>
          ))}
          <span className="text-xs text-gray-300 ml-2">拖曳色塊移動時間 · 拖曳底部調整長度 · 點擊空白新增活動</span>
        </div>
      )}

      {/* ── No trip selected ── */}
      {!selectedTrip && (
        <div className="flex-1 flex flex-col items-center justify-center py-24 text-gray-400">
          <div className="text-5xl mb-4">✈️</div>
          <p className="text-base font-medium text-gray-500">尚無選取行程</p>
          <p className="text-sm mt-1">請從上方選擇行程，或點「新增行程」建立新的出國計畫</p>
          <button
            onClick={() => setShowTripModal(true)}
            className="mt-6 px-5 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700"
          >
            建立第一個行程
          </button>
        </div>
      )}

      {/* ── Timeline ── */}
      {selectedTrip && dates.length > 0 && (
        <TimelineGrid
          dates={dates}
          activities={tripActivities}
          dragLive={dragLive}
          onActivityMouseDown={startDrag}
          onColumnClick={handleColumnClick}
          onActivityClick={setEditActivity}
        />
      )}

      {/* ── Modals ── */}
      {showTripModal && (
        <TripForm onSave={handleCreateTrip} onClose={() => setShowTripModal(false)} />
      )}

      {createPos && tripId && (
        <ActivityForm
          initial={{ ...createPos, tripId }}
          onSave={handleSaveActivity}
          onClose={() => setCreatePos(null)}
        />
      )}

      {editActivity && (
        <ActivityForm
          initial={editActivity}
          onSave={handleSaveActivity}
          onDelete={() => handleDeleteActivity(editActivity.id)}
          onClose={() => setEditActivity(null)}
        />
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <p className="font-bold text-gray-900 mb-2">刪除行程？</p>
            <p className="text-sm text-gray-500 mb-5">此行程的所有活動也會一併刪除，無法復原。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={() => handleDeleteTrip(deleteConfirm)} className="px-4 py-2 rounded-xl text-sm bg-red-600 text-white hover:bg-red-700">確認刪除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Timeline Grid ──────────────────────────────────────────────────────────────
interface TimelineGridProps {
  dates: string[]
  activities: Activity[]
  dragLive: { actId: string; date: string; startMin: number; endMin: number } | null
  onActivityMouseDown: (e: React.MouseEvent, act: Activity, mode: 'move' | 'resize', colW: number) => void
  onColumnClick: (e: React.MouseEvent, date: string) => void
  onActivityClick: (act: Activity) => void
}

function TimelineGrid({ dates, activities, dragLive, onActivityMouseDown, onColumnClick, onActivityClick }: TimelineGridProps) {
  const colRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll to 07:00 on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = HOUR_PX  // 1 hour = start at 07:00 visible top
    }
  }, [])

  const timeLabels = useMemo(() => {
    const labels = []
    for (let h = START_HOUR; h <= END_HOUR; h++) labels.push(h)
    return labels
  }, [])

  // Get effective position for an activity (consider live drag)
  const getEffective = (act: Activity): { date: string; startMin: number; endMin: number } => {
    if (dragLive && dragLive.actId === act.id) {
      return { date: dragLive.date, startMin: dragLive.startMin, endMin: dragLive.endMin }
    }
    return { date: act.date, startMin: act.startMin, endMin: act.endMin }
  }

  // Group activities by (effective) date
  const byDate = useMemo(() => {
    const map = new Map<string, (Activity & { effDate: string; effStart: number; effEnd: number })[]>()
    for (const date of dates) map.set(date, [])
    for (const act of activities) {
      const eff = dragLive?.actId === act.id
        ? { effDate: dragLive.date, effStart: dragLive.startMin, effEnd: dragLive.endMin }
        : { effDate: act.date, effStart: act.startMin, effEnd: act.endMin }
      const bucket = map.get(eff.effDate)
      if (bucket) bucket.push({ ...act, ...eff })
    }
    return map
  }, [activities, dragLive, dates])

  return (
    <div className="flex-1 overflow-hidden border border-gray-200 rounded-2xl bg-white flex flex-col">
      {/* Header row with day labels */}
      <div className="flex border-b border-gray-200 shrink-0">
        {/* Time label gutter */}
        <div className="w-[52px] shrink-0 border-r border-gray-100 bg-gray-50" />
        {/* Day headers */}
        <div className="flex-1 overflow-x-auto">
          <div className="flex" style={{ minWidth: dates.length * COL_MIN_W }}>
            {dates.map((d, i) => (
              <div key={d}
                className="flex-1 min-w-0 px-3 py-2 border-r border-gray-100 last:border-0"
                style={{ minWidth: COL_MIN_W }}
              >
                <p className="text-xs font-semibold text-gray-700 truncate">{fmtDate(d, i)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div className="flex" style={{ minWidth: dates.length * COL_MIN_W + 52 }}>

          {/* Time labels (sticky left) */}
          <div className="w-[52px] shrink-0 border-r border-gray-100 relative" style={{ height: TIMELINE_H }}>
            {timeLabels.map((h, i) => (
              <div key={h}
                className="absolute left-0 right-0 flex items-center justify-end pr-2"
                style={{ top: i * HOUR_PX - 8, height: 16 }}
              >
                {h < 24 && (
                  <span className="text-[10px] text-gray-400 font-mono tabular-nums">
                    {String(h).padStart(2, '0')}:00
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {dates.map(date => {
            const dayActs = byDate.get(date) ?? []
            return (
              <div key={date}
                ref={colRef}
                className="flex-1 relative border-r border-gray-100 last:border-0 cursor-crosshair"
                style={{ height: TIMELINE_H, minWidth: COL_MIN_W }}
                onClick={e => onColumnClick(e, date)}
              >
                {/* Hour grid lines */}
                {timeLabels.slice(0, -1).map((h, i) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-gray-100"
                    style={{ top: i * HOUR_PX }} />
                ))}
                {/* 15-min sub-lines */}
                {timeLabels.slice(0, -1).flatMap((h, hi) =>
                  [1, 2, 3].map(q => (
                    <div key={`${h}-${q}`}
                      className="absolute left-0 right-0 border-t border-gray-50"
                      style={{ top: hi * HOUR_PX + q * SNAP_PX }} />
                  ))
                )}

                {/* Activity blocks */}
                {dayActs.map(act => {
                  const style = TYPE_STYLE[act.type] ?? TYPE_STYLE['其他']
                  const top    = minToPixel(act.effStart)
                  const height = Math.max(SNAP_PX, (act.effEnd - act.effStart) * (HOUR_PX / 60))
                  const isDragging = dragLive?.actId === act.id

                  return (
                    <div
                      key={act.id}
                      className={`absolute left-1 right-1 rounded-lg border-l-2 px-2 py-1 overflow-hidden
                        select-none transition-shadow
                        ${style.bg} ${style.border} ${style.text}
                        ${isDragging ? 'shadow-lg opacity-90 z-20' : 'hover:shadow-md z-10 cursor-grab active:cursor-grabbing'}
                      `}
                      style={{ top, height }}
                      onClick={e => { e.stopPropagation(); if (!dragLive) onActivityClick(act) }}
                      onMouseDown={e => {
                        e.stopPropagation()
                        const el = e.currentTarget.closest('[data-col]') as HTMLElement ?? e.currentTarget.parentElement!
                        const colW = el.getBoundingClientRect().width
                        onActivityMouseDown(e, act, 'move', colW)
                      }}
                    >
                      {/* Content */}
                      <div className="flex items-start gap-1 min-h-0">
                        <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${style.dot}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold leading-tight truncate">{act.name}</p>
                          {height >= 40 && act.location && (
                            <p className="text-[10px] opacity-70 truncate mt-0.5">{act.location}</p>
                          )}
                          {height >= 56 && (
                            <p className="text-[10px] opacity-60 tabular-nums mt-0.5">
                              {fmtMin(act.effStart)}–{fmtMin(act.effEnd)}
                            </p>
                          )}
                          {height >= 72 && act.clients && (
                            <p className="text-[10px] opacity-60 truncate mt-0.5">👥 {act.clients}</p>
                          )}
                        </div>
                      </div>

                      {/* Resize handle at bottom */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-3 cursor-s-resize flex items-center justify-center"
                        onMouseDown={e => {
                          e.stopPropagation()
                          const el = e.currentTarget.closest('[data-col]') as HTMLElement ?? e.currentTarget.parentElement!.parentElement!
                          const colW = el.getBoundingClientRect().width
                          onActivityMouseDown(e, act, 'resize', colW)
                        }}
                      >
                        <div className="w-8 h-0.5 bg-current opacity-30 rounded" />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
