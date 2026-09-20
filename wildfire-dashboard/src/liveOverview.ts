/** ฟังก์ชันคัดเลือกข้อมูลสดโดยไม่เกี่ยวกับการวาดหน้าจอ */
import type { ApiHealth, NodeState, NodeStatus } from './types'
import { stateSeverity } from './nodeStates.ts'

/** เลือกเฉพาะโหนดออนไลน์และหาโหนดที่จะใช้โหลดกราฟ */
export function selectLiveOverview(nodes: NodeStatus[], selectedNodeId: string) {
  const liveNodes = nodes.filter((node) => node.online)
  const effectiveNodeId = liveNodes.find((node) => node.node_id === selectedNodeId)?.node_id
    ?? liveNodes[0]?.node_id
  return { liveNodes, effectiveNodeId }
}

/** หาสถานะสูงสุดของโหนดออนไลน์และตรวจว่าข้อมูลพร้อมประเมินหรือไม่ */
export function assessLiveSafety(nodes: NodeStatus[], health: ApiHealth | undefined, unavailable: boolean) {
  const liveNodes = nodes.filter((node) => node.online)
  // Alert เก็บระดับสูงสุดของเหตุการณ์ แต่แถบข้อมูลสดใช้สถานะปัจจุบันของโหนด
  const highestState = liveNodes.reduce<NodeState>(
    (highest, node) => stateSeverity[node.state] > stateSeverity[highest] ? node.state : highest,
    'UNKNOWN',
  )
  return {
    highestState,
    canAssessSafety: !unavailable && Boolean(health?.ok) &&
      Boolean(health?.gateway.connected) && liveNodes.length > 0,
  }
}
