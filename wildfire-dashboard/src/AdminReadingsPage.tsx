import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { stateLabels } from './nodeStates'
import type { NodeState, Reading } from './types'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

type AdminReading = Omit<Reading, '_id'> & { _id: string }

type AdminReadingsResponse = {
  items: AdminReading[]
  total: number
  page: number
  limit: number
  node_ids: string[]
}

type EditDraft = {
  timestamp: string
  air_temp: string
  humidity: string
  particle_ug_m3: string
  sensor_health: string
  rssi: string
  snr: string
}

type AdminReadingsPageProps = {
  onDataChanged?: () => void | Promise<void>
}

async function adminJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const body = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) {
    if (response.status === 403) throw new Error('บัญชีหรือโดเมนนี้ไม่มีสิทธิ์จัดการข้อมูล')
    throw new Error(body.error || `API ${response.status}`)
  }
  return body as T
}

function formatReadingDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function toDateTimeInput(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 19)
}

function toEditDraft(reading: AdminReading): EditDraft {
  const asInput = (value: number | null | undefined) => value == null ? '' : String(value)
  return {
    timestamp: toDateTimeInput(reading.timestamp),
    air_temp: asInput(reading.air_temp),
    humidity: asInput(reading.humidity),
    particle_ug_m3: asInput(reading.particle_ug_m3),
    sensor_health: reading.sensor_health ?? '',
    rssi: asInput(reading.rssi),
    snr: asInput(reading.snr),
  }
}

