'use client'

// ---------------------------------------------------------------------------
// Generic API response wrapper — mirrors Rust ApiResponse<T>
// ---------------------------------------------------------------------------

export interface ApiError {
  code: string
  message: string
  status: number
}

export type ApiResponse<T> =
  | { status: 'ok'; data: T }
  | { status: 'error'; error: ApiError }

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export interface LoginRequest {
  email: string
  password: string
  server_url?: string
}

export interface LoginResponse {
  session_id: string
  user_id: string
  email: string
  role: string
  force_password_change: boolean
  csrf_token?: string
  expires_at: string
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
  confirm_password: string
}

// ---------------------------------------------------------------------------
// Device enrollment
// ---------------------------------------------------------------------------

export interface DeviceEnrollmentRequest {
  pairing_code: string
  device_name: string
}

export interface DeviceEnrollmentResponse {
  device_id: string
  device_name: string
  enrolled_at: string
  public_key_fingerprint: string
}

export interface ChallengeResponse {
  challenge_id: string
  nonce: string
  expires_at: string
}

export interface ChallengeProofRequest {
  challenge_id: string
  signature: string
}

export interface DeviceKeyPair {
  device_id: string
  public_key_pem: string
  private_key_stored: boolean
  public_key_fingerprint: string
}

export interface DeviceStatus {
  registered: boolean
  device_id?: string
  device_name?: string
  enrolled_at?: string
  public_key_fingerprint?: string
  last_seen_at?: string
  challenge_required: boolean
}

export interface RegisteredDevice {
  id: string
  device_name: string
  public_key_fingerprint: string
  enrolled_at: string
  last_seen_at?: string
  is_current: boolean
}

// ---------------------------------------------------------------------------
// Patient types
// ---------------------------------------------------------------------------

export interface PatientSearchResult {
  id: string
  full_name: string
  date_of_birth?: string
  mrn?: string
  last_visit_date?: string
}

export interface PatientDetail {
  id: string
  first_name: string
  last_name: string
  date_of_birth?: string
  gender?: string
  mrn?: string
  email?: string
  phone?: string
  address?: string
  allergies?: Record<string, unknown> | unknown[]
  insurance_info?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface VisitInfo {
  id: string
  patient_id: string
  visit_date: string
  visit_type?: string
  provider_name?: string
  chief_complaint?: string
  diagnosis_codes?: unknown
  notes_count: number
  documents_count: number
  prescriptions_count: number
}

export interface NoteInfo {
  id: string
  patient_id: string
  title?: string
  content?: string
  note_type?: string
  author_name?: string
  created_at: string
  updated_at: string
}

export interface PrescriptionInfo {
  id: string
  patient_id: string
  medication_name?: string
  dosage?: string
  frequency?: string
  prescriber_name?: string
  start_date?: string
  end_date?: string
  status?: string
  notes?: string
  created_at: string
}

export interface ReportInfo {
  id: string
  patient_id: string
  title?: string
  report_type?: string
  status?: string
  ordered_by?: string
  result_date?: string
  created_at: string
}

export interface TimelineEntry {
  id: string
  entry_type: string
  title: string
  description?: string
  author_name?: string
  occurred_at: string
}

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

export interface DocumentInfo {
  id: string
  patient_id: string
  title?: string
  category?: string
  file_name: string
  file_size?: number
  mime_type?: string
  checksum_sha256?: string
  created_by?: string
  created_at: string
  updated_at: string
  deleted_at?: string
  version?: number
}

export interface UploadProgress {
  upload_id: string
  file_name: string
  bytes_uploaded: number
  total_bytes: number
  percentage: number
  status: string
}

// ---------------------------------------------------------------------------
// Backup types
// ---------------------------------------------------------------------------

export interface BackupInfo {
  id: string
  started_at: string
  completed_at?: string
  status: string
  total_size_bytes?: number
  file_count?: number
  destination: string
  checksum_algorithm?: string
  notes?: string
}

export interface RestorePreview {
  backup_id: string
  file_count: number
  total_size_bytes: number
  files: RestoreFileEntry[]
  warnings: string[]
}

export interface RestoreFileEntry {
  path: string
  size_bytes: number
  modified_at?: string
}

export interface RestoreResult {
  success: boolean
  restored_count: number
  failed_count: number
  errors: string[]
  completed_at: string
}

export interface BackupDriveStatus {
  available: boolean
  drive_label?: string
  free_space_bytes?: number
  total_space_bytes?: number
  path?: string
}

export interface BackupProgress {
  backup_id: string
  current_step: string
  files_processed: number
  total_files?: number
  bytes_processed: number
  total_bytes?: number
  percentage: number
  started_at: string
  estimated_remaining_seconds?: number
}

export interface ChecksumResult {
  file_path: string
  expected: string
  actual: string
  matches: boolean
}

// ---------------------------------------------------------------------------
// Scanner types
// ---------------------------------------------------------------------------

export type ScannerType = 'wia' | 'twain' | 'folder'

export interface ScannerDevice {
  id: string
  name: string
  scanner_type: ScannerType
  is_default: boolean
}

export type ScanColorMode = 'color' | 'grayscale' | 'monochrome'
export type ScanPaperSize = 'a4' | 'letter' | 'legal' | 'auto'
export type ScanQuality = 'draft' | 'normal' | 'high' | 'photo'

export interface ScanConfig {
  resolution_dpi: number
  color_mode: ScanColorMode
  paper_size: ScanPaperSize
  duplex: boolean
  quality: ScanQuality
}

export interface ScanResult {
  page_path: string
  width_px: number
  height_px: number
  file_size_bytes: number
  mime_type: string
}

// ---------------------------------------------------------------------------
// Settings (non-sensitive)
// ---------------------------------------------------------------------------

export interface AppSettings {
  server_url: string
  theme: string
  language: string
  auto_backup_enabled: boolean
  auto_backup_interval_minutes: number
  backup_destination?: string
  scan_default_config: ScanConfig
  default_document_category?: string
  notification_sound_enabled: boolean
  minimize_to_tray: boolean
  start_with_windows: boolean
  last_patient_id?: string
  recently_viewed_patients: string[]
  max_recent_patients: number
}

// ---------------------------------------------------------------------------
// Service / system status
// ---------------------------------------------------------------------------

export interface ServiceStatus {
  reachable: boolean
  response_time_ms?: number
  server_version?: string
  uptime_seconds?: number
  error?: string
}

export interface DatabaseStatus {
  connected: boolean
  size_bytes?: number
  total_patients?: number
  total_documents?: number
  last_backup?: string
  error?: string
}

export interface ConnectionResult {
  success: boolean
  response_time_ms?: number
  server_version?: string
  error?: string
}

export interface CertTrustStatus {
  trusted: boolean
  issuer?: string
  expires_at?: string
  days_until_expiry?: number
  error?: string
}

// ---------------------------------------------------------------------------
// Desktop UI navigation
// ---------------------------------------------------------------------------

export type DesktopView =
  | 'dashboard'
  | 'patients'
  | 'documents'
  | 'scanner'
  | 'backup'
  | 'settings'
