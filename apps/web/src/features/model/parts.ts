// Showcase content for the 3D page: the fixed airframe, and the sensor bays with the modules that
// can be fitted to each. Part numbers name real, off-the-shelf components chosen for a small,
// light scout. Concept material for presentation, not telemetry.

export type AirframeId = 'core' | 'propulsion' | 'leg' | 'battery'
export type SlotId = 'camera' | 'metal' | 'gas' | 'datalink' | 'lidar' | 'environment' | 'acoustic' | 'seismic' | 'radiation' | 'rf'
export type PartId = AirframeId | SlotId

/** A module that fits a bay: the real component, how it connects and what it adds. */
export type Module = { id: string; name: string; part: string; iface: string; spec: string; summary: string }

export type Part = { id: PartId; name: string; role: string; how: string }

/** A sensor bay. Standard bays always carry a module; optional bays can be left empty. */
export type Bay = Part & { id: SlotId; standard: boolean; modules: Module[] }

/** Variant id for an empty optional bay. */
export const EMPTY = 'none'

export const AIRFRAME: Part[] = [
  {
    id: 'core',
    name: 'Core',
    role: 'Airframe, flight controller and companion computer',
    how: 'A flight controller keeps the scout level through each hop while a Raspberry Pi companion computer reads the sensor bays, stamps every reading with its hop number and streams it to the ground station. Every bay uses the same mount and connector, so a module can be swapped in the field without tools.',
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
    id: 'battery',
    name: 'Battery',
    role: 'Hot-swappable LiPo pack',
    how: 'Strapped to the lid with its balance lead and power connector within reach, so a spare can be swapped in between sweeps. Because the spring does most of the work, a pack lasts for hundreds of hops.',
  },
]