function displayNumber(value: number | null | undefined, suffix = '', digits = 1) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString('en-US', { maximumFractionDigits: digits })}${suffix}`
}

function nullableNumber(value: string) {
  return value.trim() === '' ? null : Number(value)
}

function effectiveState(reading: AdminReading): NodeState {
  return reading.state ?? 'UNKNOWN'
}

export function AdminReadingsPage({ onDataChanged }: AdminReadingsPageProps) {
  const [result, setResult] = useState<AdminReadingsResponse>({
    items: [],
    total: 0,
    page: 1,
    limit: 50,
    node_ids: [],
  })
  const [nodeFilter, setNodeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [editing, setEditing] = useState<AdminReading>()
  const [draft, setDraft] = useState<EditDraft>()
  const requestIdRef = useRef(0)

  const loadReadings = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(undefined)
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (nodeFilter) params.set('node_id', nodeFilter)

    try {
      const data = await adminJson<AdminReadingsResponse>(`/readings/admin?${params}`)
      if (requestId !== requestIdRef.current) return
      const lastPage = Math.max(1, Math.ceil(data.total / data.limit))
      if (page > lastPage) {
        setPage(lastPage)
        return
      }
      setResult(data)
      setSelectedIds(new Set())
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return
      setError(loadError instanceof Error ? loadError.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [limit, nodeFilter, page])

  useEffect(() => {
    void loadReadings()
    return () => {
      requestIdRef.current += 1
    }
  }, [loadReadings])

  const pageIds = useMemo(() => result.items.map((reading) => reading._id), [result.items])
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const totalPages = Math.max(1, Math.ceil(result.total / result.limit))
  const firstRow = result.total === 0 ? 0 : (result.page - 1) * result.limit + 1
  const lastRow = Math.min(result.page * result.limit, result.total)

  const toggleAllPage = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  const toggleReading = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openEditor = (reading: AdminReading) => {
    setEditing(reading)
    setDraft(toEditDraft(reading))
    setError(undefined)
  }

  const closeEditor = () => {
    if (saving) return
    setEditing(undefined)
    setDraft(undefined)
  }

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing || !draft) return
    setSaving(true)
    setError(undefined)

    try {
      await adminJson<AdminReading>(`/readings/admin/${encodeURIComponent(editing._id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          timestamp: new Date(draft.timestamp).toISOString(),
          air_temp: nullableNumber(draft.air_temp),
          humidity: nullableNumber(draft.humidity),
          particle_ug_m3: nullableNumber(draft.particle_ug_m3),
          sensor_health: draft.sensor_health || null,
          rssi: nullableNumber(draft.rssi),
          snr: nullableNumber(draft.snr),
        }),
      })
      setEditing(undefined)
      setDraft(undefined)
      await loadReadings()
      await onDataChanged?.()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'บันทึกข้อมูลไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const deleteReadings = async (ids: string[]) => {
    if (ids.length === 0) return
    const message = ids.length === 1
      ? 'ลบข้อมูลวัดรายการนี้ออกจากฐานข้อมูลอย่างถาวรหรือไม่'
      : `ลบข้อมูลวัด ${ids.length} รายการออกจากฐานข้อมูลอย่างถาวรหรือไม่`
    if (!window.confirm(message)) return

    setDeleting(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await adminJson<{ deleted: number }>('/readings/admin', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      })
      await loadReadings()
      await onDataChanged?.()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'ลบข้อมูลไม่สำเร็จ')
    } finally {
      setDeleting(false)
    }
  }

  const deleteAllForNode = async () => {
    if (!nodeFilter || result.total === 0) return
    const nodeId = nodeFilter
    const confirmed = window.confirm(
      `ลบข้อมูลวัดทั้งหมดของ ${nodeId} จำนวน ${result.total.toLocaleString('th-TH')} รายการอย่างถาวรหรือไม่\n\n` +
      'ข้อมูลของ Node อื่นจะไม่ถูกลบ และการดำเนินการนี้ย้อนกลับไม่ได้',
    )
    if (!confirmed) return

    setDeleting(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const response = await adminJson<{ node_id: string; deleted: number }>(
        `/readings/admin/node/${encodeURIComponent(nodeId)}`,
        { method: 'DELETE' },
      )
      setSelectedIds(new Set())
      setNotice(`ลบข้อมูลทั้งหมดของ ${response.node_id} แล้ว ${response.deleted.toLocaleString('th-TH')} รายการ`)
      await loadReadings()
      await onDataChanged?.()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : `ลบข้อมูลทั้งหมดของ ${nodeId} ไม่สำเร็จ`)
    } finally {
      setDeleting(false)
    }
  }

  const nodeOptions = nodeFilter && !result.node_ids.includes(nodeFilter)
    ? [nodeFilter, ...result.node_ids]
    : result.node_ids

  return (
    <div className="content admin-data-page" id="admin-data">
      <section className="page-heading admin-data-heading">
        <div>
          <span className="eyebrow">ADMIN · SENSOR RECORDS</span>
          <h1>จัดการข้อมูลที่ตรวจวัด</h1>
          <p>ค้นหา ตรวจสอบ แก้ไข และลบประวัติข้อมูลที่ส่งมาจากทุก Node</p>
        </div>
        <span className="admin-record-count">
          <Database size={18} />
          <span>{nodeFilter ? `ข้อมูลของ ${nodeFilter}` : 'ข้อมูลทั้งหมด'}</span>
          <strong>{result.total.toLocaleString('th-TH')} รายการ</strong>
        </span>
      </section>

      <section className="panel admin-table-panel">
        <header className="admin-table-toolbar">
          <div className="admin-table-filters">
            <label>
              <span>แสดงข้อมูลของ</span>
              <select
                aria-label="กรองตาม Node"
                onChange={(event) => {
                  setNodeFilter(event.target.value)
                  setPage(1)
                }}
                value={nodeFilter}
              >
                <option value="">ทุก Node</option>
                {nodeOptions.map((nodeId) => <option key={nodeId} value={nodeId}>{nodeId}</option>)}
              </select>
            </label>
            <label>
              <span>จำนวนต่อหน้า</span>
              <select
                aria-label="จำนวนข้อมูลต่อหน้า"
                onChange={(event) => {
                  setLimit(Number(event.target.value))
                  setPage(1)
                }}
                value={limit}
              >
                <option value="25">25 รายการ</option>
                <option value="50">50 รายการ</option>
                <option value="100">100 รายการ</option>
              </select>
            </label>
            <button
              aria-label="โหลดตารางใหม่"
              className="admin-refresh-button"
              disabled={loading}
              onClick={() => void loadReadings()}
              title="โหลดตารางใหม่"
              type="button"
            >
              <RefreshCw className={loading ? 'spin' : ''} size={16} />
            </button>
          </div>
          <div className="admin-delete-actions">
            <button
              className="node-delete-all-button"
              disabled={!nodeFilter || result.total === 0 || deleting || loading}
              onClick={() => void deleteAllForNode()}
              title={nodeFilter ? `ลบข้อมูลวัดทั้งหมดของ ${nodeFilter}` : 'เลือก Node ที่ต้องการลบข้อมูลทั้งหมดก่อน'}
              type="button"
            >
              <Trash2 size={15} />
              {nodeFilter ? `ลบทั้งหมดของ ${nodeFilter}` : 'เลือก Node เพื่อลบทั้งหมด'}
            </button>
            <button
              className="bulk-delete-button"
              disabled={selectedIds.size === 0 || deleting}
              onClick={() => void deleteReadings([...selectedIds])}
              type="button"
            >
              <Trash2 size={15} />
              ลบที่เลือก {selectedIds.size > 0 ? `${selectedIds.size} รายการ` : ''}
            </button>
          </div>
        </header>

        {error && <div className="admin-data-error" role="alert">{error}</div>}
        {notice && <div className="admin-data-notice" role="status">{notice}</div>}

        <div className={`admin-table-scroll ${loading ? 'loading' : ''}`}>
          <table className="admin-readings-table">
            <thead>
              <tr>
                <th className="select-column">
                  <input
                    aria-label="เลือกข้อมูลทั้งหมดในหน้านี้"
                    checked={allPageSelected}
                    onChange={toggleAllPage}
                    type="checkbox"
                  />
                </th>
                <th>วันและเวลา</th>
                <th>Node</th>
                <th>อุณหภูมิ</th>
                <th>ความชื้น</th>
                <th>อนุภาคโดยประมาณ</th>
                <th>สถานะระบบ</th>
                <th>เซนเซอร์</th>
                <th>RSSI / SNR</th>
                <th className="action-column">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((reading) => {
                const state = effectiveState(reading)
                return (
                  <tr className={selectedIds.has(reading._id) ? 'selected' : undefined} key={reading._id}>
                    <td className="select-column">
                      <input
                        aria-label={`เลือกข้อมูล ${reading.node_id} เวลา ${formatReadingDate(reading.timestamp)}`}
                        checked={selectedIds.has(reading._id)}
                        onChange={() => toggleReading(reading._id)}
                        type="checkbox"
                      />
                    </td>
                    <td><time dateTime={reading.timestamp}>{formatReadingDate(reading.timestamp)}</time></td>
                    <td><strong className="reading-node-id">{reading.node_id}</strong></td>
                    <td>{displayNumber(reading.air_temp, '°C')}</td>
                    <td>{displayNumber(reading.humidity, '%')}</td>
                    <td>{displayNumber(reading.particle_ug_m3, ' µg/m³', 1)}</td>
                    <td><span className={`reading-state state-${state.toLowerCase()}`}>{stateLabels[state]}</span></td>
                    <td>{reading.sensor_health || '—'}</td>
                    <td>{displayNumber(reading.rssi, ' dBm', 0)} <small>/ {displayNumber(reading.snr, ' dB')}</small></td>
                    <td className="action-column">
                      <button
                        aria-label={`แก้ไขข้อมูล ${reading.node_id}`}
                        className="table-edit-button"
                        onClick={() => openEditor(reading)}
                        title="แก้ไข"
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        aria-label={`ลบข้อมูล ${reading.node_id}`}
                        className="table-delete-button"
                        disabled={deleting}
                        onClick={() => void deleteReadings([reading._id])}
                        title="ลบ"
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {!loading && result.items.length === 0 && (
            <div className="admin-table-empty">
              <Database size={26} />
              <strong>ไม่พบข้อมูลที่ตรวจวัด</strong>
              <span>{nodeFilter ? `ยังไม่มีข้อมูลของ ${nodeFilter}` : 'ฐานข้อมูลยังไม่มีรายการวัด'}</span>
            </div>
          )}
        </div>

        <footer className="admin-table-pagination">
          <span>แสดง {firstRow.toLocaleString('th-TH')}–{lastRow.toLocaleString('th-TH')} จาก {result.total.toLocaleString('th-TH')} รายการ</span>
          <div>
            <button
              aria-label="หน้าก่อนหน้า"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              <ChevronLeft size={15} />
            </button>
            <strong>หน้า {page.toLocaleString('th-TH')} / {totalPages.toLocaleString('th-TH')}</strong>
            <button
              aria-label="หน้าถัดไป"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
              type="button"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </footer>
      </section>

      <p className="admin-data-note">
        การแก้ไขมีผลกับข้อมูลวัดและกราฟย้อนหลัง ส่วนเหตุการณ์แจ้งเตือนที่ส่งไปแล้วจะไม่ถูกคำนวณย้อนหลังใหม่
      </p>

      {editing && draft && (
        <div className="reading-editor-backdrop" onMouseDown={closeEditor} role="presentation">
          <section
            aria-labelledby="reading-editor-title"
            aria-modal="true"
            className="reading-editor"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <div>
                <span>EDIT SENSOR RECORD</span>
                <h2 id="reading-editor-title">แก้ไขข้อมูล · {editing.node_id}</h2>
              </div>
              <button aria-label="ปิดหน้าต่างแก้ไข" disabled={saving} onClick={closeEditor} type="button">
                <X size={18} />
              </button>
            </header>
            <form onSubmit={(event) => void submitEdit(event)}>
              <div className="reading-editor-grid">
                <label className="wide-field">
                  <span>วันและเวลา</span>
                  <input
                    onChange={(event) => setDraft({ ...draft, timestamp: event.target.value })}
                    required
                    step="1"
                    type="datetime-local"
                    value={draft.timestamp}
                  />
                </label>
                <label>
                  <span>อุณหภูมิ (°C)</span>
                  <input max="100" min="-80" onChange={(event) => setDraft({ ...draft, air_temp: event.target.value })} step="0.1" type="number" value={draft.air_temp} />
                </label>
                <label>
                  <span>ความชื้น (%)</span>
                  <input max="100" min="0" onChange={(event) => setDraft({ ...draft, humidity: event.target.value })} step="0.1" type="number" value={draft.humidity} />
                </label>
                <label>
                  <span>อนุภาคโดยประมาณ (µg/m³)</span>
                  <input max="2000" min="0" onChange={(event) => setDraft({ ...draft, particle_ug_m3: event.target.value })} step="0.1" type="number" value={draft.particle_ug_m3} />
                </label>
                <label>
                  <span>สถานะเซนเซอร์</span>
                  <select onChange={(event) => setDraft({ ...draft, sensor_health: event.target.value })} value={draft.sensor_health}>
                    <option value="">ไม่ระบุ</option>
                    <option value="OK">OK</option>
                    <option value="FAULT">FAULT</option>
                  </select>
                </label>
                <label>
                  <span>LoRa RSSI (dBm)</span>
                  <input max="50" min="-200" onChange={(event) => setDraft({ ...draft, rssi: event.target.value })} step="1" type="number" value={draft.rssi} />
                </label>
                <label>
                  <span>LoRa SNR (dB)</span>
                  <input max="50" min="-50" onChange={(event) => setDraft({ ...draft, snr: event.target.value })} step="0.1" type="number" value={draft.snr} />
                </label>
              </div>
              {error && <p className="reading-editor-error" role="alert">{error}</p>}
              <div className="reading-editor-actions">
                <button disabled={saving} onClick={closeEditor} type="button">ยกเลิก</button>
                <button className="save-reading-button" disabled={saving} type="submit">
                  <Save size={15} /> {saving ? 'กำลังบันทึก' : 'บันทึกการแก้ไข'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
