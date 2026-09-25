// Showcase content for the 3D page: what each part of the PogoScout is, how it works, and the
// interchangeable modules for each sensor slot. Concept material for presentation, not telemetry.

export type PartId = 'propulsion' | 'core' | 'leg' | 'camera' | 'metal' | 'gas' | 'datalink' | 'battery'
export type SlotId = 'camera' | 'metal' | 'gas' | 'datalink'

export type Variant = { id: string; name: string; summary: string }

export type Part = {
  id: PartId
  name: string
  role: string
  how: string
  slot?: SlotId
}

export const PARTS: Part[] = [
  {
    id: 'core',
    name: 'Core',
    role: 'Airframe, flight controller and companion computer',
    how: 'A flight controller keeps the scout level through each hop while a Raspberry Pi companion computer reads the sensor modules, stamps every reading with its hop number and streams it to the ground station. Every module bay uses the same mount and connector, so a sensor can be swapped in the field without tools.',
  },
  {
    id: 'propulsion',
    name: 'Propulsion',
    role: 'Four guarded rotors',
    how: 'The rotors do not carry the scout the whole way. They add lift at take-off, hold attitude in the air and steer each hop one cell forward, back, left or right. Guards keep the blades clear of foliage and walls.',
  },
  {
    id: 'leg',
    name: 'Pogo leg',
    role: 'Spring-loaded telescoping leg',
    how: 'A slotted plate bolts the leg under the core. Below it a carriage rides on guide rollers along the rod, with a small board that senses how far the spring compresses. On landing the ball foot drives the rod up, the coil spring stores that energy and releases it for the next hop, so most of the lift comes from the spring rather than the battery. The bracket arm latches the carriage between hops.',
  },
  {
    id: 'camera',
    name: 'Ground camera',
    role: 'Downward-facing capture of the landing area',
    how: 'After each landing the camera captures the ground under the scout. The platform sends the image to the material model, which labels the surface (soil, mud, water, pavers) and shows the result on the map.',
    slot: 'camera',
  },
  {
    id: 'metal',
    name: 'Metal sensor',
    role: 'Detects metal near the ground on every landing',
    how: 'An inductive coil around the foot is excited at a set frequency. Metal nearby changes the coil inductance, which the sensor chip measures and reports as a metal anomaly for that cell. It flags metal, it does not identify what the object is.',
    slot: 'metal',
  },
  {
    id: 'gas',
    name: 'Gas sensor',
    role: 'Samples the air for volatile organic compounds',
    how: 'A heated metal-oxide element changes resistance when volatile organic compounds are present. The reading is compared against a baseline and reported as a VOC activity cue for the cell, a prompt to look closer rather than a detection of people.',
    slot: 'gas',
  },
  {
    id: 'datalink',
    name: 'Datalink',
    role: 'Video and telemetry link to the operator',
    how: 'Streams the ground capture and each hop record to the ground station, where the platform maps it live. The link module can be swapped for the range or network the mission needs.',
    slot: 'datalink',
  },
  {
    id: 'battery',
    name: 'Battery',
    role: 'Hot-swappable LiPo pack',
    how: 'Strapped to the lid with its balance lead and power connector within reach, so a spare can be swapped in between sweeps. Because the spring does most of the work, a pack lasts for hundreds of hops.',
  },
]

export const VARIANTS: Record<SlotId, Variant[]> = {
  camera: [
    { id: 'rgb', name: 'RGB camera', summary: 'Colour capture for surface classification. Fitted as standard.' },
    { id: 'thermal', name: 'Thermal camera', summary: 'Heat signatures at night and through light cover.' },
    { id: 'multispectral', name: 'Multispectral', summary: 'Four narrow bands for moisture and vegetation analysis.' },
  ],
  metal: [
    { id: 'coil', name: 'Inductive coil', summary: 'Ring coil around the foot, reads metal on each landing. Fitted as standard.' },
    { id: 'magnetometer', name: 'Magnetometer boom', summary: 'Senses ferrous objects from a boom clear of the motors.' },
    { id: 'gpr', name: 'Ground radar pad', summary: 'Shallow ground-penetrating radar for buried objects.' },
  ],
  gas: [
    { id: 'voc', name: 'VOC sensor', summary: 'Metal-oxide sensor for volatile organic compounds. Fitted as standard.' },
    { id: 'co2', name: 'CO₂ sensor', summary: 'Infrared carbon dioxide sensing for occupied spaces.' },
    { id: 'multigas', name: 'Multi-gas', summary: 'Electrochemical cells for CO, H₂S and O₂ levels.' },
  ],
  datalink: [
    { id: 'video58', name: '5.8 GHz video', summary: 'Analogue video and telemetry downlink. Fitted as standard.' },
    { id: 'mesh', name: 'Mesh radio', summary: 'Relays through other scouts to extend range.' },
    { id: 'lte', name: 'Cellular', summary: 'Uses the mobile network where it has coverage.' },
  ],
}

export const DEFAULT_VARIANTS: Record<SlotId, string> = { camera: 'rgb', metal: 'coil', gas: 'voc', datalink: 'video58' }
