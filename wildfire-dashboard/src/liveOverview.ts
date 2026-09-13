import type { Alert, ApiHealth, NodeState, NodeStatus } from './types'
import { stateSeverity } from './nodeStates.ts'

export function selectLiveOverview(nodes: NodeStatus[], selectedNodeId: string) {
  const liveNodes = nodes.filter((node) => node.online)
  const effectiveNodeId = liveNodes.find((node) => node.node_id === selectedNodeId)?.node_id
    ?? liveNodes[0]?.node_id
  return { liveNodes, effectiveNodeId }
}

export function assessLiveSafety(nodes: NodeStatus[], alerts: Alert[], health: ApiHealth | undefined, unavailable: boolean) {
  const liveNodes = nodes.filter((node) => node.online)
  const liveIds = new Set(liveNodes.map((node) => node.node_id))
  const activeAlerts = alerts.filter((alert) => alert.active && liveIds.has(alert.node_id))
  const highestNodeState = liveNodes.reduce<NodeState>(
    (highest, node) => stateSeverity[node.state] > stateSeverity[highest] ? node.state : highest,
    'UNKNOWN',
  )
  const highestState = activeAlerts.reduce<NodeState>(
    (highest, alert) => stateSeverity[alert.level] > stateSeverity[highest] ? alert.level : highest,
    highestNodeState,
  )
  return {
    highestState,
    canAssessSafety: !unavailable && Boolean(health?.ok) &&
      Boolean(health?.gateway.connected) && liveNodes.length > 0,
  }
}
