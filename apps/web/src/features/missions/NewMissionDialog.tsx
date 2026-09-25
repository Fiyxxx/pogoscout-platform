import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, keys } from '../../api/client'

/** Start a mission: an empty one for a scout feed, or a replay of a recorded run. */
export function NewMissionDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const scenarios = useQuery({ queryKey: keys.scenarios, queryFn: api.scenarios })
  const [name, setName] = useState('')
  const [source, setSource] = useState<string>('live')
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const create = useMutation({
    mutationFn: async () => {
      if (source === 'live') return api.createMission(name.trim())
      const mission = await api.createReplay(source, name.trim())
      await api.replayPlay(mission.id, speed)
      return mission
    },
    onSuccess: (mission) => {
      queryClient.invalidateQueries({ queryKey: keys.missions })
      navigate(`/missions/${mission.id}`)
    },
  })

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      style={{ width: 440, padding: 0, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--line-strong)' }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
        style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        <h2 className="brand" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
          New mission
        </h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="key">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Grid Sweep 02"
            style={{ height: 40, padding: '0 12px', background: 'var(--bg)', border: '1px solid var(--line-strong)', color: 'var(--text)', font: 'inherit' }}
          />
        </label>
        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="key" style={{ marginBottom: 8 }}>
            Feed
          </legend>
          <Option value="live" checked={source === 'live'} onChange={setSource} title="Scout feed" detail="Waits for hops from the scout." />
          {scenarios.data?.map((s) => (
            <Option key={s.scenario_id} value={s.scenario_id} checked={source === s.scenario_id} onChange={setSource} title={`Simulated scout: ${s.scenario_id}`} detail={`${s.hops.toLocaleString('en-US')} hops. ${s.description}`} />
          ))}
        </fieldset>
        {source !== 'live' && (
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span className="key">Feed speed</span>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              style={{ height: 36, padding: '0 8px', background: 'var(--bg)', border: '1px solid var(--line-strong)', color: 'var(--text)', font: 'inherit' }}
            >
              <option value={1}>Real time (1 hop per 4 s)</option>
              <option value={4}>4× real time</option>
              <option value={8}>8× real time</option>
            </select>
          </label>
        )}
        {create.isError && <span className="signal" style={{ fontSize: 13 }}>{(create.error as Error).message}</span>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || create.isPending}>
            Start mission
          </button>
        </div>
      </form>
    </dialog>
  )
}

function Option({ value, checked, onChange, title, detail }: { value: string; checked: boolean; onChange: (v: string) => void; title: string; detail: string }) {
  return (
    <label style={{ display: 'flex', gap: 12, padding: 12, border: `1px solid ${checked ? 'var(--text)' : 'var(--line)'}`, cursor: 'pointer' }}>
      <input type="radio" name="feed" value={value} checked={checked} onChange={() => onChange(value)} style={{ accentColor: '#f2f2f0' }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{detail}</span>
      </span>
    </label>
  )
}
