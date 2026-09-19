/**
 * Guided tour — the single source of truth for tour content (DIRECTIVE
 * FEATURE C). Every user-facing string the tour renders still lives here —
 * since the i18n rebase the module resolves them through the app's locale
 * catalog (`t()` from src/i18n) with `tour.*` keys, so the tour is fully
 * bilingual (English default + Arabic RTL) without scattering literals.
 * The English catalog values are the rendered-UI contract for the QA
 * harness needles (micro:tour-en).
 *
 * The step catalog spotlights REAL application elements resolved through
 * `data-qa` anchors (the same QA-anchor pattern as the document viewer —
 * see tests/pd23-view-scroll-reset.test.ts). Steps that live on a
 * data-dependent view (patient profile / document viewer) declare a
 * `fallbackTarget` + a `bodyFallback` catalog key used when no
 * patient/document exists yet (a fresh install), so the tour never
 * dead-ends.
 *
 * Structure: the static exports below (TOUR_SECTIONS / TOUR_STEPS) carry
 * ONLY structure + catalog keys — no English text. The localized hooks
 * (useTourStrings / useTourSections / useTourSteps) resolve the catalog
 * entries for the active locale and are what the components render.
 */
import { useMemo } from 'react'
import type { ViewType } from '@/store/app-store'
import { useI18n } from '@/i18n'

/** Tour sections — the jump targets offered by the header Help & Guide menu. */
export type TourSectionId =
  | 'getting-started'
  | 'patients'
  | 'documents'
  | 'clinical'
  | 'scheduling'
  | 'export-backup'
  | 'settings'

export interface TourSection {
  id: TourSectionId
  /** i18n catalog key of the menu label. */
  labelKey: string
  /** i18n catalog key of the menu description. */
  descriptionKey: string
}

/** A section with its label/description resolved for the active locale. */
export interface LocalizedTourSection extends TourSection {
  label: string
  description: string
}

export interface TourStep {
  id: string
  section: TourSectionId
  /** App view the spotlight target lives in. */
  view: ViewType
  /** data-qa anchor of the real element to spotlight. */
  target: string
  /** data-qa anchor used when the primary view is not reachable (no patient/document yet). */
  fallbackTarget?: string
  /** i18n catalog key of the step title. */
  titleKey: string
  /** i18n catalog key of the step body. */
  bodyKey: string
  /** Catalog key of the body shown together with the fallback target. */
  bodyFallbackKey?: string
}

/** A step with its title/body resolved for the active locale. */
export interface LocalizedTourStep extends TourStep {
  title: string
  body: string
  /** Body shown together with the fallback target (resolved). */
  bodyFallback?: string
}

/** Last-resort anchor — the dashboard patient list section. */
export const UNIVERSAL_FALLBACK_TARGET = 'dashboard-patient-list'

/** Sections in tour order — the Help menu lists them in this order. */
export const TOUR_SECTIONS: TourSection[] = [
  {
    id: 'getting-started',
    labelKey: 'tour.section.getting-started.label',
    descriptionKey: 'tour.section.getting-started.description',
  },
  {
    id: 'patients',
    labelKey: 'tour.section.patients.label',
    descriptionKey: 'tour.section.patients.description',
  },
  {
    id: 'documents',
    labelKey: 'tour.section.documents.label',
    descriptionKey: 'tour.section.documents.description',
  },
  {
    id: 'clinical',
    labelKey: 'tour.section.clinical.label',
    descriptionKey: 'tour.section.clinical.description',
  },
  {
    id: 'scheduling',
    labelKey: 'tour.section.scheduling.label',
    descriptionKey: 'tour.section.scheduling.description',
  },
  {
    id: 'export-backup',
    labelKey: 'tour.section.export-backup.label',
    descriptionKey: 'tour.section.export-backup.description',
  },
  {
    id: 'settings',
    labelKey: 'tour.section.settings.label',
    descriptionKey: 'tour.section.settings.description',
  },
]

/**
 * The ordered step catalog (20 steps). The tour engine walks it in order;
 * the Help menu can jump to the first step of any section. Titles/bodies
 * resolve through the catalog (tour.step.<id>.title/.body/.bodyFallback).
 */
