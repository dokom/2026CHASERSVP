export default function InviteNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <h1 className="font-serif text-3xl">We couldn&rsquo;t find that invitation</h1>
      <p className="mt-4 text-[var(--color-text-muted)]">
        The link may have expired or been replaced. Please contact the event organiser.
      </p>
    </main>
  )
}
