import { useState } from 'react'
import type { GroundSession } from './api'

const INPUT_STYLE = { height: 36, width: 220, padding: '0 12px', background: 'var(--bg)', border: '1px solid var(--line-strong)', color: 'var(--text)', font: 'inherit' } as const

/** Rename, stop and delete for the selected session. Delete asks first: it can't be undone.
 *  Keyed by mission id by the caller, so a half-done rename doesn't carry over to another session. */
export function SessionActions({
  session,
  busy,
  onRename,
  onStop,
  onDelete,
}: {
  session: GroundSession
  busy: boolean
  onRename: (name: string) => void
  onStop: () => void
  onDelete: () => void
}) {
  const [mode, setMode] = useState<'idle' | 'rename' | 'delete'>('idle')
  const [name, setName] = useState(session.name)

  if (mode === 'rename')
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          onRename(name.trim())
          setMode('idle')
        }}
        style={{ display: 'flex', gap: 8 }}
      >
        <input aria-label="New session name" autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} style={INPUT_STYLE} />
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          Save
        </button>
        <button type="button" className="btn" onClick={() => setMode('idle')}>
          Cancel
        </button>
      </form>
    )

  if (mode === 'delete')
    return (
      <div role="alertdialog" aria-label="Delete session" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14 }}>
          Delete {session.name} and its {session.hops} hops?{session.running ? ' Polling stops first.' : ''}
        </span>
        <button className="btn btn-primary" disabled={busy} onClick={onDelete}>
          Delete
        </button>
        <button className="btn" onClick={() => setMode('idle')}>
          Cancel
        </button>
      </div>
    )

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        className="btn"
        disabled={busy}
        onClick={() => {
          setName(session.name)
          setMode('rename')
        }}
      >
        Rename
      </button>
      <button className="btn" disabled={session.status !== 'live' || busy} onClick={onStop}>
        Stop session
      </button>
      <button className="btn" disabled={busy} onClick={() => setMode('delete')}>
        Delete
      </button>
    </div>
  )
}