export const TOUR_STEPS: TourStep[] = [
  // ── Getting started ────────────────────────────────────────────────
  {
    id: 'welcome',
    section: 'getting-started',
    view: 'dashboard',
    target: 'dashboard-welcome',
    titleKey: 'tour.step.welcome.title',
    bodyKey: 'tour.step.welcome.body',
  },
  {
    id: 'dashboard',
    section: 'getting-started',
    view: 'dashboard',
    target: 'dashboard-stats',
    titleKey: 'tour.step.dashboard.title',
    bodyKey: 'tour.step.dashboard.body',
  },
  // ── Patients & search ─────────────────────────────────────────────
  {
    id: 'add-patient',
    section: 'patients',
    view: 'dashboard',
    target: 'dashboard-add-patient',
    titleKey: 'tour.step.add-patient.title',
    bodyKey: 'tour.step.add-patient.body',
  },
  {
    id: 'search',
    section: 'patients',
    view: 'dashboard',
    target: 'dashboard-search-input',
    titleKey: 'tour.step.search.title',
    bodyKey: 'tour.step.search.body',
  },
  {
    id: 'patient-profile',
    section: 'patients',
    view: 'dashboard',
    target: 'dashboard-patient-list',
    titleKey: 'tour.step.patient-profile.title',
    bodyKey: 'tour.step.patient-profile.body',
  },
  {
    id: 'patient-profile-detail',
    section: 'patients',
    view: 'patient-detail',
    target: 'patient-detail-header',
    fallbackTarget: 'dashboard-patient-list',
    titleKey: 'tour.step.patient-profile-detail.title',
    bodyKey: 'tour.step.patient-profile-detail.body',
    bodyFallbackKey: 'tour.step.patient-profile-detail.bodyFallback',
  },
  // ── Documents & scanning ──────────────────────────────────────────
  {
    id: 'scan',
    section: 'documents',
    view: 'scan-capture',
    target: 'scan-capture-root',
    titleKey: 'tour.step.scan.title',
    bodyKey: 'tour.step.scan.body',
  },
  {
    id: 'upload-files',
    section: 'documents',
    view: 'patient-detail',
    target: 'patient-detail-upload',
    fallbackTarget: 'dashboard-patient-list',
    titleKey: 'tour.step.upload-files.title',
    bodyKey: 'tour.step.upload-files.body',
    bodyFallbackKey: 'tour.step.upload-files.bodyFallback',
  },
  {
    id: 'documents',
    section: 'documents',
    view: 'patient-detail',
    target: 'patient-detail-documents',
    fallbackTarget: 'dashboard-patient-list',
    titleKey: 'tour.step.documents.title',
    bodyKey: 'tour.step.documents.body',
    bodyFallbackKey: 'tour.step.documents.bodyFallback',
  },
  {
    id: 'viewer',
    section: 'documents',
    view: 'document-viewer',
    target: 'document-viewer',
    fallbackTarget: 'patient-detail-documents',
    titleKey: 'tour.step.viewer.title',
    bodyKey: 'tour.step.viewer.body',
    bodyFallbackKey: 'tour.step.viewer.bodyFallback',
  },
  {
    id: 'print',
    section: 'documents',
    view: 'document-viewer',
    target: 'viewer-print',
    fallbackTarget: 'patient-detail-documents',
    titleKey: 'tour.step.print.title',
    bodyKey: 'tour.step.print.body',
    bodyFallbackKey: 'tour.step.print.bodyFallback',
  },
  // ── Clinical records ──────────────────────────────────────────────
  {
    id: 'visits',
    section: 'clinical',
    view: 'patient-detail',
    target: 'patient-detail-visits',
    fallbackTarget: 'dashboard-patient-list',
    titleKey: 'tour.step.visits.title',
    bodyKey: 'tour.step.visits.body',
    bodyFallbackKey: 'tour.step.visits.bodyFallback',
  },
  {
    id: 'clinical-notes',
    section: 'clinical',
    view: 'patient-detail',
    target: 'patient-detail-clinical-notes',
    fallbackTarget: 'dashboard-patient-list',
    titleKey: 'tour.step.clinical-notes.title',
    bodyKey: 'tour.step.clinical-notes.body',
    bodyFallbackKey: 'tour.step.clinical-notes.bodyFallback',
  },
  {
    id: 'prescriptions',
    section: 'clinical',
    view: 'patient-detail',
    target: 'patient-detail-prescriptions',
    fallbackTarget: 'dashboard-patient-list',
    titleKey: 'tour.step.prescriptions.title',
    bodyKey: 'tour.step.prescriptions.body',
    bodyFallbackKey: 'tour.step.prescriptions.bodyFallback',
  },
  {
    id: 'reports',
    section: 'clinical',
    view: 'patient-detail',
    target: 'patient-detail-report',
    fallbackTarget: 'dashboard-patient-list',
    titleKey: 'tour.step.reports.title',
    bodyKey: 'tour.step.reports.body',
    bodyFallbackKey: 'tour.step.reports.bodyFallback',
  },
  // ── Scheduling ────────────────────────────────────────────────────
  {
    id: 'calendar',
    section: 'scheduling',
    view: 'dashboard',
    target: 'dashboard-calendar-toggle',
    titleKey: 'tour.step.calendar.title',
    bodyKey: 'tour.step.calendar.body',
  },
  // ── Export & backup ───────────────────────────────────────────────
  {
    id: 'export-csv',
    section: 'export-backup',
    view: 'dashboard',
    target: 'dashboard-export-csv',
    titleKey: 'tour.step.export-csv.title',
    bodyKey: 'tour.step.export-csv.body',
  },
  {
    id: 'backup',
    section: 'export-backup',
    view: 'settings',
    target: 'settings-backup',
    titleKey: 'tour.step.backup.title',
    bodyKey: 'tour.step.backup.body',
  },
  // ── Settings & help ───────────────────────────────────────────────
  {
    id: 'settings',
    section: 'settings',
    view: 'settings',
    target: 'settings-root',
    titleKey: 'tour.step.settings.title',
    bodyKey: 'tour.step.settings.body',
  },
  {
    id: 'finish',
    section: 'settings',
    view: 'dashboard',
    target: 'app-help-button',
    fallbackTarget: 'dashboard-welcome',
    titleKey: 'tour.step.finish.title',
    bodyKey: 'tour.step.finish.body',
  },
]

