'use client'

/**
 * Desktop API client — wraps Tauri IPC `invoke()` calls.
 *
 * Every public function maps 1:1 to a Tauri command registered in
 * `src-tauri/src/main.rs`.  The generic `invoke` from `@tauri-apps/api/core`
 * serializes arguments to JSON, calls the Rust command by name, and
 * deserializes the Rust return value back to TypeScript.
 */

import type {
  ApiResponse,
  LoginRequest,
  LoginResponse,
  ChangePasswordRequest,
  DeviceEnrollmentRequest,
  DeviceEnrollmentResponse,
  DeviceKeyPair,
  DeviceStatus,
  RegisteredDevice,
  PatientSearchResult,
  PatientDetail,
  VisitInfo,
  NoteInfo,
  PrescriptionInfo,
  ReportInfo,
  TimelineEntry,
  DocumentInfo,
  PaginatedResponse,
  BackupInfo,
  RestorePreview,
  RestoreResult,
  BackupDriveStatus,
  BackupProgress,
  ChecksumResult,
  ScannerDevice,
  ScanConfig,
  ScanResult,
  AppSettings,
  ServiceStatus,
  DatabaseStatus,
  ConnectionResult,
  CertTrustStatus,
} from './types'

// ---------- invoke helper ----------

let invokeFn: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@tauri-apps/api/core')
  invokeFn = mod.invoke
} catch {
  // Fallback for browser dev — throws a clear error
  invokeFn = async <T>(cmd: string) => {
    throw new DesktopApiError(
      'NOT_DESKTOP',
      `Tauri command "${cmd}" is only available in the desktop app.`,
      0
    )
  }
}

// ---------- Error class ----------

export class DesktopApiError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'DesktopApiError'
    this.code = code
    this.status = status
  }
}

/**
 * Map raw invoke errors / API error envelopes to user-friendly messages.
 */
function friendlyMessage(err: unknown): string {
  if (err instanceof DesktopApiError) return err.message
  if (err instanceof Error) {
    // Tauri IPC errors often have a string payload
    const msg = err.message
    if (msg.includes('network') || msg.includes('connect'))
      return 'Unable to reach the server. Check your connection and server URL.'
    if (msg.includes('timeout'))
      return 'The request timed out. The server may be busy.'
    if (msg.includes('certificate') || msg.includes('tls') || msg.includes('ssl'))
      return 'Certificate error. The server\'s TLS certificate may not be trusted on this device.'
    if (msg.includes('unauthorized') || msg.includes('401'))
      return 'Session expired. Please sign in again.'
    if (msg.includes('forbidden') || msg.includes('403'))
      return 'You do not have permission to perform this action.'
    if (msg.includes('not found') || msg.includes('404'))
      return 'The requested resource was not found.'
    if (msg.includes('conflict') || msg.includes('409'))
      return 'A conflict occurred. The resource may already exist.'
    // Return the raw message if nothing matches
    return msg
  }
  return 'An unexpected error occurred. Please try again.'
}

/**
 * Unwrap an `ApiResponse<T>` — throws on error status.
 */
function unwrap<T>(res: ApiResponse<T>): T {
  if (res.status === 'ok') return res.data
  const apiErr = (res as { status: 'error'; error: { code: string; message: string; status: number } }).error
  throw new DesktopApiError(apiErr.code, apiErr.message, apiErr.status)
}

// ---------- Auth token tracking ----------

let _sessionExpiresAt: string | null = null

function isSessionValid(): boolean {
  if (!_sessionExpiresAt) return false
  return new Date(_sessionExpiresAt).getTime() > Date.now()
}

function trackSession(expiresAt: string) {
  _sessionExpiresAt = expiresAt
}

function clearSession() {
  _sessionExpiresAt = null
}

// ====================================================================
// AUTH COMMANDS
// ====================================================================

export async function login(req: LoginRequest): Promise<LoginResponse> {
  clearSession()
  const res = await invokeFn<ApiResponse<LoginResponse>>('login', { request: req })
  const data = unwrap(res)
  trackSession(data.expires_at)
  return data
}

export async function logout(): Promise<void> {
  clearSession()
  await invokeFn<void>('logout')
}

export async function refreshSession(): Promise<LoginResponse> {
  const res = await invokeFn<ApiResponse<LoginResponse>>('refresh_session')
  const data = unwrap(res)
  trackSession(data.expires_at)
  return data
}

