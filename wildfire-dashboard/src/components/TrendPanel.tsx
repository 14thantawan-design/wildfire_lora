/** กราฟย้อนหลังและตัวเลือกโหนดสำหรับข้อมูลแนวโน้ม */
import { lazy, Suspense } from 'react'
import type { NodeStatus, Reading } from '../types'
import type { TimeRangeKey } from '../timeRanges'

const TrendChart = lazy(() =>
  import('./TrendChart').then((module) => ({ default: module.TrendChart })),
)

type TrendPanelProps = {
  nodes: NodeStatus[]
  selectedNode?: NodeStatus
  readings: Reading[]
  chartRange: TimeRangeKey
  onSelectNode: (nodeId: string) => void
  onRangeChange: (range: TimeRangeKey) => void
}

/** แสดงกราฟประวัติและส่งการเลือกช่วงเวลากลับไปยัง App */
export function TrendPanel({
  nodes,
  selectedNode,
  readings,
  chartRange,
  onSelectNode,
  onRangeChange,
}: TrendPanelProps) {
  return (
    <section className="panel trend-panel" id="trends">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">SENSOR HISTORY</span>
          <h2>แนวโน้มข้อมูล · {selectedNode?.node_id ?? 'ยังไม่มีโหนด'}</h2>
        </div>
        <label>
          <span>จุดตรวจวัด</span>
          <select value={selectedNode?.node_id ?? ''} onChange={(event) => onSelectNode(event.target.value)}>
            {nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.node_id}</option>)}
          </select>
        </label>
      </div>
      <Suspense fallback={<div className="panel-loading">กำลังโหลดกราฟ…</div>}>
        <TrendChart readings={readings} selectedRange={chartRange} onRangeChange={onRangeChange} />
      </Suspense>
    </section>
  )
}
