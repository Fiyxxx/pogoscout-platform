import { useCallback, useEffect, useRef, useState } from 'react'

export const SPEEDS = [10, 50, 200] as const

export type Playback = {
  /** Index into the mission path being shown, or null when following live. */
  index: number | null
  playing: boolean
  speed: number
  play: () => void
  pause: () => void
  step: (delta: number) => void
  seek: (index: number) => void
  goLive: () => void
  cycleSpeed: () => void
}

/**
 * Client-side history playback over the hops already received. Works for any mission, live or
 * finished; `hopSeconds` is the mission's real time between hops, so 50x plays fifty times faster
 * than the scout moved.
 */
export function usePlayback(length: number, hopSeconds: number): Playback {
  const [index, setIndex] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(SPEEDS[1])
  const position = useRef(0)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const hopsPerSecond = speed / Math.max(0.5, hopSeconds)
      position.current += ((now - last) / 1000) * hopsPerSecond
      last = now
      if (position.current >= length - 1) {
        setPlaying(false)
        setIndex(null)
        return
      }
      setIndex(Math.floor(position.current))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, hopSeconds, length])

  const seek = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(length - 1, Math.round(i)))
      position.current = clamped
      setIndex(clamped >= length - 1 && !playing ? null : clamped)
    },
    [length, playing],
  )

  return {
    index,
    playing,
    speed,
    play: () => {
      if (index === null) position.current = 0
      setIndex(Math.floor(position.current))
      setPlaying(true)
    },
    pause: () => setPlaying(false),
    step: (delta) => {
      setPlaying(false)
      seek((index ?? length - 1) + delta)
    },
    seek,
    goLive: () => {
      setPlaying(false)
      setIndex(null)
    },
    cycleSpeed: () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]),
  }
}