export async function changePassword(req: ChangePasswordRequest): Promise<void> {
  await invokeFn<void>('change_password', { request: req })
}

export async function getForcePasswordChangeStatus(): Promise<boolean> {
  return invokeFn<boolean>('get_force_password_change_status')
}

// ====================================================================
// DEVICE COMMANDS
// ====================================================================

export async function generateDeviceKeyPair(): Promise<DeviceKeyPair> {
  return invokeFn<DeviceKeyPair>('generate_device_keypair')
}

export async function enrollDevice(req: DeviceEnrollmentRequest): Promise<DeviceEnrollmentResponse> {
  return invokeFn<DeviceEnrollmentResponse>('enroll_device', { request: req })
}

export async function getDeviceStatus(): Promise<DeviceStatus> {
  return invokeFn<DeviceStatus>('get_device_status')
}

export async function revokeDevice(deviceId: string): Promise<void> {
  await invokeFn<void>('revoke_device', { deviceId })
}

export async function signChallenge(challengeId: string, nonce: string): Promise<string> {
  return invokeFn<string>('sign_challenge', { challengeId, nonce })
}

export async function listDevices(): Promise<RegisteredDevice[]> {
  return invokeFn<RegisteredDevice[]>('list_devices')
}

// ====================================================================
// PATIENT COMMANDS
// ====================================================================

export async function searchPatients(
  query: string,
  page = 1,
  perPage = 20
): Promise<PaginatedResponse<PatientSearchResult>> {
  return invokeFn<PaginatedResponse<PatientSearchResult>>('search_patients', {
    query,
    page,
    perPage,
  })
}

export async function getRecentPatients(
  limit = 10
): Promise<PatientSearchResult[]> {
  return invokeFn<PatientSearchResult[]>('get_recent_patients', { limit })
}

export async function getPatient(patientId: string): Promise<PatientDetail> {
  return invokeFn<PatientDetail>('get_patient', { patientId })
}

export async function getPatientTimeline(
  patientId: string,
  page = 1,
  perPage = 50
): Promise<PaginatedResponse<TimelineEntry>> {
  return invokeFn<PaginatedResponse<TimelineEntry>>('get_patient_timeline', {
    patientId,
    page,
    perPage,
  })
}

export async function getPatientVisits(patientId: string): Promise<VisitInfo[]> {
  return invokeFn<VisitInfo[]>('get_patient_visits', { patientId })
}

export async function getPatientNotes(patientId: string): Promise<NoteInfo[]> {
  return invokeFn<NoteInfo[]>('get_patient_notes', { patientId })
}

export async function getPatientPrescriptions(patientId: string): Promise<PrescriptionInfo[]> {
  return invokeFn<PrescriptionInfo[]>('get_patient_prescriptions', { patientId })
}

export async function getPatientReports(patientId: string): Promise<ReportInfo[]> {
  return invokeFn<ReportInfo[]>('get_patient_reports', { patientId })
}

// ====================================================================
// DOCUMENT COMMANDS
// ====================================================================

export async function uploadDocument(
  patientId: string,
  filePath: string,
  title?: string,
  category?: string,
  notes?: string
): Promise<DocumentInfo> {
  return invokeFn<DocumentInfo>('upload_document', {
    patientId,
    filePath,
    title,
    category,
    notes,
  })
}

export async function uploadMultiple(
  patientId: string,
  filePaths: string[],
  category?: string
): Promise<DocumentInfo[]> {
  return invokeFn<DocumentInfo[]>('upload_multiple', {
    patientId,
    filePaths,
    category,
  })
}

export async function uploadFolder(
  patientId: string,
  folderPath: string,
  category?: string,
  recursive = true
): Promise<DocumentInfo[]> {
  return invokeFn<DocumentInfo[]>('upload_folder', {
    patientId,
    folderPath,
    category,
    recursive,
  })
}

export async function downloadDocument(documentId: string): Promise<string> {
  return invokeFn<string>('download_document', { documentId })
}

export async function downloadRange(
  documentId: string,
  start: number,
  end: number
): Promise<string> {
  return invokeFn<string>('download_range', { documentId, start, end })
}

export async function viewDocument(documentId: string): Promise<string> {
  return invokeFn<string>('view_document', { documentId })
}

export async function moveDocument(
  documentId: string,
  newPatientId: string
): Promise<DocumentInfo> {
  return invokeFn<DocumentInfo>('move_document', { documentId, newPatientId })
}

