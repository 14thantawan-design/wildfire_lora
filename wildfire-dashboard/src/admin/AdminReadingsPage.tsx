/** หน้าหลักสำหรับค้นหา แก้ไข และลบข้อมูล Reading ของผู้ดูแลระบบ */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Database,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import {
  adminJson,
  nullableNumber,
  toEditDraft,
  type AdminReading,
  type AdminReadingsResponse,
  type EditDraft,
} from './adminReadings'
import { AdminReadingsTable } from './AdminReadingsTable'
import { ReadingEditorModal } from './ReadingEditorModal'

type AdminReadingsPageProps = {
  onDataChanged?: () => void | Promise<void>
}

/** ดูแลตัวกรอง pagination การเลือกแถว และการเรียก Admin API */
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

  /** โหลดข้อมูลตาม Node หน้า และจำนวนรายการที่เลือก */
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

  /** เลือกหรือยกเลิกทุกแถวที่อยู่ในหน้าปัจจุบัน */
  const toggleAllPage = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  /** สลับการเลือก Reading หนึ่งรายการ */
  const toggleReading = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** เปิดแบบฟอร์มและคัดลอกค่า Reading มาเป็นข้อมูลร่าง */
  const openEditor = (reading: AdminReading) => {
    setEditing(reading)
    setDraft(toEditDraft(reading))
    setError(undefined)
  }

  /** ปิดแบบฟอร์มเมื่อไม่ได้กำลังบันทึก */
  const closeEditor = () => {
    if (saving) return
    setEditing(undefined)
    setDraft(undefined)
  }

  /** ส่งข้อมูลร่างที่แก้แล้วไปยัง Backend */
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
          particle_adc: nullableNumber(draft.particle_adc),
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

  /** ยืนยันและลบ Reading ตามรายการ id ที่เลือก */
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

  /** ลบ Reading ทั้งหมดของ Node ที่กำลังกรองอยู่ */
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

        <AdminReadingsTable
          readings={result.items}
          selectedIds={selectedIds}
          allPageSelected={allPageSelected}
          loading={loading}
          deleting={deleting}
          nodeFilter={nodeFilter}
          onToggleAll={toggleAllPage}
          onToggleReading={toggleReading}
          onEdit={openEditor}
          onDelete={(id) => void deleteReadings([id])}
        />

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
        <ReadingEditorModal
          reading={editing}
          draft={draft}
          saving={saving}
          error={error}
          onDraftChange={setDraft}
          onClose={closeEditor}
          onSubmit={(event) => void submitEdit(event)}
        />
      )}
    </div>
  )
}
