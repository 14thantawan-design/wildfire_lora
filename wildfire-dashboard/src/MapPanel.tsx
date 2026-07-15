import { useEffect, useMemo } from 'react'
import { Circle, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { NodeState, NodeStatus } from './types'

interface MapPanelProps {
  nodes: NodeStatus[]
  selectedNodeId: string
  onSelect: (nodeId: string) => void
}

const stateColor: Record<string, string> = {
  NORMAL: '#66c98a',
  WATCH: '#f5ad45',
  WARNING: '#f57845',
  CRITICAL: '#e34b42',
  SENSOR_FAULT: '#a779e9',
  CALIBRATING: '#6fb3d9',
  UNKNOWN: '#9ca3af',
}

const stateLabels: Record<NodeState, string> = {
  CALIBRATING: 'กำลังปรับค่า',
  NORMAL: 'ปกติ',
  WATCH: 'เฝ้าระวัง',
  WARNING: 'เตือนภัย',
  CRITICAL: 'วิกฤต',
  SENSOR_FAULT: 'เซนเซอร์ขัดข้อง',
  UNKNOWN: 'ไม่ทราบสถานะ',
}

const reasonLabels: Record<string, string> = {
  baseline_calibrating: 'กำลังเรียนค่าเริ่มต้นของเซนเซอร์',
  smoke_sensor_low_stuck: 'ค่าควัน 0 ต่อเนื่อง',
  smoke_low_stable: 'ค่าควันต่ำคงที่',
  sensor_data_incomplete: 'ข้อมูลเซนเซอร์ประกอบไม่ครบ',
  sht31_missing: 'อุณหภูมิ/ความชื้นไม่ส่งค่า',
  sensor_fault: 'ตรวจพบปัญหาเซนเซอร์',
  smoke_weak: 'เริ่มพบสัญญาณควัน',
  smoke_strong: 'พบสัญญาณควันชัดเจน',
  smoke_critical: 'ควันสูงผิดปกติ',
  heat_weak: 'อุณหภูมิเริ่มสูงกว่าปกติ',
  heat_strong: 'อุณหภูมิสูงผิดปกติ',
  heat_critical: 'อุณหภูมิสูงระดับวิกฤต',
  temperature_fast_rise: 'อุณหภูมิเพิ่มเร็ว',
  humidity_dry: 'ความชื้นต่ำ',
  humidity_very_dry: 'อากาศแห้งมาก',
  humidity_critical_drop: 'ความชื้นลดลงแรง',
  humidity_fast_drop: 'ความชื้นลดเร็ว',
  weather_drift: 'อากาศเปลี่ยนตามธรรมชาติ',
  drying_condition: 'ความชื้นลดตามสภาพอากาศ',
}

function formatSensorValue(value?: number | null, suffix = '') {
  if (value === undefined || value === null) return '—'
  const displayValue = Number.isInteger(value) ? value : value.toFixed(1)
  return `${displayValue}${suffix}`
}

function formatReason(reason: string) {
  return reasonLabels[reason] ?? reason.replaceAll('_', ' ')
}

function timeAgo(value?: string) {
  if (!value) return 'ยังไม่มีข้อมูล'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds} วินาทีที่แล้ว`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  return `${Math.floor(minutes / 60)} ชั่วโมงที่แล้ว`
}

function FitNodes({ nodes }: { nodes: NodeStatus[] }) {
  const map = useMap()
  const bounds = useMemo(
    () =>
      nodes
        .filter((node) => node.lat !== undefined && node.lng !== undefined)
        .map((node) => [node.lat!, node.lng!] as [number, number]),
    [nodes],
  )

  useEffect(() => {
    if (bounds.length === 1) {
      map.setView(bounds[0], 13)
    } else if (bounds.length > 1) {
      map.fitBounds(bounds as LatLngBoundsExpression, { padding: [54, 54], maxZoom: 14 })
    }
  }, [bounds, map])

  return null
}

export function MapPanel({ nodes, selectedNodeId, onSelect }: MapPanelProps) {
  const locatedNodes = nodes.filter((node) => node.lat !== undefined && node.lng !== undefined)
  const center: [number, number] = locatedNodes.length
    ? [locatedNodes[0].lat!, locatedNodes[0].lng!]
    : [18.7883, 98.9853]

  return (
    <div className="map-shell">
      <MapContainer center={center} zoom={12} zoomControl={false} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitNodes nodes={locatedNodes} />
        {locatedNodes.map((node) => {
          const selected = node.node_id === selectedNodeId
          const color = node.online ? stateColor[node.state] : '#7f8782'

          return (
            <Circle
              key={node.node_id}
              center={[node.lat!, node.lng!]}
              radius={selected ? 170 : 120}
              pathOptions={{
                color: '#f7f4eb',
                fillColor: color,
                fillOpacity: 1,
                opacity: 1,
                weight: selected ? 5 : 3,
              }}
              eventHandlers={{
                click: () => onSelect(node.node_id),
                mouseout: (event) => event.target.closeTooltip(),
                mouseover: (event) => event.target.openTooltip(),
              }}
            >
              <Tooltip className="sensor-tooltip" direction="top" offset={[0, -12]} opacity={1}>
                <div className="sensor-tooltip-head">
                  <strong>{node.node_id}</strong>
                  <span className={`tooltip-status state-${node.state.toLowerCase()}`}>
                    {stateLabels[node.state]}
                  </span>
                </div>
                <span className="sensor-tooltip-sub">
                  {node.location_source === 'manual'
                    ? 'พิกัดกำหนดเอง'
                    : node.gps_fixed
                      ? 'พิกัด GPS ล่าสุด'
                      : 'กำลังรอพิกัด GPS'}
                </span>
                {node.server_reasons && node.server_reasons.length > 0 && (
                  <span className="sensor-tooltip-reason">
                    {node.server_reasons.slice(0, 2).map(formatReason).join(' · ')}
                  </span>
                )}
                <div className="sensor-tooltip-values">
                  <div>
                    <span>อุณหภูมิ</span>
                    <strong>{formatSensorValue(node.air_temp, '°C')}</strong>
                  </div>
                  <div>
                    <span>ความชื้น</span>
                    <strong>{formatSensorValue(node.humidity, '%')}</strong>
                  </div>
                  <div>
                    <span>ค่าควัน</span>
                    <strong>{formatSensorValue(node.smoke_raw)}</strong>
                  </div>
                </div>
                <div className="sensor-tooltip-foot">
                  <span className={node.online ? 'online' : 'offline'}>
                    {node.online ? 'ออนไลน์' : 'ออฟไลน์'}
                  </span>
                  <span>รอบ {node.last_seq ?? '—'}</span>
                  <span>RSSI {node.rssi ?? '—'} dBm</span>
                  <span>{timeAgo(node.last_seen)}</span>
                </div>
              </Tooltip>
            </Circle>
          )
        })}
      </MapContainer>

      <div className="map-overlay">
        <span className="map-kicker">ตำแหน่งภาคสนาม</span>
        <strong>{locatedNodes.length} จุดตรวจวัด</strong>
      </div>
      <div className="map-legend">
        <span><i className="legend-dot normal" /> ปกติ</span>
        <span><i className="legend-dot calibrating" /> กำลังปรับค่า</span>
        <span><i className="legend-dot watch" /> เฝ้าระวัง</span>
        <span><i className="legend-dot warning" /> เตือนภัย</span>
        <span><i className="legend-dot critical" /> วิกฤต</span>
        <span><i className="legend-dot sensor" /> เซนเซอร์ขัดข้อง</span>
      </div>
    </div>
  )
}
