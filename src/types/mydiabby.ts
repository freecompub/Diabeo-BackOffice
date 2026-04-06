/**
 * Types for MyDiabby API responses.
 *
 * Derived from the MyDiabby API documentation:
 * - DiabeoDoc/Datamanager/MyDiabby_API_Analysis.md
 * - DiabeoDoc/Datamanager/GetAccount/Response.json
 * - DiabeoDoc/Datamanager/GetUserData/responseGetData.json
 *
 * These types are used exclusively in the staging sync service.
 */

// ── Authentication ──────────────────────────────────────────

export interface MyDiabbyAuthRequest {
  username: string
  password: string
  platform: string // "dt0"
}

export interface MyDiabbyAuthResponse {
  token: string
  data: {
    uid: number
    pro: boolean
    patient: boolean
    need2fa: boolean
  }
  refresh_token: string
}

export interface MyDiabbyRefreshResponse {
  success: boolean
  token: string
}

// ── Account ─────────────────────────────────────────────────

export interface MyDiabbyAccountResponse {
  success: boolean
  errors: string[]
  user: MyDiabbyUser
}

export interface MyDiabbyUser {
  id: number
  email: string
  title: string | null
  firstname: string
  firstnames: string | null
  usedFirstname: string | null
  lastname: string
  usedLastname: string | null
  codeBirthPlace: string | null
  birthday: string | null // "YYYY-MM-DD"
  sex: "M" | "F" | null
  timezone: string | null
  phone: string | null
  address1: string | null
  address2: string | null
  cp: string | null
  city: string | null
  country: string | null // ISO 2-letter
  pic: string | null
  language: string | null // "fr", "en", "ar"
  hasSignedTermsOfUse: boolean

  // Unit preferences (IDs matching UnitDefinition)
  unit_glycemia: number
  unit_weight: number
  unit_size: number
  unit_carb: number
  unit_hba1c: number
  unit_carb_exchange_nb: number
  unit_ketones: number
  unit_bloodpressure: number

  listunits: Record<string, Record<string, MyDiabbyUnit>>
  listdevicedata: MyDiabbyDeviceData[]

  created: string // Unix timestamp as string
  nirpp: string | null
  nirpp_type: string | null
  nirpp_policyholder: string | null
  nirpp_policyholder_type: string | null
  oid: string | null
  ins: string | null

  // Notification preferences
  notif_message_mail: boolean
  notif_document_mail: boolean

  // Internal fields (not exposed in Diabeo API)
  intercom_hash: string | null
  deploymentKey: string | null
  needdatapolicyupdate: boolean
  datapolicyupdate: string | null
  needpasswordupdate: boolean
  needOnboarding: boolean
  debug: boolean

  patient: MyDiabbyPatient | null
}

export interface MyDiabbyUnit {
  id: number
  unit: string
  title: string
  factor: string
  factor_base: string
  precision: number
}

export interface MyDiabbyDeviceData {
  device_uid: string | null
  sequenceNum: number | null
}

// ── Patient ─────────────────────────────────────────────────

export interface MyDiabbyPatient {
  id: number
  created: string // ISO datetime
  pathology: "DT1" | "DT2" | "GD"

  objective: MyDiabbyObjective
  treatment: MyDiabbyTreatment
  medicaldata: MyDiabbyMedicalData

  referent: MyDiabbyReferent | null
  services: MyDiabbyServiceLink[]
  document: MyDiabbyDocument[]
  device: MyDiabbyDevice[]
  appointments: MyDiabbyAppointment[]
}

export interface MyDiabbyObjective {
  glycemia: {
    current: MyDiabbyGlycemiaLimits
    default: MyDiabbyGlycemiaLimits
  }
  cgm: {
    default: MyDiabbyCgmLimits
  }
  annex: {
    objective_hba1c: string | null
    objective_minweight: string | null
    objective_maxweight: string | null
    objective_walk: string | null
  }
}

export interface MyDiabbyGlycemiaLimits {
  limit_em_white: string
  limit_em_green: string
  limit_em_orange: string
  limit_bm_white: string
  limit_bm_green: string
  limit_bm_orange: string
  limit_am_white: string
  limit_am_green: string
  limit_am_orange: string
  limit_am1h_white: string
  limit_am1h_green: string
  limit_am1h_orange: string
  isdefault: boolean
}

export interface MyDiabbyCgmLimits {
  verylow: string
  low: string
  ok: string
  high: string
  titr_low: string
  titr_high: string
}

