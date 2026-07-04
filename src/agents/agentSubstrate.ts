export type AgentIntent = {
  name: string
  description: string
  payload?: Record<string, unknown>
}

export function executeAgentIntent(intent: AgentIntent) {
  return {
    status: 'queued',
    intent,
    message: `Agent intent ${intent.name} has been queued for execution.`,
  }
}

export function listAgentTools() {
  return [
    { name: 'market-watch', description: 'Monitor market feeds and alert on bulk trade events.' },
    { name: 'order-router', description: 'Route batch orders to settlement engines and brokers.' },
    { name: 'analytics-report', description: 'Compile summary analytics for the latest trade batch.' },
  ]
}