export const BAYS: Bay[] = [
  {
    id: 'camera',
    name: 'Ground camera',
    role: 'Images the ground under the scout',
    how: 'After each landing the camera captures the ground under the foot. The platform sends the image to the material model, which labels the surface (soil, mud, water, pavers) and shows the result on the map.',
    standard: true,
    modules: [
      { id: 'rgb', name: 'Colour camera', part: 'Raspberry Pi Camera Module 3', iface: 'MIPI CSI-2', spec: 'Sony IMX708, 12 MP, autofocus', summary: 'Colour capture for surface classification. Fitted as standard.' },
      { id: 'thermal', name: 'Thermal camera', part: 'Teledyne FLIR Lepton 3.5', iface: 'SPI and I²C', spec: '160 × 120 LWIR, radiometric', summary: 'Reads surface temperature at night and through light cover. Freshly disturbed or wet ground shows up against its surroundings.' },
      { id: 'nir', name: 'Near-infrared camera', part: 'Raspberry Pi Camera Module 3 NoIR', iface: 'MIPI CSI-2', spec: 'Sony IMX708 without IR-cut filter', summary: 'With a band-pass filter it separates live vegetation from bare and disturbed soil, and sharpens the moisture read.' },
      { id: 'depth', name: 'Depth camera', part: 'Intel RealSense D405', iface: 'USB-C', spec: 'Stereo depth, 7 to 50 cm', summary: 'Colour plus sub-millimetre depth at close range. Measures surface roughness and checks the next landing spot.' },
    ],
  },
  {
    id: 'metal',
    name: 'Metal sensor',
    role: 'Detects metal near the ground on every landing',
    how: 'The sensor reads the ground at the moment of contact, when the foot is closest to it. A change against the baseline is reported as a metal anomaly for that cell. It flags metal, it does not identify what the object is.',
    standard: true,
    modules: [
      { id: 'coil', name: 'Inductive coil', part: 'Texas Instruments LDC1612', iface: 'I²C', spec: '28-bit inductance to digital, 2 channels', summary: 'A ring coil around the foot. Nearby metal shifts its resonant frequency, which the converter measures. Fitted as standard.' },
      { id: 'ddcoil', name: 'Double-D search pad', part: 'Texas Instruments LDC1101', iface: 'SPI', spec: 'High-speed inductance and loss sensing', summary: 'A wider pad with overlapping D coils. Covers more ground per landing and reaches deeper than the ring coil.' },
      { id: 'magnetometer', name: 'Magnetometer gradiometer', part: 'PNI RM3100, pair', iface: 'SPI', spec: 'Magneto-inductive, 3 axis', summary: 'Two magnetometers on a boom, clear of motor noise. The difference between them picks up ferrous objects beyond the reach of a coil.' },
    ],
  },
  {
    id: 'gas',
    name: 'Gas sensor',
    role: 'Samples the air for volatile organic compounds',
    how: 'The sensor samples the air at every landing and compares it with a baseline taken at the start of the sweep. A rise is reported as an activity cue for the cell, a prompt to look closer rather than a detection of people.',
    standard: true,
    modules: [
      { id: 'voc', name: 'VOC sensor', part: 'Sensirion SGP41', iface: 'I²C', spec: 'Metal-oxide, VOC and NOx index', summary: 'A heated metal-oxide element changes resistance with volatile organic compounds. Fitted as standard.' },
      { id: 'pid', name: 'Photoionisation detector', part: 'Alphasense PID-AH2', iface: 'Analogue', spec: '10.6 eV lamp, parts per billion', summary: 'An ultraviolet lamp ionises VOCs and counts the current. Far more sensitive than metal-oxide, for faint or aged traces.' },
      { id: 'co2', name: 'CO₂ sensor', part: 'Sensirion SCD41', iface: 'I²C', spec: 'Photoacoustic NDIR, 400 to 5000 ppm', summary: 'Measures carbon dioxide build-up in culverts, drains and other enclosed spaces.' },
      { id: 'multigas', name: 'Confined-space cells', part: 'Alphasense CO-B4, H2S-B4, O2-A2', iface: 'Analogue', spec: 'Electrochemical CO, H₂S and O₂', summary: 'Safety readings before a team enters a drain or tunnel: toxic gases and oxygen level.' },
    ],
  },
  {
    id: 'datalink',
    name: 'Datalink',
    role: 'Video and telemetry link to the operator',
    how: 'Streams the ground capture and each hop record to the ground station, where the platform maps it live. The link is chosen for the range and network the mission needs.',
    standard: true,
    modules: [
      { id: 'video58', name: 'Analogue video', part: 'TBS Unify Pro32 Nano 5G8', iface: 'Analogue video, UART', spec: '5.8 GHz, 25 mW to 1 W', summary: 'Low-latency video and telemetry downlink. Fitted as standard.' },
      { id: 'hd', name: 'Digital video', part: 'HDZero Race V3', iface: 'MIPI camera, UART', spec: '5.8 GHz digital, fixed low latency', summary: 'Clean digital frames give the material model sharper images than analogue.' },
      { id: 'mesh', name: 'Mesh radio', part: 'Doodle Labs Mesh Rider Mini-OEM', iface: 'Ethernet, USB', spec: 'MIMO mesh, encrypted', summary: 'Relays through other scouts and ground nodes to reach beyond line of sight.' },
      { id: 'lte', name: 'Cellular', part: 'Quectel EG25-G', iface: 'USB', spec: 'LTE Cat 4, global bands', summary: 'Uses the mobile network where it has coverage, for sweeps far from the operator.' },
    ],
  },
  {
    id: 'lidar',
    name: 'Lidar',
    role: 'Measures ground height and obstacles',
    how: 'Times laser pulses reflected from the ground and anything around it. The scout gets a real height for every cell, sees drops, holes and walls before it hops, and the map can show measured terrain instead of analytical height.',
    standard: false,
    modules: [
      { id: 'tfluna', name: 'Single-point lidar', part: 'Benewake TF-Luna', iface: 'UART, I²C', spec: '0.2 to 8 m, about 5 g', summary: 'A downward rangefinder. Ground height under the scout on every hop at almost no weight.' },
      { id: 'multizone', name: 'Multizone time of flight', part: 'ST VL53L8CX', iface: 'I²C, SPI', spec: '8 × 8 zones, up to 4 m', summary: 'A 64-zone depth grid of the landing spot. Flags slopes, holes and edges before touchdown.' },
      { id: 'mid360', name: '3D scanning lidar', part: 'Livox Mid-360', iface: 'Ethernet', spec: '360° × 59°, 40 m, 265 g', summary: 'Full 3D scans of the surroundings for mapping culverts and dense cover. The heaviest option.' },
    ],
  },
  {
    id: 'environment',
    name: 'Humidity',
    role: 'Measures humidity, temperature and pressure',
    how: 'A shielded sensor reads the air around the scout. Humidity marks damp and flooded ground, and the readings correct the gas sensor, whose baseline drifts with temperature and moisture.',
    standard: false,
    modules: [
      { id: 'sht45', name: 'Humidity sensor', part: 'Sensirion SHT45', iface: 'I²C', spec: '±1.0 %RH, ±0.1 °C', summary: 'Precise humidity and temperature in a louvred shield that keeps rotor wash and sun off the sensor.' },
      { id: 'bme280', name: 'Weather sensor', part: 'Bosch BME280', iface: 'I²C, SPI', spec: 'Humidity, pressure and temperature', summary: 'Adds barometric pressure for weather trends and relative height between hops.' },
      { id: 'sen55', name: 'Air quality', part: 'Sensirion SEN55', iface: 'I²C', spec: 'PM1 to PM10, humidity, VOC, NOx', summary: 'Adds a particle counter that picks up smoke and dust alongside humidity.' },
    ],
  },
  {
    id: 'acoustic',
    name: 'Microphone',
    role: 'Listens for sound while landed',
    how: 'Rotor noise masks everything in the air, so the scout listens during the moment it rests on the ground between hops. Sound above the background is reported as an acoustic cue for the cell, such as an engine or generator running nearby. It is a prompt to look closer, not identification.',
    standard: false,
    modules: [
      { id: 'mic', name: 'Digital microphone', part: 'TDK InvenSense ICS-43434', iface: 'I²S', spec: 'MEMS, 65 dBA SNR', summary: 'One microphone in a foam windscreen. Sound level and spectrum at each landing.' },
      { id: 'array', name: 'Microphone array', part: '4 × Infineon IM69D130', iface: 'PDM', spec: 'MEMS, 69 dB SNR, 4 channels', summary: 'Four microphones on a cross. Timing between them gives the bearing to the sound.' },
      { id: 'wake', name: 'Wake-on-sound', part: 'Vesper VM1010', iface: 'Analogue', spec: 'Piezoelectric, microwatt listening', summary: 'Listens at almost no power and wakes the computer only when something is heard.' },
    ],
  },
  {
    id: 'seismic',
    name: 'Vibration',
    role: 'Feels ground vibration through the foot',
    how: 'Clamped to the leg just above the ball foot, so it couples to the ground every time the scout lands. Vibration above the background, from vehicles or machinery, is reported as a seismic cue for the cell.',
    standard: false,
    modules: [
      { id: 'geophone', name: 'Geophone', part: 'SM-24 geophone', iface: 'Analogue', spec: '10 Hz, single axis', summary: 'The field-standard seismic element. Sensitive to low-frequency ground motion from heavy vehicles.' },
      { id: 'accel', name: 'Low-noise accelerometer', part: 'Analog Devices ADXL355', iface: 'SPI, I²C', spec: '3 axis, 25 µg/√Hz', summary: 'A few grams instead of a geophone, and reads all three axes.' },
    ],
  },
  {
    id: 'radiation',
    name: 'Radiation',
    role: 'Measures gamma radiation',
    how: 'Counts gamma rays at each landing. The dose rate for every cell builds a radiation map of the sweep, and a spectrometer can also tell which isotope is present.',
    standard: false,
    modules: [
      { id: 'bg51', name: 'Radiation counter', part: 'Teviso BG51', iface: 'Pulse output', spec: 'PIN diode, gamma and beta', summary: 'A thin board that counts radiation. Dose rate only, at the lowest weight.' },
      { id: 'sigma', name: 'Scintillation spectrometer', part: 'Kromek SIGMA 50', iface: 'USB', spec: 'CsI(Tl) crystal, gamma spectrum', summary: 'A large crystal for high sensitivity. Picks up weak sources and records the gamma spectrum.' },
      { id: 'gr1', name: 'Isotope identifier', part: 'Kromek GR1', iface: 'USB', spec: 'CZT, under 2.5% FWHM at 662 keV', summary: 'Room-temperature CZT with fine energy resolution, so it can name the isotope.' },
    ],
  },
  {
    id: 'rf',
    name: 'Radio receiver',
    role: 'Detects radio transmitters nearby',
    how: 'A software-defined radio scans the bands at each landing. Signal strength per cell maps where emitters are, such as radios, drone links or jammers. It reports a radio cue, not what the transmitter is.',
    standard: false,
    modules: [
      { id: 'rtlsdr', name: 'Wideband receiver', part: 'RTL-SDR Blog V4', iface: 'USB', spec: '500 kHz to 1.766 GHz', summary: 'A dongle-sized receiver for VHF and UHF radios.' },
      { id: 'b205', name: 'Full-band SDR', part: 'Ettus USRP B205mini-i', iface: 'USB 3.0', spec: '70 MHz to 6 GHz, 56 MHz bandwidth', summary: 'Covers the 2.4 and 5.8 GHz bands that drone links use.' },
    ],
  },
]

export const PARTS: Part[] = [...AIRFRAME, ...BAYS]

export const DEFAULT_VARIANTS = Object.fromEntries(BAYS.map((b) => [b.id, b.standard ? b.modules[0].id : EMPTY])) as Record<SlotId, string>

export const bayOf = (id: PartId | null) => BAYS.find((b) => b.id === id)
export const partNumber = (id: PartId) => String(PARTS.findIndex((p) => p.id === id) + 1).padStart(2, '0')
