import { Field } from '@/components/admin/field'
import type { GuestRow } from '@/lib/guest/resolve'
import type { MealOptionRow } from '@/lib/events/repository'

/**
 * One seat's worth of fields. `index` namespaces every input so the action can
 * reassemble the party from flat FormData without relying on DOM order.
 */
export function GuestCard({
  index, guest, mealOptions,
}: {
  index: number
  guest: Partial<GuestRow> | undefined
  mealOptions: MealOptionRow[]
}) {
  const name = (field: string) => `guests.${index}.${field}`

  return (
    <fieldset className="space-y-4 rounded border border-[var(--color-border)] p-4">
      <legend className="px-2 text-sm text-[var(--color-text-muted)]">
        {index === 0 ? 'You' : `Guest ${index + 1}`}
      </legend>

      <input type="hidden" name={name('id')} value={guest?.id ?? ''} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" name={name('firstName')} defaultValue={guest?.firstName ?? ''} required />
        <Field label="Last name" name={name('lastName')} defaultValue={guest?.lastName ?? ''} required />
        <Field label="Name on badge" name={name('badgeName')} defaultValue={guest?.badgeName ?? ''} />
        <Field label="Company" name={name('company')} defaultValue={guest?.company ?? ''} />
        <Field label="Job title" name={name('title')} defaultValue={guest?.title ?? ''} />
        <Field label="Email" name={name('email')} type="email" defaultValue={guest?.email ?? ''} />
        <Field label="Phone" name={name('phone')} defaultValue={guest?.phone ?? ''} />

        {mealOptions.length > 0 ? (
          <label className="block">
            <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Meal</span>
            <select
              name={name('mealOptionId')}
              defaultValue={guest?.mealOptionId ?? ''}
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
            >
              <option value="">No preference</option>
              {mealOptions.map((meal) => (
                <option key={meal.id} value={meal.id}>{meal.label}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <Field
        label="Dietary restrictions or allergies"
        name={name('dietary')}
        defaultValue={(guest?.dietary ?? []).join(', ')}
      />
      <Field
        label="Accessibility needs"
        name={name('accessibilityNeeds')}
        defaultValue={guest?.accessibilityNeeds ?? ''}
      />
    </fieldset>
  )
}
