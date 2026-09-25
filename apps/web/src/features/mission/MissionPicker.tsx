import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client'

type Props = { value: string | null; onChange: (id: string) => void }

export function MissionPicker({ value, onChange }: Props) {
  const queryClient = useQueryClient()
  const missions = useQuery({ queryKey: ['missions'], queryFn: api.missions })
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: api.createMission,
    onSuccess: (mission) => {
      queryClient.invalidateQueries({ queryKey: ['missions'] })
      setName('')
      onChange(mission.id)
    },
  })

  return (
    <div className="mission-picker">
      <select
        aria-label="Mission"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          {missions.data?.length ? 'Select mission' : 'No missions'}
        </option>
        {missions.data?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.id})
          </option>
        ))}
      </select>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate(name.trim())
        }}
      >
        <input
          aria-label="New mission name"
          placeholder="New mission"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={create.isPending}>
          Create
        </button>
      </form>
    </div>
  )
}
