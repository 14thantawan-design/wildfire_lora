/**
 * หน้าต่างกรอกพิกัดด้วยมือ
 * Component นี้ดูแลแบบฟอร์ม การตรวจค่าพิกัด และประวัติสามรายการล่าสุดด้วยตัวเอง
 */
import { useEffect, useState, type FormEvent } from 'react'
import { ChevronRight, History, MapPin, X } from 'lucide-react'
import type { ManualLocationInput, NodeStatus } from '../types'
import { formatTime, hasValidCoordinates } from '../dashboardView'

const HISTORY_KEY = 'forestguard.manual-location-history.v1'
const HISTORY_LIMIT = 3

type LocationHistoryEntry = {
  nodeId: string
  latitude: number
  longitude: number
  savedAt: string
}

type ManualLocationModalProps = {
  node: NodeStatus
  onClose: () => void
  onSave: (nodeId: string, location: ManualLocationInput) => Promise<NodeStatus>
}

/** ตรวจว่าข้อมูลจาก localStorage เป็นประวัติพิกัดที่ระบบใช้ได้จริง */
function isLocationHistoryEntry(value: unknown): value is LocationHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<LocationHistoryEntry>
  return typeof entry.nodeId === 'string'
    && typeof entry.latitude === 'number'
    && typeof entry.longitude === 'number'
    && typeof entry.savedAt === 'string'
    && hasValidCoordinates(entry.latitude, entry.longitude)
}

/** อ่านประวัติพิกัดจากเบราว์เซอร์ และคืนอาร์เรย์ว่างเมื่อข้อมูลเสียหรืออ่านไม่ได้ */
function loadLocationHistory() {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(stored)
      ? stored.filter(isLocationHistoryEntry).slice(0, HISTORY_LIMIT)
      : []
  } catch {
    return []
  }
}

/** บันทึกพิกัดล่าสุดโดยไม่ให้พิกัดเดิมซ้ำกัน */
function saveLocationHistory(current: LocationHistoryEntry[], entry: LocationHistoryEntry) {
  const next = [
    entry,
    ...current.filter((item) => item.latitude !== entry.latitude || item.longitude !== entry.longitude),
  ].slice(0, HISTORY_LIMIT)
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    // การบันทึกพิกัดหลักยังสำเร็จได้ แม้เบราว์เซอร์จะปิด localStorage
  }
  return next
}

/** แสดงแบบฟอร์มพิกัดและเรียก Backend เมื่อ Admin กดบันทึก */
export function ManualLocationModal({ node, onClose, onSave }: ManualLocationModalProps) {
  const [latitude, setLatitude] = useState(node.lat?.toFixed(6) ?? '')
  const [longitude, setLongitude] = useState(node.lng?.toFixed(6) ?? '')
  const [history, setHistory] = useState<LocationHistoryEntry[]>(loadLocationHistory)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  /** ปิด Modal เฉพาะตอนที่ไม่ได้กำลังส่งข้อมูล */
  const closeModal = () => {
    if (!saving) onClose()
  }

  /** นำพิกัดในประวัติมาใส่ในช่องกรอก */
  const selectHistory = (entry: LocationHistoryEntry) => {
    setLatitude(entry.latitude.toFixed(6))
    setLongitude(entry.longitude.toFixed(6))
    setError(undefined)
  }

  /** ตรวจค่าและส่งพิกัดที่กรอกไปยัง Backend */
  const submitLocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedLatitude = Number(latitude)
    const parsedLongitude = Number(longitude)
    if (latitude.trim() === '' || longitude.trim() === '' ||
      !hasValidCoordinates(parsedLatitude, parsedLongitude)) {
      setError('กรุณาตรวจสอบละติจูดและลองจิจูดอีกครั้ง')
      return
    }

    setSaving(true)
    setError(undefined)
    try {
      await onSave(node.node_id, { lat: parsedLatitude, lng: parsedLongitude })
      const entry = {
        nodeId: node.node_id,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        savedAt: new Date().toISOString(),
      }
      setHistory(saveLocationHistory(history, entry))
      onClose()
    } catch {
      setError('บันทึกพิกัดไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  // ระหว่างเปิด Modal ให้ Escape ปิดหน้าต่างและหยุดหน้าเว็บด้านหลังไม่ให้เลื่อน
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose, saving])

  return (
    <div className="location-modal-backdrop" onMouseDown={closeModal} role="presentation">
      <section
        aria-labelledby="manual-location-title"
        aria-modal="true"
        className="location-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span>MANUAL LOCATION</span>
            <h2 id="manual-location-title">กำหนดพิกัดเอง · {node.node_id}</h2>
          </div>
          <button aria-label="ปิดหน้าต่างกรอกพิกัด" disabled={saving} onClick={closeModal} title="ปิด" type="button">
            <X size={18} />
          </button>
        </header>
        <form onSubmit={(event) => void submitLocation(event)}>
          <p className="location-form-note">
            เมื่อบันทึก ระบบจะใช้พิกัดนี้แทนและสั่งให้ Node หยุดค้นหา GPS ในรอบสื่อสารถัดไป
          </p>
          <div className="coordinate-fields">
            <label>
              <span>ละติจูด</span>
              <input
                autoFocus
                inputMode="decimal"
                max="90"
                min="-90"
                onChange={(event) => setLatitude(event.target.value)}
                placeholder="เช่น 18.788300"
                required
                step="any"
                type="number"
                value={latitude}
              />
            </label>
            <label>
              <span>ลองจิจูด</span>
              <input
                inputMode="decimal"
                max="180"
                min="-180"
                onChange={(event) => setLongitude(event.target.value)}
                placeholder="เช่น 98.985300"
                required
                step="any"
                type="number"
                value={longitude}
              />
            </label>
          </div>
          {history.length > 0 && (
            <section className="coordinate-history" aria-label="พิกัดที่ใช้ล่าสุด">
              <div className="coordinate-history-title">
                <History size={14} />
                <span>พิกัดล่าสุด</span>
                <small>เลือกใช้ได้ทันที</small>
              </div>
              <div className="coordinate-history-list">
                {history.map((entry) => (
                  <button
                    disabled={saving}
                    key={`${entry.latitude}:${entry.longitude}`}
                    onClick={() => selectHistory(entry)}
                    type="button"
                  >
                    <MapPin size={14} />
                    <span>
                      <strong>{entry.latitude.toFixed(6)}, {entry.longitude.toFixed(6)}</strong>
                      <small>{entry.nodeId} · บันทึกเมื่อ {formatTime(entry.savedAt)}</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            </section>
          )}
          {error && <p className="location-form-error" role="alert">{error}</p>}
          <footer>
            <button disabled={saving} onClick={closeModal} type="button">ยกเลิก</button>
            <button className="save-location-button" disabled={saving} type="submit">
              <MapPin size={15} /> {saving ? 'กำลังบันทึก' : 'บันทึกพิกัด'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
