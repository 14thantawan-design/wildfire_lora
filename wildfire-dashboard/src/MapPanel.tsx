import { useEffect, useMemo, useRef } from 'react'
import { Circle, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { NodeStatus } from './types'
import { stateColors, stateLabels } from './nodeStates'

interface MapPanelProps {
  focusRequest?: { nodeId: string; requestId: number }
  nodes: NodeStatus[]
  selectedNodeId: string
  onSelect: (nodeId: string) => void
}

function formatSensorValue(value?: number | null, suffix = '') {
  if (value === undefined || value === null) return '—'
  const displayValue = Number.isInteger(value) ? value : value.toFixed(1)
  return `${displayValue}${suffix}`
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
  const lastFittedBoundsKey = useRef('')
  const bounds = useMemo(
    () =>
      nodes
        .filter(hasValidCoordinates)
        .map((node) => [node.lat!, node.lng!] as [number, number]),
    [nodes],
  )
  const boundsKey = bounds.map(([latitude, longitude]) => `${latitude}:${longitude}`).join('|')

  useEffect(() => {
    if (!boundsKey || lastFittedBoundsKey.current === boundsKey) return
    lastFittedBoundsKey.current = boundsKey
    if (bounds.length === 1) {
      map.setView(bounds[0], 13)
    } else if (bounds.length > 1) {
      map.fitBounds(bounds as LatLngBoundsExpression, { padding: [54, 54], maxZoom: 14 })
    }
  }, [bounds, boundsKey, map])

  return null
}

function FocusNode({
  latitude,
  longitude,
  requestId,
}: {
  latitude?: number
  longitude?: number
  requestId?: number
}) {
  const map = useMap()

  useEffect(() => {
    if (!requestId || latitude === undefined || longitude === undefined) return
    map.flyTo([latitude, longitude], 14, {
      animate: true,
      duration: 0.8,
    })
  }, [latitude, longitude, map, requestId])

  return null
}

export function MapPanel({ focusRequest, nodes, selectedNodeId, onSelect }: MapPanelProps) {
  const locatedNodes = nodes.filter(hasValidCoordinates)
  const focusedNode = locatedNodes.find((node) => node.node_id === focusRequest?.nodeId)
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
        <FocusNode
          latitude={focusedNode?.lat}
          longitude={focusedNode?.lng}
          requestId={focusRequest?.requestId}
        />
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
              <Tooltip
                className="sensor-tooltip"
                direction="top"
                offset={[0, -12]}
                opacity={1}
              >
                <div className="sensor-tooltip-head">
                  <strong>{node.node_id}</strong>
                  <span className={`tooltip-status state-${node.state.toLowerCase()}`}>
                    {stateLabels[node.state]}
                  </span>
                </div>
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
                    <strong>{formatSensorValue(node.online ? node.particle_adc : undefined, ' ADC')}</strong>
                  </div>
                </div>
              </Tooltip>
            </Circle>
          )
        })}
      </MapContainer>

      <div className="map-legend">
        <span><i className="legend-dot normal" /> ปกติ</span>
        <span><i className="legend-dot watch" /> เฝ้าระวัง</span>
        <span><i className="legend-dot warning" /> เตือนภัย</span>
        <span><i className="legend-dot sensor" /> เซนเซอร์ขัดข้อง</span>
      </div>
    </div>
  )
}
