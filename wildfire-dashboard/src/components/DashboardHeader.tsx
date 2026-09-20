/** แถบหัวเว็บที่แสดงชื่อระบบ สถานะ Gateway และทางเข้าหน้า Admin */
import { ArrowLeft, Database, Flame, RadioTower } from 'lucide-react'

type DashboardHeaderProps = {
  gatewayConnected: boolean
  adminMode: boolean
  adminDataOpen: boolean
}

/** แสดงส่วนหัวร่วมกันทั้งหน้าภาพรวมและหน้าจัดการข้อมูล */
export function DashboardHeader({ gatewayConnected, adminMode, adminDataOpen }: DashboardHeaderProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"><Flame size={22} /></span>
        <div>
          <strong>FOREST<span>GUARD</span></strong>
          <small>LoRa early warning</small>
        </div>
      </div>

      <div className={`gateway-card ${gatewayConnected ? '' : 'disconnected'}`}>
        <span className="gateway-icon"><RadioTower size={18} /></span>
        <div>
          <strong>LoRa Gateway</strong>
          <small><i /> {gatewayConnected ? 'เชื่อมต่อระบบ' : 'ไม่ได้รับสัญญาณ'}</small>
        </div>
      </div>

      <div className="topbar-actions">
        {adminMode && (
          <a
            aria-current={adminDataOpen ? 'page' : undefined}
            className={`admin-data-link ${adminDataOpen ? 'active' : ''}`}
            href={adminDataOpen ? '#overview' : '#admin-data'}
            title={adminDataOpen ? 'กลับหน้าภาพรวม' : 'จัดการข้อมูลที่ตรวจวัด'}
          >
            {adminDataOpen ? <ArrowLeft size={15} /> : <Database size={15} />}
            <span>{adminDataOpen ? 'กลับหน้าภาพรวม' : 'จัดการข้อมูล'}</span>
          </a>
        )}
      </div>
    </header>
  )
}
