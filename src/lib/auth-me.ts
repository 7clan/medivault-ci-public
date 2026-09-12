/**
 * Parse the `/api/auth/me` response into the doctor-info store shape.
 *
 * PRODUCT BUG FIX (PFT run 34701835070 first-red): the route returns
 * `{ user: { id, name, email, ... }, permissions }` — but both consumers
 * (login-form.tsx and page.tsx's checkSession) read the fields FLAT
 * (`meData.name` → undefined), so after an explicit login the header pill
 * fell back to the email prefix ("doctor.test") and after a session
 * restore the doctor identity was lost entirely. One shared, unit-tested
 * parser now normalizes the shape (with flat-response back-compat).
 */

export interface MeUser {
  id?: string | null
  name?: string | null
  email?: string | null
}

/** The `/api/auth/me` response body. */
export interface MeResponse {
  user?: MeUser
}

export interface DoctorInfo {
  name: string | null
  email: string | null
  id: string | null
}

/**
 * Normalize a `/api/auth/me` response (nested `user` object; a flat user
 * object is accepted for back-compat) into the doctor-info store shape.
 * `fallbackEmail` (e.g. the address just typed into the login form) is
 * used when the response carries no email.
 */
export function doctorInfoFromMeResponse(
  data: unknown,
  fallbackEmail?: string,
): DoctorInfo {
  const wrapped = data as MeResponse | null
  const me: MeUser | null =
    (wrapped && typeof wrapped === 'object' && wrapped.user) ||
    (data as MeUser | null) ||
    null
  const email = me?.email || fallbackEmail || null
  const name = me?.name || (email ? email.split('@')[0] : null)
  return {
    name: name ?? null,
    email,
    id: me?.id ?? null,
  }
}
