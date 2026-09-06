export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || ''
}

export function isValidPdfFile(file: File): boolean {
  const validTypes = ['application/pdf']
  if (validTypes.includes(file.type)) return true
  const ext = getFileExtension(file.name)
  return ext === 'pdf'
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

export function getDocumentCategory(filename: string): string {
  const name = filename.toLowerCase()
  if (name.includes('lab') || name.includes('blood') || name.includes('test')) return 'Lab Results'
  if (name.includes('xray') || name.includes('x-ray') || name.includes('imaging')) return 'Imaging'
  if (name.includes('prescription') || name.includes('rx')) return 'Prescription'
  if (name.includes('referral')) return 'Referral'
  if (name.includes('insurance') || name.includes('claim')) return 'Insurance'
  if (name.includes('consent')) return 'Consent Form'
  if (name.includes('note') || name.includes('visit') || name.includes('progress')) return 'Clinical Notes'
  return 'General'
}

export function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    'Lab Results': 'bg-amber-100 text-amber-800',
    'Imaging': 'bg-purple-100 text-purple-800',
    'Prescription': 'bg-teal-100 text-teal-800',
    'Referral': 'bg-orange-100 text-orange-800',
    'Insurance': 'bg-rose-100 text-rose-800',
    'Consent Form': 'bg-cyan-100 text-cyan-800',
    'Clinical Notes': 'bg-emerald-100 text-emerald-800',
    'General': 'bg-gray-100 text-gray-800',
  }
  return colors[category] || colors['General']
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date))
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date()
  const d = new Date(date)
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return formatDate(date)
}