/** Index of the first step of a section (Help menu jump target). */
export function firstStepIndexForSection(section: TourSectionId): number {
  const index = TOUR_STEPS.findIndex((step) => step.section === section)
  return index >= 0 ? index : 0
}

/**
 * Tour chrome strings (controls, progress, completion, help menu) resolved
 * through the locale catalog. Same shape the engine/menu/mascot have always
 * consumed — they only switch from importing a static object to calling this
 * hook, so tour-content.ts stays the single strings module.
 */
export function useTourStrings() {
  const { t } = useI18n()
  return useMemo(
    () => ({
      mascotAriaLabel: t('tour.mascot.ariaLabel'),
      back: t('tour.controls.back'),
      next: t('tour.controls.next'),
      skip: t('tour.controls.skip'),
      finish: t('tour.controls.finish'),
      stepOf: (current: number, total: number): string => t('tour.progress', { current, total }),
      completeTitle: t('tour.complete.title'),
      completeDescription: t('tour.complete.description'),
      helpMenuTitle: t('header.helpGuide'),
      helpMenuSubtitle: t('tour.help.subtitle'),
      helpReplayTour: t('tour.help.replay'),
      helpSectionsTitle: t('tour.help.jumpTo'),
      helpShortcuts: t('shortcuts.title'),
    }),
    [t],
  )
}

/** Sections with localized label/description (menu rendering). */
export function useTourSections(): LocalizedTourSection[] {
  const { t } = useI18n()
  return useMemo(
    () =>
      TOUR_SECTIONS.map((section) => ({
        ...section,
        label: t(section.labelKey),
        description: t(section.descriptionKey),
      })),
    [t],
  )
}

/** Steps with localized title/body/bodyFallback (engine rendering). */
export function useTourSteps(): LocalizedTourStep[] {
  const { t } = useI18n()
  return useMemo(
    () =>
      TOUR_STEPS.map((step) => ({
        ...step,
        title: t(step.titleKey),
        body: t(step.bodyKey),
        ...(step.bodyFallbackKey ? { bodyFallback: t(step.bodyFallbackKey) } : {}),
      })),
    [t],
  )
}
