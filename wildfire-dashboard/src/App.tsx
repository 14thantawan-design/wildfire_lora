/**
 * จุดเริ่มต้นของหน้าเว็บ
 * ไฟล์นี้เก็บเฉพาะ state กลาง เชื่อมข้อมูลจาก API และประกอบ Component แต่ละส่วนเข้าด้วยกัน
 */
import { useCallback, useEffect, useState } from 'react'
import { AdminReadingsPage } from './admin/AdminReadingsPage'
import { useDashboard } from './useDashboard'
import type { TimeRangeKey } from './timeRanges'
import { assessLiveSafety } from './liveOverview'
import {
  gpsStatusFor,
  hasValidCoordinates,
  isAdminHostname,
  safetyBannerFor,
  timeAgo,
} from './dashboardView'
import { DashboardHeader } from './components/DashboardHeader'
import { DashboardSummary } from './components/DashboardSummary'
import { MonitoringMap } from './components/MonitoringMap'
import { NodeDetailsCard } from './components/NodeDetailsCard'
import { AlertsPanel } from './components/AlertsPanel'
import { TrendPanel } from './components/TrendPanel'
import { ManualLocationModal } from './components/ManualLocationModal'
import { stateLabels } from './nodeStates'
import './App.css'

/** ควบคุมหน้าภาพรวม หน้า Admin และเหตุการณ์ที่ต้องใช้ข้อมูลร่วมกัน */
function App() {
  const [selectedNodeId, setSelectedNodeId] = useState('NODE01')
  const [chartRange, setChartRange] = useState<TimeRangeKey>('1h')
  const adminMode = isAdminHostname(window.location.hostname)
  const [adminDataOpen, setAdminDataOpen] = useState(
    () => adminMode && window.location.hash === '#admin-data',
  )
  const [deletingAlertId, setDeletingAlertId] = useState<string>()
  const [gpsRequestingNodeId, setGpsRequestingNodeId] = useState<string>()
  const [gpsRequestError, setGpsRequestError] = useState<{ nodeId: string; message: string }>()
  const [mapFocusRequest, setMapFocusRequest] = useState<{ nodeId: string; requestId: number }>()
  const [mapLocateError, setMapLocateError] = useState<{ nodeId: string; message: string }>()
  const [manualLocationNodeId, setManualLocationNodeId] = useState<string>()

  const {
    nodes,
    alerts,
    readings,
    backendUnavailable,
    health,
    refresh,
    deleteAlert,
    reacquireGps,
    saveManualLocation,
  } = useDashboard(selectedNodeId, chartRange)

  const selectedNode = nodes.find((node) => node.node_id === selectedNodeId) ?? nodes[0]
  const manualLocationNode = nodes.find((node) => node.node_id === manualLocationNodeId)
  const onlineNodes = nodes.filter((node) => node.online)
  const liveNodeIds = new Set(onlineNodes.map((node) => node.node_id))
  const gatewayConnected = !backendUnavailable && Boolean(health?.gateway.connected)
  const selectedLiveNode = gatewayConnected && selectedNode?.online ? selectedNode : undefined
  const metricMeta = selectedLiveNode?.last_seen
    ? `${selectedLiveNode.node_id} · ${timeAgo(selectedLiveNode.last_seen)}`
    : 'ยังไม่มีข้อมูลสดจากโหนดที่เลือก'
  const { highestState, canAssessSafety } = assessLiveSafety(nodes, health, backendUnavailable)
  const safetyBanner = safetyBannerFor(canAssessSafety, highestState)
  const gpsRequesting = gpsRequestingNodeId === selectedNode?.node_id
  const gpsStatus = gpsStatusFor(selectedNode, gpsRequesting, gpsRequestError)

  // หากโหนดที่เคยเลือกออฟไลน์ ให้เลือกโหนดออนไลน์ตัวแรกแทน
  useEffect(() => {
    if (nodes.length > 0 && !nodes.some((node) => node.node_id === selectedNodeId)) {
      setSelectedNodeId(nodes[0].node_id)
    }
  }, [nodes, selectedNodeId])

  // ใช้ URL hash สลับระหว่างหน้าภาพรวมกับหน้าจัดการข้อมูล
  useEffect(() => {
    const syncAdminPageWithHash = () => {
      setAdminDataOpen(adminMode && window.location.hash === '#admin-data')
    }
    window.addEventListener('hashchange', syncAdminPageWithHash)
    return () => window.removeEventListener('hashchange', syncAdminPageWithHash)
  }, [adminMode])

  /** เลือกโหนดจากแผนที่และล้างข้อความผิดพลาดของโหนดเดิม */
  const selectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId)
    setGpsRequestError(undefined)
    setMapFocusRequest(undefined)
    setMapLocateError(undefined)
  }

  /** เลื่อนไปยังแผนที่และสั่งให้แผนที่โฟกัสโหนดที่เลือก */
  const locateSelectedNode = () => {
    if (!selectedNode) return
    if (!hasValidCoordinates(selectedNode.lat, selectedNode.lng)) {
      setMapLocateError({ nodeId: selectedNode.node_id, message: `${selectedNode.node_id} ยังไม่มีข้อมูลตำแหน่ง` })
      return
    }
    setMapLocateError(undefined)
    setMapFocusRequest({ nodeId: selectedNode.node_id, requestId: Date.now() })
    window.requestAnimationFrame(() => {
      document.querySelector('#map')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  /** ยืนยันกับ Admin ก่อนลบเหตุการณ์ออกจากฐานข้อมูล */
  const removeAlert = (alertId: string) => {
    const alert = alerts.find((item) => item._id === alertId)
    const label = alert ? `${stateLabels[alert.level]} · ${alert.node_id}` : 'เหตุการณ์นี้'
    if (!window.confirm(`ลบประวัติ ${label} อย่างถาวรหรือไม่`)) return
    setDeletingAlertId(alertId)
    void deleteAlert(alertId).finally(() => setDeletingAlertId(undefined))
  }

  /** ส่งคำสั่งให้โหนดที่เลือกเริ่มค้นหา GPS ใหม่ */
  const requestSelectedNodeGps = async () => {
    if (!selectedNode) return
    setGpsRequestingNodeId(selectedNode.node_id)
    setGpsRequestError(undefined)
    try {
      await reacquireGps(selectedNode.node_id)
    } catch {
      setGpsRequestError({ nodeId: selectedNode.node_id, message: `${selectedNode.node_id} · ส่งคำสั่งไม่สำเร็จ` })
    } finally {
      setGpsRequestingNodeId(undefined)
    }
  }

  /** ปิดหน้าต่างกรอกพิกัดโดยล้างรหัสโหนดที่กำลังแก้ไข */
  const closeManualLocation = useCallback(() => setManualLocationNodeId(undefined), [])

  return (
    <div className="app-shell">
      <main>
        <DashboardHeader
          gatewayConnected={gatewayConnected}
          adminMode={adminMode}
          adminDataOpen={adminDataOpen}
        />

        {adminDataOpen ? (
          <AdminReadingsPage onDataChanged={refresh} />
        ) : (
          <div className="content" id="overview">
            <DashboardSummary
              onlineNodeCount={onlineNodes.length}
              selectedLiveNode={selectedLiveNode}
              metricMeta={metricMeta}
              safetyBanner={safetyBanner}
              canAssessSafety={canAssessSafety}
              highestState={highestState}
            />

            <section className="dashboard-grid">
              <MonitoringMap
                nodes={nodes}
                selectedNode={selectedNode}
                adminMode={adminMode}
                backendUnavailable={backendUnavailable}
                gpsRequesting={gpsRequesting}
                gpsStatus={gpsStatus}
                focusRequest={mapFocusRequest}
                onSelectNode={selectNode}
                onRequestGps={() => void requestSelectedNodeGps()}
                onOpenManualLocation={() => setManualLocationNodeId(selectedNode?.node_id)}
              />

              <div className="dashboard-side-column">
                <NodeDetailsCard
                  nodes={nodes}
                  selectedNode={selectedNode}
                  locateError={mapLocateError}
                  onSelectNode={setSelectedNodeId}
                  onLocate={locateSelectedNode}
                />
                <AlertsPanel
                  alerts={alerts}
                  liveNodeIds={liveNodeIds}
                  adminMode={adminMode}
                  deletingAlertId={deletingAlertId}
                  onDelete={removeAlert}
                />
              </div>
            </section>

            <TrendPanel
              nodes={nodes}
              selectedNode={selectedNode}
              readings={readings}
              chartRange={chartRange}
              onSelectNode={setSelectedNodeId}
              onRangeChange={setChartRange}
            />
          </div>
        )}
      </main>

      {adminMode && manualLocationNode && (
        <ManualLocationModal
          node={manualLocationNode}
          onClose={closeManualLocation}
          onSave={saveManualLocation}
        />
      )}
    </div>
  )
}

export default App
