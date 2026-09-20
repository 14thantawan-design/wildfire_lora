/** การ์ดเลือกโหนด ดูสถานะ และเลื่อนไปยังตำแหน่งบนแผนที่ */
import { MapPin } from 'lucide-react'
import type { NodeStatus } from '../types'
import { stateLabels } from '../nodeStates'

type NodeDetailsCardProps = {
  nodes: NodeStatus[]
  selectedNode?: NodeStatus
  locateError?: { nodeId: string; message: string }
  onSelectNode: (nodeId: string) => void
  onLocate: () => void
}

/** แสดงสถานะของโหนดที่เลือกและปุ่มค้นหาตำแหน่งบนแผนที่ */
export function NodeDetailsCard({
  nodes,
  selectedNode,
  locateError,
  onSelectNode,
  onLocate,
}: NodeDetailsCardProps) {
  return (
    <aside aria-label="รายละเอียดของ Node" className="panel node-detail-card">
      <div className="node-detail-head">
        <span>
          {nodes.length > 0 ? (
            <select
              aria-label="เลือก Node เพื่อดูรายละเอียด"
              className="node-detail-select"
              value={selectedNode?.node_id ?? ''}
              onChange={(event) => onSelectNode(event.target.value)}
            >
              {nodes.map((node) => (
                <option key={node.node_id} value={node.node_id}>{node.node_id}</option>
              ))}
            </select>
          ) : (
            <strong>ยังไม่มีโหนด</strong>
          )}
        </span>
        {selectedNode && (
          <b className={`status-tag state-${selectedNode.online ? selectedNode.state.toLowerCase() : 'offline'}`}>
            {selectedNode.online ? stateLabels[selectedNode.state] : 'ออฟไลน์'}
          </b>
        )}
      </div>
      <div className="node-map-locator">
        <button
          aria-controls="map"
          aria-label={`ดูตำแหน่ง ${selectedNode?.node_id ?? 'Node'} บนแผนที่`}
          disabled={!selectedNode}
          onClick={onLocate}
          type="button"
        >
          <MapPin size={15} />
          <span>ดูตำแหน่งบนแผนที่</span>
        </button>
        {locateError && locateError.nodeId === selectedNode?.node_id && (
          <small role="alert">{locateError.message}</small>
        )}
      </div>
    </aside>
  )
}
