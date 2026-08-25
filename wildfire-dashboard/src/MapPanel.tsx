import { useEffect, useMemo } from 'react'
import { Circle, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { NodeStatus } from './types'
import { formatReason, stateColors, stateLabels } from './nodeStates'

interface MapPanelProps {
  nodes: NodeStatus[]
  selectedNodeId: string
  onSelect: (nodeId: string) => void
}

function formatSensorValue(value?: number | null, suffix = '') {
  if (value === undefined || value === null) return '—'
  const displayValue = Number.isInteger(value) ? value : value.toFixed(1)
  return `${displayValue}${suffix}`
}

function timeAgo(value?: string) {
  if (!value) return 'ยังไม่มีข้อมูล'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds} วินาทีที่แล้ว`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  return `${Math.floor(minutes / 60)} ชั่วโมงที่แล้ว`
}

function hasValidCoordinates(node: NodeStatus) {
  return typeof node.lat === 'number' && Number.isFinite(node.lat) &&
    typeof node.lng === 'number' && Number.isFinite(node.lng) &&
    node.lat >= -90 && node.lat <= 90 &&
    node.lng >= -180 && node.lng <= 180 &&
    (Math.abs(node.lat) >= 0.000001 || Math.abs(node.lng) >= 0.000001)
}

function FitNodes({ nodes }: { nodes: NodeStatus[] }) {
  const map = useMap()
  const bounds = useMemo(
    () =>
      nodes
        .filter(hasValidCoordinates)
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
  const locatedNodes = nodes.filter(hasValidCoordinates)
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
          const color = node.online ? stateColors[node.state] : '#7f8782'

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
                    <strong>{formatSensorValue(node.online ? node.air_temp : undefined, '°C')}</strong>
                  </div>
                  <div>
                    <span>ความชื้น</span>
                    <strong>{formatSensorValue(node.online ? node.humidity : undefined, '%')}</strong>
                  </div>
                  <div>
                    <span>ค่าควัน</span>
                    <strong>{formatSensorValue(node.online ? node.smoke_raw : undefined)}</strong>
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
