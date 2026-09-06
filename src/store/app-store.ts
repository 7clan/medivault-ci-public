import { create } from 'zustand'

export type ViewType = 'login' | 'setup' | 'dashboard' | 'patient-detail' | 'document-viewer' | 'scan-capture' | 'settings'

export interface PatientInfo {
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
  documents?: any[]
}

export interface DocumentInfo {
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
  patient?: { firstName: string; lastName: string; id: string }
}

const RECENTLY_VIEWED_KEY = 'medivault-recently-viewed'
const MAX_RECENTLY_VIEWED = 5

function loadRecentlyViewed(): PatientInfo[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(RECENTLY_VIEWED_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveRecentlyViewed(patients: PatientInfo[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(patients))
  } catch {
    // localStorage may be full or unavailable
  }
}

function addToRecentlyViewed(patient: PatientInfo): PatientInfo[] {
  const existing = loadRecentlyViewed()
  // Remove if already in the list
  const filtered = existing.filter((p) => p.id !== patient.id)
  // Add to front and trim to max
  const updated = [patient, ...filtered].slice(0, MAX_RECENTLY_VIEWED)
  saveRecentlyViewed(updated)
  return updated
}

interface AppState {
  // Navigation
  currentView: ViewType
  previousView: ViewType | null

  // Selected items
  selectedPatient: PatientInfo | null
  selectedDocument: DocumentInfo | null

  // Search
  searchQuery: string

  // UI state
  isLoading: boolean
  scanTargetPatientId: string | null

  // Doctor info
  doctorName: string | null
  doctorEmail: string | null
  doctorId: string | null

  // Recently viewed
  recentlyViewed: PatientInfo[]

  // Actions
  setCurrentView: (view: ViewType) => void
  goBack: () => void
  selectPatient: (patient: PatientInfo) => void
  updateSelectedPatient: (patient: PatientInfo) => void
  clearPatient: () => void
  selectDocument: (doc: DocumentInfo) => void
  clearDocument: () => void
  setSearchQuery: (query: string) => void
  setIsLoading: (loading: boolean) => void
  setScanTargetPatientId: (id: string | null) => void
  setDoctorInfo: (name: string | null, email: string | null, id: string | null) => void
  logout: () => void
  initRecentlyViewed: () => void
}

export const useAppStore = create<AppState>((set) => ({
  currentView: 'login',
  previousView: null,
  selectedPatient: null,
  selectedDocument: null,
  searchQuery: '',
  isLoading: false,
  scanTargetPatientId: null,
  doctorName: null,
  doctorEmail: null,
  doctorId: null,
  recentlyViewed: [],

  setCurrentView: (view) =>
    set((state) => ({ previousView: state.currentView, currentView: view })),
  goBack: () =>
    set((state) => ({
      currentView: state.previousView || 'dashboard',
      previousView: null,
    })),
  selectPatient: (patient) => {
    const updated = addToRecentlyViewed(patient)
    set({
      selectedPatient: patient,
      currentView: 'patient-detail',
      previousView: 'dashboard',
      recentlyViewed: updated,
    })
  },
  clearPatient: () => set({ selectedPatient: null }),
  updateSelectedPatient: (patient) => set({ selectedPatient: patient }),
  selectDocument: (doc) =>
    set({ selectedDocument: doc, currentView: 'document-viewer', previousView: 'patient-detail' }),
  clearDocument: () => set({ selectedDocument: null }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setScanTargetPatientId: (id) => set({ scanTargetPatientId: id }),
  setDoctorInfo: (name, email, id) => set({ doctorName: name, doctorEmail: email, doctorId: id }),
  initRecentlyViewed: () => {
    const stored = loadRecentlyViewed()
    set({ recentlyViewed: stored })
  },
  logout: () =>
    set({
      currentView: 'login',
      previousView: null,
      selectedPatient: null,
      selectedDocument: null,
      doctorName: null,
      doctorEmail: null,
      doctorId: null,
    }),
}))
