export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function calculateAge(dateOfBirth: string): number {
  const today = new Date()
  const birthDate = new Date(dateOfBirth)
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

export function formatAge(dateOfBirth: string): string {
  const age = calculateAge(dateOfBirth)
  return `${age} year${age !== 1 ? 's' : ''}`
}

export function getPatientDisplayName(patient: { firstName: string; lastName: string }): string {
  return `${patient.firstName} ${patient.lastName}`
}

export function getFileIcon(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'FileText'
  if (mimeType.startsWith('image/')) return 'Image'
  return 'File'
}

export function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    'General': 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    'Lab Results': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    'Prescription': 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    'X-Ray': 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
    'MRI/CT': 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    'Referral': 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
    'Insurance': 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
    'Identity': 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    'Consent Form': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  }
  return colors[category] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
}

export const DOCUMENT_CATEGORIES = [
  'General',
  'Lab Results',
  'Prescription',
  'X-Ray',
  'MRI/CT',
  'Referral',
  'Insurance',
  'Identity',
  'Consent Form',
]
