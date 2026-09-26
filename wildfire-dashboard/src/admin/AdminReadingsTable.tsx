/** ตารางแสดง Reading พร้อม checkbox และปุ่มแก้ไข/ลบแต่ละแถว */
import { Database, Pencil, Trash2 } from 'lucide-react'
import { stateLabels } from '../nodeStates'
import {
  displayNumber,
  formatReadingDate,
  type AdminReading,
} from './adminReadings'

type AdminReadingsTableProps = {
  readings: AdminReading[]
  selectedIds: Set<string>
  allPageSelected: boolean
  loading: boolean
  deleting: boolean
  nodeFilter: string
  onToggleAll: () => void
  onToggleReading: (id: string) => void
  onEdit: (reading: AdminReading) => void
  onDelete: (id: string) => void
}

/** วาดหัวตารางและทุกแถว โดยส่งการกดปุ่มกลับไปให้หน้าหลักจัดการ API */
export function AdminReadingsTable({
  readings,
  selectedIds,
  allPageSelected,
  loading,
  deleting,
  nodeFilter,
  onToggleAll,
  onToggleReading,
  onEdit,
  onDelete,
}: AdminReadingsTableProps) {
  return (
    <div className={`admin-table-scroll ${loading ? 'loading' : ''}`}>
      <table className="admin-readings-table">
        <thead>
          <tr>
            <th className="select-column">
              <input
                aria-label="เลือกข้อมูลทั้งหมดในหน้านี้"
                checked={allPageSelected}
                onChange={onToggleAll}
                type="checkbox"
              />
            </th>
            <th>วันและเวลา</th>
            <th>Node</th>
            <th>อุณหภูมิ</th>
            <th>ความชื้น</th>
            <th>ค่าควัน ADC</th>
            <th>สถานะระบบ</th>
            <th>RSSI / SNR</th>
            <th className="action-column">จัดการ</th>
          </tr>
        </thead>
        <tbody>
          {readings.map((reading) => {
            const state = reading.state ?? 'UNKNOWN'
            return (
              <tr className={selectedIds.has(reading._id) ? 'selected' : undefined} key={reading._id}>
                <td className="select-column">
                  <input
                    aria-label={`เลือกข้อมูล ${reading.node_id} เวลา ${formatReadingDate(reading.timestamp)}`}
                    checked={selectedIds.has(reading._id)}
                    onChange={() => onToggleReading(reading._id)}
                    type="checkbox"
                  />
                </td>
                <td><time dateTime={reading.timestamp}>{formatReadingDate(reading.timestamp)}</time></td>
                <td><strong className="reading-node-id">{reading.node_id}</strong></td>
                <td>{displayNumber(reading.air_temp, '°C')}</td>
                <td>{displayNumber(reading.humidity, '%')}</td>
                <td>{displayNumber(reading.particle_adc, ' ADC', 0)}</td>
                <td><span className={`reading-state state-${state.toLowerCase()}`}>{stateLabels[state]}</span></td>
                <td>{displayNumber(reading.rssi, ' dBm', 0)} <small>/ {displayNumber(reading.snr, ' dB')}</small></td>
                <td className="action-column">
                  <button aria-label={`แก้ไขข้อมูล ${reading.node_id}`} className="table-edit-button" onClick={() => onEdit(reading)} title="แก้ไข" type="button">
                    <Pencil size={14} />
                  </button>
                  <button aria-label={`ลบข้อมูล ${reading.node_id}`} className="table-delete-button" disabled={deleting} onClick={() => onDelete(reading._id)} title="ลบ" type="button">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {!loading && readings.length === 0 && (
        <div className="admin-table-empty">
          <Database size={26} />
          <strong>ไม่พบข้อมูลที่ตรวจวัด</strong>
          <span>{nodeFilter ? `ยังไม่มีข้อมูลของ ${nodeFilter}` : 'ฐานข้อมูลยังไม่มีรายการวัด'}</span>
        </div>
      )}
    </div>
  )
}
