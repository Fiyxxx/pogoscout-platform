// Controlled taxonomy (contracts/taxonomy.pogo-materials-v2.json) and its display treatment.

export const MATERIALS = [
  'soil',
  'mud',
  'sand',
  'gravel',
  'grass_vegetation',
  'leaf_litter',
  'concrete',
  'asphalt',
  'tiles_pavers',
  'water',
] as const

export type Material = (typeof MATERIALS)[number]

export const MATERIAL_NAMES: Record<Material, string> = {
  soil: 'Soil',
  mud: 'Mud',
  sand: 'Sand',
  gravel: 'Gravel',
  grass_vegetation: 'Grass',
  leaf_litter: 'Leaf litter',
  concrete: 'Concrete',
  asphalt: 'Asphalt',
  tiles_pavers: 'Pavers',
  water: 'Water',
}

export const MATERIAL_COLORS: Record<Material, string> = {
  soil: '#8a4a2c',
  mud: '#4a2e20',
  sand: '#d3c29b',
  gravel: '#8d8d88',
  grass_vegetation: '#3f6b2a',
  leaf_litter: '#6b4a26',
  concrete: '#b9b8b2',
  asphalt: '#2f2f30',
  tiles_pavers: '#a86a52',
  water: '#1f3440',
}

export function isMaterial(label: string | null | undefined): label is Material {
  return !!label && (MATERIALS as readonly string[]).includes(label)
}

export function materialName(label: string | null | undefined): string {
  return isMaterial(label) ? MATERIAL_NAMES[label] : 'Unknown'
}
