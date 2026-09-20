/** แผนที่จุดตรวจพร้อมตัวเลือกโหนดและเครื่องมือ GPS สำหรับ Admin */
import { lazy, Suspense } from 'react'
import { MapPin, RefreshCw } from 'lucide-react'
import type { NodeStatus } from '../types'
import type { GpsStatus } from '../dashboardView'

const MapPanel = lazy(() =>
  import('./MapPanel').then((module) => ({ default: module.MapPanel })),
)

type MonitoringMapProps = {
  nodes: NodeStatus[]
  selectedNode?: NodeStatus
  adminMode: boolean
  backendUnavailable: boolean
  gpsRequesting: boolean
  gpsStatus: GpsStatus
  focusRequest?: { nodeId: string; requestId: number }
  onSelectNode: (nodeId: string) => void
  onRequestGps: () => void
  onOpenManualLocation: () => void
}

/** แสดงแผนที่และส่งเหตุการณ์จากปุ่มต่าง ๆ กลับไปให้ App จัดการ */
export function MonitoringMap({
  nodes,
  selectedNode,
  adminMode,
  backendUnavailable,
  gpsRequesting,
  gpsStatus,
  focusRequest,
  onSelectNode,
  onRequestGps,
  onOpenManualLocation,
}: MonitoringMapProps) {
  return (
    <article className="panel map-panel" id="map">
      <div className="panel-head">
        <div><h2>แผนที่จุดตรวจวัด</h2></div>
        <div className="map-head-actions">
          <label className="map-node-picker">
            <span>จุดตรวจ</span>
            <select
              aria-label="เลือกจุดตรวจ"
              value={selectedNode?.node_id ?? ''}
              onChange={(event) => onSelectNode(event.target.value)}
            >
              {nodes.map((node) => (
                <option key={node.node_id} value={node.node_id}>{node.node_id}</option>
              ))}
            </select>
          </label>
          <span className={`gps-state ${gpsStatus.tone}`}><i /> {gpsStatus.text}</span>
          {adminMode && (
            <div className="location-action-buttons">
              <button
                aria-label={`ค้นหา GPS ใหม่สำหรับ ${selectedNode?.node_id ?? 'จุดตรวจ'}`}
                className="gps-refresh-button"
                disabled={!selectedNode || backendUnavailable || gpsRequesting}
                onClick={onRequestGps}
                title={backendUnavailable ? 'เชื่อมต่อ backend ก่อนจึงจะส่งคำสั่งได้' : 'ล้างพิกัดเดิมและค้นหา GPS ใหม่'}
                type="button"
              >
                <RefreshCw className={gpsRequesting ? 'spin' : ''} size={14} />
                <span>{gpsRequesting ? 'กำลังส่ง' : 'ค้นหา GPS ใหม่'}</span>
              </button>
              <button
                aria-label={`กรอกพิกัดเองสำหรับ ${selectedNode?.node_id ?? 'จุดตรวจ'}`}
                className="manual-location-button"
                disabled={!selectedNode || backendUnavailable}
                onClick={onOpenManualLocation}
                title={backendUnavailable ? 'เชื่อมต่อ backend ก่อนจึงจะบันทึกพิกัดได้' : 'กรอกพิกัดเอง'}
                type="button"
              >
                <MapPin size={14} />
                <span>กรอกพิกัด</span>
              </button>
            </div>
          )}
        </div>
      </div>
      <Suspense fallback={<div className="panel-loading">กำลังโหลดแผนที่…</div>}>
        <MapPanel
          focusRequest={focusRequest}
          nodes={nodes}
          selectedNodeId={selectedNode?.node_id ?? ''}
          onSelect={onSelectNode}
        />
      </Suspense>
    </article>
  )
}
