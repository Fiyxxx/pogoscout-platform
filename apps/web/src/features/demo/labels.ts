// Ground-service labels (ground-v1): the platform taxonomy plus wood, which only this page names.
import { isMaterial, MATERIAL_COLORS, MATERIAL_NAMES } from '../../lib/materials'

export const GROUND_COLORS: Record<string, string> = { ...MATERIAL_COLORS, wood: '#b08650' }
export const GROUND_NAMES: Record<string, string> = { ...MATERIAL_NAMES, wood: 'Wood' }

export const UNKNOWN_COLOR = '#2a2a28'

export function isGroundLabel(label: string | null | undefined): label is string {
  return !!label && (isMaterial(label) || label === 'wood')
}

export const groundColor = (label: string | null | undefined) => (isGroundLabel(label) ? GROUND_COLORS[label] : UNKNOWN_COLOR)
export const groundName = (label: string | null | undefined) => (isGroundLabel(label) ? GROUND_NAMES[label] : 'Unknown')

/** Below this the platform records a reading as low confidence (domain/quality.py). */
export const LOW_CONFIDENCE = 0.8
