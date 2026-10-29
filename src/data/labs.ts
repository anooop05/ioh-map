export type AccessStatus = 'open' | 'closed' | 'restricted'
export type CrowdStatus = 'open' | 'filling' | 'full'

export interface Lab {
  id: string
  name: string
  department: string
  latitude: number
  longitude: number
  currentVisitors: number
  maxCapacity: number
  access: AccessStatus
  openingTime: string
  closingTime: string
  description: string
}

// Demonstration records only. Campus locations, attendance and hours are unverified.
// Replace coordinates with verified building locations before a public event.
const labRecords: Lab[] = [
  { id: 'cfi', name: 'Centre for Innovation (CFI)', department: 'Student Innovation', latitude: 12.9918, longitude: 80.2337, currentVisitors: 42, maxCapacity: 80, openingTime: '09:00 AM', closingTime: '04:00 PM', description: 'A student-run innovation space showcasing projects, prototypes and hands-on engineering.', access: 'open' },
  { id: 'biosciences', name: 'Bhupat and Jyoti Mehta School of Biosciences', department: 'School of Biosciences', latitude: 12.9906, longitude: 80.2358, currentVisitors: 29, maxCapacity: 48, openingTime: '09:00 AM', closingTime: '04:00 PM', description: 'Research demonstrations from the School of Biosciences. Please follow on-site visitor guidance.', access: 'open' },
  { id: 'brain', name: 'Sudha Gopalakrishnan BRAIN Centre', department: 'Interdisciplinary Research', latitude: 12.9893, longitude: 80.2319, currentVisitors: 64, maxCapacity: 72, openingTime: '09:00 AM', closingTime: '04:00 PM', description: 'An interdisciplinary centre focused on brain research, technology and translational work.', access: 'open' },
  { id: 'aero', name: 'Aerospace Engineering Lab', department: 'Department of Aerospace Engineering', latitude: 12.9930, longitude: 80.2302, currentVisitors: 18, maxCapacity: 60, openingTime: '09:00 AM', closingTime: '04:00 PM', description: 'Selected aerospace research demonstrations. Exact venue and access are subject to event staff.', access: 'open' },
  { id: 'ee', name: 'Electrical Engineering Lab', department: 'Department of Electrical Engineering', latitude: 12.9883, longitude: 80.2347, currentVisitors: 51, maxCapacity: 64, openingTime: '09:00 AM', closingTime: '04:00 PM', description: 'Demonstrations from selected electrical engineering groups and student teams.', access: 'open' },
  { id: 'chem', name: 'Chemical Engineering Lab', department: 'Department of Chemical Engineering', latitude: 12.9923, longitude: 80.2384, currentVisitors: 0, maxCapacity: 45, openingTime: '09:00 AM', closingTime: '04:00 PM', description: 'Selected process and materials research demonstrations. Check the access status before visiting.', access: 'restricted' },
  { id: 'civil', name: 'Civil Engineering Research Lab', department: 'Department of Civil Engineering', latitude: 12.9875, longitude: 80.2306, currentVisitors: 0, maxCapacity: 52, openingTime: '09:00 AM', closingTime: '04:00 PM', description: 'Research displays from selected civil engineering groups.', access: 'closed' },
]

function validateLabs(records: Lab[]): Lab[] {
  const ids = new Set<string>()
  for (const lab of records) {
    if (!lab.id.trim() || ids.has(lab.id)) throw new Error(`Lab data contains a missing or duplicate id: ${lab.id}`)
    ids.add(lab.id)
    if (!lab.name.trim() || !lab.department.trim()) throw new Error(`Lab ${lab.id} is missing a name or department.`)
    if (!Number.isFinite(lab.latitude) || lab.latitude < -90 || lab.latitude > 90 || !Number.isFinite(lab.longitude) || lab.longitude < -180 || lab.longitude > 180) {
      throw new Error(`Lab ${lab.id} has invalid coordinates.`)
    }
    if (!Number.isInteger(lab.maxCapacity) || lab.maxCapacity <= 0) throw new Error(`Lab ${lab.id} must have a positive whole-number capacity.`)
    if (!Number.isInteger(lab.currentVisitors) || lab.currentVisitors < 0 || lab.currentVisitors > lab.maxCapacity) {
      throw new Error(`Lab ${lab.id} must have a visitor count between zero and its capacity.`)
    }
    if (!['open', 'closed', 'restricted'].includes(lab.access)) throw new Error(`Lab ${lab.id} has an invalid access status.`)
  }
  return records
}

export const initialLabs = validateLabs(labRecords)

export function crowdFor(lab: Pick<Lab, 'currentVisitors' | 'maxCapacity'>): CrowdStatus {
  const ratio = lab.maxCapacity > 0 ? lab.currentVisitors / lab.maxCapacity : 1
  if (ratio >= 0.85) return 'full'
  if (ratio >= 0.6) return 'filling'
  return 'open'
}

export const slots = ['09:00 AM – 11:00 AM: Evaluation Slot', '02:00 PM – 04:00 PM: General Public Slot'] as const
