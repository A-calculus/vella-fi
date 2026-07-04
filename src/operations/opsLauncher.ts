export type LauncherStatus = 'stopped' | 'starting' | 'running' | 'failed'

export const launcherState = {
  status: 'stopped' as LauncherStatus,
  lastCheck: new Date().toISOString(),
}

export function ensureLauncherReady() {
  launcherState.status = 'running'
  launcherState.lastCheck = new Date().toISOString()
  return launcherState
}

export function stopLauncher() {
  launcherState.status = 'stopped'
  launcherState.lastCheck = new Date().toISOString()
  return launcherState
}
