/** แบบฟอร์มแก้ไข Reading หนึ่งรายการในหน้า Admin */
import type { FormEvent } from 'react'
import { Save, X } from 'lucide-react'
import type { AdminReading, EditDraft } from './adminReadings'

type ReadingEditorModalProps = {
  reading: AdminReading
  draft: EditDraft
  saving: boolean
  error?: string
  onDraftChange: (draft: EditDraft) => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
}

/** แสดงช่องแก้ไขค่าเซนเซอร์ ส่วนการส่ง API ยังคงอยู่ใน AdminReadingsPage */
export function ReadingEditorModal({
  reading,
  draft,
  saving,
  error,
  onDraftChange,
  onClose,
  onSubmit,
}: ReadingEditorModalProps) {
  return (
    <div className="reading-editor-backdrop" onMouseDown={onClose} role="presentation">
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
            <h2 id="reading-editor-title">แก้ไขข้อมูล · {reading.node_id}</h2>
          </div>
          <button aria-label="ปิดหน้าต่างแก้ไข" disabled={saving} onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <form onSubmit={onSubmit}>
          <div className="reading-editor-grid">
            <label className="wide-field">
              <span>วันและเวลา</span>
              <input onChange={(event) => onDraftChange({ ...draft, timestamp: event.target.value })} required step="1" type="datetime-local" value={draft.timestamp} />
            </label>
            <label>
              <span>อุณหภูมิ (°C)</span>
              <input onChange={(event) => onDraftChange({ ...draft, air_temp: event.target.value })} step="0.1" type="number" value={draft.air_temp} />
            </label>
            <label>
              <span>ความชื้น (%)</span>
              <input onChange={(event) => onDraftChange({ ...draft, humidity: event.target.value })} step="0.1" type="number" value={draft.humidity} />
            </label>
            <label>
              <span>ค่าควัน ADC</span>
              <input onChange={(event) => onDraftChange({ ...draft, particle_adc: event.target.value })} step="1" type="number" value={draft.particle_adc} />
            </label>
            <label>
              <span>LoRa RSSI (dBm)</span>
              <input onChange={(event) => onDraftChange({ ...draft, rssi: event.target.value })} step="1" type="number" value={draft.rssi} />
            </label>
            <label>
              <span>LoRa SNR (dB)</span>
              <input onChange={(event) => onDraftChange({ ...draft, snr: event.target.value })} step="0.1" type="number" value={draft.snr} />
            </label>
          </div>
          {error && <p className="reading-editor-error" role="alert">{error}</p>}
          <div className="reading-editor-actions">
            <button disabled={saving} onClick={onClose} type="button">ยกเลิก</button>
            <button className="save-reading-button" disabled={saving} type="submit">
              <Save size={15} /> {saving ? 'กำลังบันทึก' : 'บันทึกการแก้ไข'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
