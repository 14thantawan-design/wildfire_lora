import type { ApiHealth, NodeState, NodeStatus } from './types'
import { stateSeverity } from './nodeStates.ts'

export function selectLiveOverview(nodes: NodeStatus[], selectedNodeId: string) {
  const liveNodes = nodes.filter((node) => node.online)
  const effectiveNodeId = liveNodes.find((node) => node.node_id === selectedNodeId)?.node_id
    ?? liveNodes[0]?.node_id
  return { liveNodes, effectiveNodeId }
}

export function assessLiveSafety(nodes: NodeStatus[], health: ApiHealth | undefined, unavailable: boolean) {
  const liveNodes = nodes.filter((node) => node.online)
  // Alert records retain an event's peak level; the live banner follows the
  // current node decision, including recovery and calibration.
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
