// API helper functions for client-side use
// All API requests go through the Next.js rewrites proxy to the Fastify API service

export interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options

  const config: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    credentials: 'include',
  }

  if (body && method !== 'GET') {
    config.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  const res = await fetch(endpoint, config)

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message || `HTTP ${res.status}`)
  }

  const contentType = res.headers.get('content-type')
  if (contentType && !contentType.includes('application/json')) {
    return res as unknown as T
  }

  return res.json()
}

export async function uploadDocument(patientId: string, file: File, metadata: {
  title?: string
  category?: string
  notes?: string
}): Promise<unknown> {
  const formData = new FormData()
  formData.append('file', file)
  if (metadata.title) formData.append('title', metadata.title)
  if (metadata.category) formData.append('category', metadata.category)
  if (metadata.notes) formData.append('notes', metadata.notes)

  const res = await fetch(`/api/patients/${patientId}/documents`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Upload failed' }))
    throw new Error(error.message || `HTTP ${res.status}`)
  }

  return res.json()
}

export async function downloadBackup(): Promise<Blob> {
  const res = await fetch('/api/backup', {
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error('Backup failed')
  }
  return res.blob()
}

export async function getSession(): Promise<unknown> {
  try {
    const res = await fetch('/api/auth/me')
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function signIn(credentials: { email: string; password: string }): Promise<unknown> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Login failed' }))
    throw new Error(error.message || 'Invalid credentials')
  }

  return res.json()
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
}

export interface Patient {
  id: string
  doctorId: string
  firstName: string
  lastName: string
  dateOfBirth: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  _count?: { documents: number }
}

export interface Document {
  id: string
  patientId: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  title: string | null
  category: string
  notes: string | null
  scannedAt: string
  createdAt: string
  updatedAt: string
  patient?: Patient
}

export interface Doctor {
  id: string
  email: string
  name: string
  phone: string | null
  specialty: string | null
  createdAt: string
  updatedAt: string
}

export interface Stats {
  totalPatients: number
  totalDocuments: number
  recentScans: number
  storageUsed: string
  recentPatients: Patient[]
}