export interface MyDiabbyTreatment {
  fgm: MyDiabbyTreatmentItem | null
  pump: MyDiabbyTreatmentItem | null
  insulinpump: MyDiabbyInsulinPumpTreatment | null
  glp1: MyDiabbyTreatmentItem[]
}

export interface MyDiabbyTreatmentItem {
  id: number
  other: string | null
  posology: string | null
  posology_data: unknown | null
  name: string
  treatment_id: number
  updated: string | null
}

export interface MyDiabbyInsulinPumpTreatment extends MyDiabbyTreatmentItem {
  posology_data: {
    flows: MyDiabbyBasalFlow[]
    insulin_carb_ratio: MyDiabbyTimeRate[]
    correction_factor: MyDiabbyTimeRate[]
  } | null
}

export interface MyDiabbyBasalFlow {
  label: string
  schedule: MyDiabbyTimeRate[]
}

export interface MyDiabbyTimeRate {
  start: string // milliseconds from midnight as string
  rate: string // value as string
}

export interface MyDiabbyMedicalData {
  dt1: boolean
  dt2?: boolean
  size: string | null
  yeardiag: number | null
  insulin: boolean
  insulinyear: number | null
  insulinpump: boolean
  pathology: string
  diabetdiscovery: string | null
  tabac: boolean
  alcool: boolean
  historymedical: string | null
  historychirurgical: string | null
  historyfamily: string | null
  historyallergy: string | null
  historyvaccine: string | null
  historylife: string | null
  risk_weight: boolean
  risk_tension: boolean
  risk_sedent: boolean
  risk_cholesterol: boolean
  risk_age: boolean
  risk_heredit: boolean
  risk_cardio: boolean
  risk_hypothyroidism: boolean
  risk_celiac: boolean
  risk_other_autoimmune: string | null
  vitale_attest: boolean
}

export interface MyDiabbyReferent {
  pro: { id: number; name: string }
  service: {
    id: number
    name: string
    novideos: boolean
    nofood: boolean
    logo: string | null
    country: string
  }
}

export interface MyDiabbyServiceLink {
  id: number
  service: {
    id: number
    name: string
    establishment: string
    city: string
    country: string
  }
  wait: boolean
  member: Array<{ id: number; name: string }>
}

export interface MyDiabbyDocument {
  id: number
  name: string
  date: string
  category: string
  shared: boolean
}

export interface MyDiabbyDevice {
  id: number
  name: string
  type: string
  uid: string | null
}

export interface MyDiabbyAppointment {
  id: number
  type: string
  date: string
  hour: string
  comment: string | null
}

// ── Data (health data) ──────────────────────────────────────

export interface MyDiabbyDataResponse {
  success: boolean
  datefirst: string
  datelast: string
  showwarningglycemia: boolean
  announcement: MyDiabbyAnnouncement | null
  data: MyDiabbyHealthData
}

export interface MyDiabbyAnnouncement {
  data: {
    id: number
    title: string
    content: string
    createdAt: string
    updatedAt: string
  }
  statut: {
    displayAnnouncement: boolean
    displayShowButton: boolean
  }
}

export interface MyDiabbyHealthData {
  cgm: MyDiabbyCgmEntry[]
  glycemia: MyDiabbyGlycemiaEntry[]
  insulinflow: MyDiabbyInsulinFlowEntry[]
  insulinflow_device: MyDiabbyInsulinFlowDeviceEntry[]
  pumpevents: MyDiabbyPumpEvent[]
  snack: MyDiabbySnackEntry[]
  closed_loop: unknown[]
  closed_loop_mode: unknown[]
  avgdata: unknown[]
  avgdata7: unknown[]
  avgdata30: unknown[]
}

export interface MyDiabbyCgmEntry {
  date: string // ISO datetime
  value: string // g/L as string (e.g., "1.6400")
  manual?: boolean
}

export interface MyDiabbyGlycemiaEntry {
  date: string
  value: string
  period?: string
}

export interface MyDiabbyInsulinFlowEntry {
  date: string
  value: string
  type?: string // "basal", "bolus"
  subtype?: string
}

export interface MyDiabbyInsulinFlowDeviceEntry {
  date: string
  value: string
  type?: string
  device_uid?: string
}

export interface MyDiabbyPumpEvent {
  date: string
  type: string
  value?: string
}

export interface MyDiabbySnackEntry {
  date: string
  value: string // carbs in grams
  period?: string
}
