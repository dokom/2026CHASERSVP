'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { GUEST_CSRF_COOKIE, verifyCsrfToken } from '@/lib/auth/csrf'
import { rsvpSubmissionSchema } from '@/lib/validation/guest'
import { submitRsvp } from '@/lib/guest/rsvp'
import { getEvent } from '@/lib/events/repository'

export type RsvpFormState = {
  status: 'idle' | 'error' | 'done'
  message?: string
  attending?: boolean
}

const GENERIC_FAILURE =
  'We could not save your response. Please reload the page and try again.'

/** Rebuilds the party from flat `guests.<i>.<field>` keys. */
function collectGuests(formData: FormData): unknown[] {
  const indices = new Set<number>()
  for (const key of formData.keys()) {
    const match = /^guests\.(\d+)\./.exec(key)
    if (match) indices.add(Number(match[1]))
  }

  return [...indices].sort((a, b) => a - b).map((index) => {
    const read = (field: string) => String(formData.get(`guests.${index}.${field}`) ?? '')
    const dietary = read('dietary')
    return {
      id: read('id') || undefined,
      firstName: read('firstName'),
      lastName: read('lastName'),
      badgeName: read('badgeName'),
      company: read('company'),
      title: read('title'),
      email: read('email'),
      phone: read('phone'),
      mealOptionId: read('mealOptionId'),
      accessibilityNeeds: read('accessibilityNeeds'),
      dietary: dietary ? dietary.split(',').map((v) => v.trim()).filter(Boolean) : [],
    }
  })
}

export async function submitRsvpAction(
  _prev: RsvpFormState,
  formData: FormData,
): Promise<RsvpFormState> {
  // First, before reading anything else: this is an unauthenticated POST.
  const store = await cookies()
  if (!verifyCsrfToken(store.get(GUEST_CSRF_COOKIE)?.value, formData.get('csrf'))) {
    return { status: 'error', message: 'Your session expired. Reload the page and try again.' }
  }

  // The token comes from the form body, never the URL: a POST body is not
  // written to access logs the way a query string is, and submitRsvp
  // re-resolves it against the stored hash rather than trusting it blindly.
  const token = String(formData.get('token') ?? '')
  const attending = formData.get('attending') === 'yes'

  const parsed = rsvpSubmissionSchema.safeParse({
    attending,
    guests: attending ? collectGuests(formData) : [],
    extraSeatsRequested: formData.get('extraSeatsRequested') ?? 0,
    extraSeatsReason: formData.get('extraSeatsReason') ?? '',
  })
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Please check your answers.' }
  }

  // The deadline is authoritative from the database. A client-supplied one
  // would be forgeable by anyone with devtools.
  const event = await getEvent(prisma)
  if (!event) return { status: 'error', message: GENERIC_FAILURE }

  const result = await submitRsvp(prisma, token, parsed.data, new Date(), event.rsvpDeadline)

  if (!result.ok) {
    // NOT_FOUND and FOREIGN_GUEST deliberately share a message: distinguishing
    // them would confirm whether a token or guest id is real.
    const message =
      result.reason === 'CLOSED'
        ? 'RSVPs have closed. Please contact the organiser.'
        : result.reason === 'SEAT_LIMIT'
          ? 'That is more guests than your invitation allows.'
          : GENERIC_FAILURE
    return { status: 'error', message }
  }

  revalidatePath(`/i/${token}`)
  return { status: 'done', attending: parsed.data.attending }
}
