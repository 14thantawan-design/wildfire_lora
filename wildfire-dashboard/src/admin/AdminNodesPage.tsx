import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw, RotateCw, Trash2, Usb } from 'lucide-react'
import { adminJson, formatReadingDate } from './adminReadings'
import { registerNodeThroughUsb, supportsNodeUsb } from './serialNodeSetup'

type ManagedNode = {
  node_id: string
  status: 'legacy' | 'pending' | 'active' | 'archived'
  last_seen?: string
  expires_at?: string
}
const statusLabels = {
  legacy: 'ระบบเดิม · ยังไม่ลงทะเบียนกุญแจ',
  pending: 'ยังตั้งค่าไม่เสร็จ · ยังส่งข้อมูลไม่ได้',
  active: 'ลงทะเบียนแล้ว',
  archived: 'ถูกลบจากหน้าสด · เก็บประวัติไว้',
}

export function AdminNodesPage({ onDataChanged }: { onDataChanged?: () => void | Promise<void> }) {
  const [nodes, setNodes] = useState<ManagedNode[]>([])
  const [modelConfirmed, setModelConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => { setNodes(await adminJson<ManagedNode[]>('/devices')) }, [])
  useEffect(() => {
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'โหลดรายการไม่สำเร็จ'))
  }, [load])

  const register = async (number: number, replace = false) => {
    if (!modelConfirmed) { setError('ยืนยันว่าเสียบบอร์ดโหนดรุ่นที่รองรับก่อน'); return }
    if (replace && !window.confirm(
      `ติดตั้งใหม่สำหรับ NODE${String(number).padStart(2, '0')} หรือไม่\n` +
      'เว็บจะติดตั้งโปรแกรม FG1 ลงบอร์ดที่เสียบ USB และตั้งค่ากุญแจใหม่\n' +
      'กุญแจเดิมจะถูกยกเลิกเมื่อเริ่มตั้งค่าหลังติดตั้ง ประวัติยังอยู่ ถ้าตั้งค่าไม่สำเร็จโหนดจะยังไม่รับข้อมูล',
    )) return
    setBusy(true); setError(''); setNotice('')
    try {
      const id = await registerNodeThroughUsb(number, replace, setNotice)
      setNotice(`${id} ลงทะเบียนแล้ว รอข้อมูลใหม่จากโหนดจึงแสดงออนไลน์ กุญแจเดิมใช้ไม่ได้แล้ว`)
      await load()
      await onDataChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ลงทะเบียนไม่สำเร็จ')
      setNotice('')
      await load().catch(() => undefined)
    } finally { setBusy(false) }
  }
  const remove = async (node: ManagedNode) => {
    if (!window.confirm(`ลบ ${node.node_id} จากหน้าสดและยกเลิกกุญแจหรือไม่\nประวัติการวัดและแจ้งเตือนจะไม่ถูกลบ`)) return
    setBusy(true); setError('')
    try {
      await adminJson(`/devices/${node.node_id}`, { method: 'DELETE' })
      setNotice(`ซ่อน ${node.node_id} และยกเลิกกุญแจแล้ว ประวัติยังอยู่ตามรหัสเดิม`)
      await load()
      await onDataChanged?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'ลบโหนดไม่สำเร็จ') }
    finally { setBusy(false) }
  }
  return (
    <div className="content admin-data-page" id="admin-nodes">
      <section className="page-heading"><div><span className="eyebrow">ADMIN · NODE REGISTRATION</span>
        <h1>จัดการโหนด NODE01–NODE10</h1>
        <p>เฉพาะ Admin · ติดตั้งและลงทะเบียนผ่าน USB ในปุ่มเดียว · ลบแล้วเก็บประวัติ</p>
      </div></section>
      <section className="panel node-registration-panel">
        <h2><Usb size={20} /> เพิ่มโหนดและติดตั้งโปรแกรมในปุ่มเดียว</h2>
        <p>1. เสียบบอร์ดโหนดด้วยสาย USB ที่ส่งข้อมูลได้ แล้วปิด Serial Monitor ของ Arduino</p>
        <p>2. ยืนยันรุ่นบอร์ด แล้วกดเพิ่ม / คืนโหนดในแถว NODE ที่ต้องการ และเลือกพอร์ต USB</p>
        <p>3. รอเว็บติดตั้ง FG1 แล้วตั้งรหัสและกุญแจโหนดต่อให้เอง ไม่ต้องติดตั้งล่วงหน้า ไม่ต้องไปอีกหน้า และไม่ต้องแก้โค้ด</p>
        <label className="node-model-confirm">
          <input checked={modelConfirmed} disabled={busy} onChange={(event) => setModelConfirmed(event.target.checked)} type="checkbox" />
          เสียบบอร์ดโหนด LILYGO LoRa32 ESP32 แฟลช 4 MB รุ่น 433 MHz ตามการต่อเซนเซอร์ของโครงงาน (ไม่ใช่ Gateway) และยินยอมให้แทนที่โปรแกรมบนบอร์ดนี้ด้วย FG1
        </label>
        {!supportsNodeUsb() && <p role="alert">เบราว์เซอร์นี้ยังใช้ USB ไม่ได้ เปิดบน HTTPS/localhost ด้วยเบราว์เซอร์ที่รองรับ Web Serial</p>}
        <div className="node-registration-actions">
          <button aria-label="โหลดรายการโหนดใหม่" disabled={busy} type="button"
            onClick={() => void load().catch((reason: unknown) => setError(String(reason)))}><RefreshCw size={16} /></button>
        </div>
        {error && <div className="admin-data-error" role="alert">{error}</div>}
        {notice && <div className="admin-data-notice" role="status">{notice}</div>}
      </section>
      <section className="panel admin-table-panel"><div className="admin-table-scroll">
        <table className="admin-readings-table node-management-table">
          <thead><tr><th>รหัส</th><th>สถานะการลงทะเบียน</th><th>ข้อมูลล่าสุด (เวลาไทย)</th><th>จัดการ</th></tr></thead>
          <tbody>{Array.from({ length: 10 }, (_, index) => {
            const number = index + 1
            const id = `NODE${String(number).padStart(2, '0')}`
            const node = nodes.find((value) => value.node_id === id)
            const available = !node || node.status === 'archived'
            return <tr key={id}>
              <td><strong>{id}</strong></td>
              <td>{node ? statusLabels[node.status] : 'ว่าง · ยังไม่เคยลงทะเบียน'}
                {node?.status === 'pending' && node.expires_at && <small> · หมดอายุ {formatReadingDate(node.expires_at)}</small>}</td>
              <td>{node?.last_seen ? formatReadingDate(node.last_seen) : 'ยังไม่มีข้อมูลใหม่'}</td>
              <td><button className="admin-data-link" disabled={busy || !modelConfirmed || !supportsNodeUsb()} type="button"
                onClick={() => void register(number, !available)}>
                {available ? <Plus size={14} /> : <RotateCw size={14} />}{available ? 'เพิ่ม / คืนโหนด' : 'ติดตั้งใหม่ / เปลี่ยนบอร์ด'}
              </button>
                {node && node.status !== 'archived' && <button className="table-delete-button" aria-label={`ลบ ${id} โดยเก็บประวัติ`}
                  disabled={busy} type="button" onClick={() => void remove(node)}><Trash2 size={14} /></button>}
              </td>
            </tr>
          })}</tbody>
        </table>
      </div></section>
      <p className="admin-data-note">ชื่อ NODE คือรหัสประวัติ ไม่ใช่กุญแจยืนยันตัวตน การคืนเลขเดิมจะใช้ประวัติเดิมและกุญแจใหม่ ปุ่มลบโหนดนี้ไม่ใช่ปุ่มลบประวัติในหน้าจัดการข้อมูล</p>
    </div>
  )
}
