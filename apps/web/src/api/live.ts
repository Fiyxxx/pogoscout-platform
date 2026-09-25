import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { API_BASE, keys } from './client'
import type { LiveMessage } from './types'

export type LinkState = 'connecting' | 'open' | 'reconnecting'

const TOPIC_KEYS: Record<string, (id: string) => readonly unknown[]> = {
  mission: keys.mission,
  cells: keys.cells,
  hops: keys.hops,
  events: keys.events,
  replay: keys.replay,
}

function liveUrl(missionId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${API_BASE}/missions/${missionId}/live`
}

/**
 * Subscribes to a mission's live notifications. Messages only invalidate queries; REST stays the
 * source of truth. On reconnect everything is refetched, so nothing missed while offline is lost.
 */
export function useMissionLive(missionId: string | undefined): LinkState {
  const queryClient = useQueryClient()
  const [state, setState] = useState<LinkState>('connecting')

  useEffect(() => {
    if (!missionId) return
    let socket: WebSocket | null = null
    let retry = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let closed = false

    const refetchAll = () => {
      for (const key of Object.values(TOPIC_KEYS)) queryClient.invalidateQueries({ queryKey: key(missionId) })
      queryClient.invalidateQueries({ queryKey: keys.missions })
    }

    const connect = () => {
      socket = new WebSocket(liveUrl(missionId))
      socket.onopen = () => {
        if (retry > 0) refetchAll()
        retry = 0
        setState('open')
      }
      socket.onmessage = (event) => {
        let message: LiveMessage
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type !== 'changed') return
        for (const topic of message.topics) {
          const key = TOPIC_KEYS[topic]
          if (key) queryClient.invalidateQueries({ queryKey: key(missionId) })
        }
        queryClient.invalidateQueries({ queryKey: keys.missions })
      }
      socket.onclose = () => {
        if (closed) return
        setState('reconnecting')
        const delay = Math.min(8000, 500 * 2 ** retry++)
        timer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      socket?.close()
    }
  }, [missionId, queryClient])

  return state
}
