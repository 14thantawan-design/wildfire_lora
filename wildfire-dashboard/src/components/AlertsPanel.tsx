/** รายการเหตุการณ์ล่าสุด พร้อมปุ่มลบที่แสดงเฉพาะในโหมด Admin */
import { useState } from 'react'
import { ChevronRight, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import type { Alert } from '../types'
import { stateLabels } from '../nodeStates'
import { formatAlertSummary, timeAgo } from '../dashboardView'

type AlertsPanelProps = {
  alerts: Alert[]
  liveNodeIds: Set<string>
  adminMode: boolean
  deletingAlertId?: string
  onDelete: (alertId: string) => void
}

/** แสดงห้ารายการแรกและให้ผู้ใช้กางดูรายการทั้งหมดได้ */
export function AlertsPanel({
  alerts,
  liveNodeIds,
  adminMode,
  deletingAlertId,
  onDelete,
}: AlertsPanelProps) {
  const [showAll, setShowAll] = useState(false)
  const visibleAlerts = showAll ? alerts : alerts.slice(0, 5)
  const hiddenCount = Math.max(0, alerts.length - visibleAlerts.length)

  return (
    <article className="panel alert-panel" id="alerts">
      <div className="panel-head">
        <div><span className="panel-kicker">EVENTS</span><h2>เหตุการณ์ล่าสุด</h2></div>
        {alerts.length > 5 && (
          <button aria-expanded={showAll} onClick={() => setShowAll((current) => !current)} type="button">
            {showAll ? 'ย่อรายการ' : `ดูทั้งหมด ${hiddenCount} รายการ`}
            <ChevronRight className={showAll ? 'rotate-up' : ''} size={15} />
          </button>
        )}
      </div>
      <div className="alert-list">
        {alerts.length === 0 ? (
          <div className="empty-alerts">
            <ShieldCheck size={28} />
            <strong>ยังไม่มีเหตุการณ์</strong>
            <span>ระบบจะแสดงการแจ้งเตือนใหม่ที่นี่</span>
          </div>
        ) : visibleAlerts.map((alert) => {
          const isLiveAlert = alert.active && liveNodeIds.has(alert.node_id)
          return (
            <article className={`alert-row ${isLiveAlert ? '' : 'resolved'}`} key={alert._id}>
              <div className="alert-main">
                <span className={`alert-level state-${alert.level.toLowerCase()}`}>
                  <TriangleAlert size={17} />
                </span>
                <div>
                  <strong>
                    {stateLabels[alert.level]} · {alert.node_id}
                    {!alert.active && <span className="resolved-badge">สิ้นสุดแล้ว</span>}
                    {alert.active && !isLiveAlert && <span className="resolved-badge">ไม่อยู่ในรายการสด</span>}
                  </strong>
                  <span className="alert-summary">{formatAlertSummary(alert)}</span>
                  <small>{timeAgo(alert.started_at)}</small>
                </div>
              </div>
              {adminMode && (
                <button
                  aria-label={`ลบเหตุการณ์ ${alert.node_id}`}
                  className="alert-delete"
                  disabled={deletingAlertId === alert._id}
                  onClick={() => onDelete(alert._id)}
                  title="ลบเหตุการณ์"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </article>
          )
        })}
      </div>
    </article>
  )
}
