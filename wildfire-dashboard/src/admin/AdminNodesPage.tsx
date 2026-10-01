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
    if (!modelConfirmed) { setError('ยืนยันรุ่นบอร์ดและการติดตั้งเฟิร์มแวร์ก่อน'); return }
    if (replace && !window.confirm(
      `ติดตั้งใหม่สำหรับ NODE${String(number).padStart(2, '0')} หรือไม่\n` +
      'กุญแจของบอร์ดเดิมจะถูกยกเลิกทันที ประวัติยังอยู่ ถ้าตั้งค่าไม่สำเร็จโหนดจะยังไม่รับข้อมูล',
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
        <p>เฉพาะ Admin · ตั้งค่าผ่าน USB · ลบแล้วเก็บประวัติ · ใช้บอร์ดและ Gateway เดิม</p>
      </div></section>
      <section className="panel node-registration-panel">
        <h2><Usb size={20} /> เตรียมบอร์ดก่อนลงทะเบียน</h2>
        <p>1. เสียบบอร์ดโหนดด้วยสาย USB ที่ส่งข้อมูลได้ แล้วปิด Serial Monitor ของ Arduino</p>
        <p>2. ติดตั้งเฟิร์มแวร์ FG1 ของโครงงาน จากนั้นปิดหน้าติดตั้งเพื่อคืนพอร์ต USB</p>
        <a className="admin-data-link" href="/firmware/index.html" target="_blank" rel="noopener noreferrer">เปิดหน้าติดตั้งเฟิร์มแวร์ผ่าน USB</a>
        <p>3. กดเพิ่ม / คืนโหนด หรือ ติดตั้งใหม่ / เปลี่ยนบอร์ด ในแถว NODE ที่ต้องการ เว็บจะตั้งค่าบอร์ดตามรหัสของแถวนั้น ไม่ต้องกรอกเลขหรือแก้โค้ด</p>
        <label className="node-model-confirm">
          <input checked={modelConfirmed} disabled={busy} onChange={(event) => setModelConfirmed(event.target.checked)} type="checkbox" />
          บอร์ดเป็น LILYGO LoRa32 ESP32 รุ่น 433 MHz ใช้การต่อเซนเซอร์ตามโครงงาน และติดตั้งเฟิร์มแวร์ FG1 แล้ว
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
