import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { CSRF_COOKIE } from '@/lib/auth/csrf'
import { getEvent } from '@/lib/events/repository'
import { CsrfInput } from '@/components/admin/csrf-input'
import { Field } from '@/components/admin/field'
import { Table, Td } from '@/components/admin/table'
import {
  saveEventAction, saveAgendaItemAction, deleteAgendaItemAction,
  saveMealOptionAction, toggleMealOptionAction,
} from './actions'
import { FloorplanEditor } from './floorplan-editor'

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` with no zone or seconds. */
function toLocalInput(value: Date | undefined): string {
  return value ? value.toISOString().slice(0, 16) : ''
}

export default async function EventPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requireRole('ADMIN')
  const { error } = await searchParams
  const event = await getEvent(prisma)

  // src/proxy.ts guarantees the CSRF cookie exists for every /admin
  // request before this Server Component renders, so this is a plain read.
  // Next.js forbids cookies().set() during render — writing here would 500
  // the page in production while every unit/integration test stays green.
  const store = await cookies()
  const csrf = store.get(CSRF_COOKIE)?.value
  if (!csrf) {
    throw new Error('CSRF cookie missing — check that src/proxy.ts matches this route')
  }

  return (
    <section className="space-y-10">
      <h1 className="font-serif text-2xl">Event</h1>

      {error ? (
        <p role="alert" className="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {!event ? (
        <p className="rounded border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
          No event configured yet. Fill this in first — the guest portal cannot render without it.
        </p>
      ) : null}

      <form action={saveEventAction} className="grid gap-4 sm:grid-cols-2">
        <CsrfInput />
        <Field label="Event name" name="name" defaultValue={event?.name ?? ''} required />
        <Field label="Tagline" name="tagline" defaultValue={event?.tagline ?? ''} />
        <Field label="Starts at" name="startsAt" type="datetime-local" defaultValue={toLocalInput(event?.startsAt)} required />
        <Field label="RSVP deadline" name="rsvpDeadline" type="datetime-local" defaultValue={toLocalInput(event?.rsvpDeadline)} required />
        <Field label="Timezone" name="timezone" defaultValue={event?.timezone ?? 'UTC'} />
        <Field label="Venue" name="venueName" defaultValue={event?.venueName ?? ''} required />
        <Field label="Address" name="address" defaultValue={event?.address ?? ''} required />
        <Field label="Dress code" name="dressCode" defaultValue={event?.dressCode ?? ''} />
        <button type="submit" className="self-end rounded bg-[var(--color-brass)] px-4 py-2 font-medium text-[var(--color-ink-deep)]">
          Save event
        </button>
      </form>

      {event ? (
        <>
          <div className="space-y-4">
            <h2 className="font-serif text-xl">Agenda</h2>
            <Table headers={['Time', 'Title', 'Order', '']}>
              {event.agendaItems.map((item) => (
                <tr key={item.id}>
                  <Td>{item.startsAt.toISOString().slice(11, 16)}</Td>
                  <Td>{item.title}</Td>
                  <Td>{item.sortOrder}</Td>
                  <Td>
                    <form action={deleteAgendaItemAction}>
                      <CsrfInput />
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" className="text-xs underline underline-offset-4">Remove</button>
                    </form>
                  </Td>
                </tr>
              ))}
            </Table>

            <form action={saveAgendaItemAction} className="grid gap-4 sm:grid-cols-4">
              <CsrfInput />
              <Field label="Title" name="title" required />
              <Field label="Starts at" name="startsAt" type="datetime-local" required />
              <Field label="Order" name="sortOrder" type="number" defaultValue="0" />
              <Field label="Description" name="description" />
              <button type="submit" className="self-end rounded border border-[var(--color-border)] px-4 py-2">
                Add agenda item
              </button>
            </form>
          </div>

          <div className="space-y-4">
            <h2 className="font-serif text-xl">Meal options</h2>
            <Table headers={['Label', 'Description', 'Status', '']}>
              {event.mealOptions.map((meal) => (
                <tr key={meal.id}>
                  <Td>{meal.label}</Td>
                  <Td>{meal.description ?? '—'}</Td>
                  <Td>{meal.isActive ? 'Offered' : 'Retired'}</Td>
                  <Td>
                    <form action={toggleMealOptionAction}>
                      <CsrfInput />
                      <input type="hidden" name="id" value={meal.id} />
                      <input type="hidden" name="isActive" value={meal.isActive ? 'false' : 'true'} />
                      <button type="submit" className="text-xs underline underline-offset-4">
                        {meal.isActive ? 'Retire' : 'Offer again'}
                      </button>
                    </form>
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="text-xs text-[var(--color-text-muted)]">
              Retiring a meal hides it from new responses. It is never deleted, because guests
              may already have chosen it.
            </p>

            <form action={saveMealOptionAction} className="grid gap-4 sm:grid-cols-4">
              <CsrfInput />
              <Field label="Label" name="label" required />
              <Field label="Description" name="description" />
              <Field label="Order" name="sortOrder" type="number" defaultValue="0" />
              <button type="submit" className="self-end rounded border border-[var(--color-border)] px-4 py-2">
                Add meal option
              </button>
            </form>
          </div>

          <FloorplanEditor
            floorplanAssetId={event.floorplanAssetId}
            markers={event.tableMarkers}
            csrf={csrf}
          />
        </>
      ) : null}
    </section>
  )
}