export async function restoreDocument(documentId: string): Promise<DocumentInfo> {
  return invokeFn<DocumentInfo>('restore_document', { documentId })
}

export async function deleteDocument(documentId: string): Promise<void> {
  await invokeFn<void>('delete_document', { documentId })
}

export async function getDocumentInfo(documentId: string): Promise<DocumentInfo> {
  return invokeFn<DocumentInfo>('get_document_info', { documentId })
}

// ====================================================================
// BACKUP COMMANDS
// ====================================================================

export async function getBackupDriveStatus(): Promise<BackupDriveStatus> {
  return invokeFn<BackupDriveStatus>('get_backup_drive_status')
}

export async function selectBackupDestination(): Promise<string> {
  return invokeFn<string>('select_backup_destination')
}

export async function startManualBackup(notes?: string): Promise<string> {
  return invokeFn<string>('start_manual_backup', { notes })
}

export async function getBackupProgress(backupId: string): Promise<BackupProgress> {
  return invokeFn<BackupProgress>('get_backup_progress', { backupId })
}

export async function verifyBackupChecksums(backupId: string): Promise<ChecksumResult[]> {
  return invokeFn<ChecksumResult[]>('verify_backup_checksums', { backupId })
}

export async function getRestorePreview(backupId: string): Promise<RestorePreview> {
  return invokeFn<RestorePreview>('get_restore_preview', { backupId })
}

export async function executeRestore(backupId: string): Promise<RestoreResult> {
  return invokeFn<RestoreResult>('execute_restore', { backupId })
}

export async function getBackupHistory(): Promise<BackupInfo[]> {
  return invokeFn<BackupInfo[]>('get_backup_history')
}

// ====================================================================
// SCANNER COMMANDS
// ====================================================================

export async function listScanners(): Promise<ScannerDevice[]> {
  return invokeFn<ScannerDevice[]>('list_scanners')
}

export async function scanSinglePage(config: ScanConfig, scannerId?: string): Promise<ScanResult> {
  return invokeFn<ScanResult>('scan_single_page', { config, scannerId })
}

export async function scanMultiPage(
  config: ScanConfig,
  pageCount: number,
  scannerId?: string
): Promise<ScanResult[]> {
  return invokeFn<ScanResult[]>('scan_multi_page', {
    config,
    pageCount,
    scannerId,
  })
}

export async function rotatePage(pagePath: string, degrees: number): Promise<string> {
  return invokeFn<string>('rotate_page', { pagePath, degrees })
}

export async function removePage(pagePath: string): Promise<void> {
  await invokeFn<void>('remove_page', { pagePath })
}

export async function reorderPage(pagePath: string, newIndex: number): Promise<void> {
  await invokeFn<void>('reorder_page', { pagePath, newIndex })
}

export async function createPdfFromPages(pagePaths: string[]): Promise<string> {
  return invokeFn<string>('create_pdf_from_pages', { pagePaths })
}

export async function cleanupTempFiles(pagePaths: string[]): Promise<void> {
  await invokeFn<void>('cleanup_temp_files', { pagePaths })
}

// ====================================================================
// SETTINGS / STATUS COMMANDS
// ====================================================================

export async function getSettings(): Promise<AppSettings> {
  return invokeFn<AppSettings>('get_settings')
}

export async function updateSettings(
  partial: Partial<AppSettings>
): Promise<AppSettings> {
  return invokeFn<AppSettings>('update_settings', { partial })
}

export async function testServerConnection(
  serverUrl?: string
): Promise<ConnectionResult> {
  return invokeFn<ConnectionResult>('test_server_connection', { serverUrl })
}

export async function getCertificateTrustStatus(): Promise<CertTrustStatus> {
  return invokeFn<CertTrustStatus>('get_certificate_trust_status')
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  return invokeFn<ServiceStatus>('get_service_status')
}

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  return invokeFn<DatabaseStatus>('get_database_status')
}

export async function getDeviceRegistrationStatus(): Promise<DeviceStatus> {
  return invokeFn<DeviceStatus>('get_device_registration_status')
}

export async function getLogContents(lines = 100): Promise<string> {
  return invokeFn<string>('get_log_contents', { lines })
}

// ====================================================================
// RE-EXPORT helpers for components
// ====================================================================

export { friendlyMessage, isSessionValid }
