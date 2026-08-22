import Link from 'next/link'

export function Pagination(props: {
  page: number
  total: number
  pageSize: number
  buildHref: (page: number) => string
}) {
  const { page, total, pageSize, buildHref } = props
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  if (lastPage === 1) return null

  return (
    <nav aria-label="Pagination" className="flex items-center gap-3 text-sm">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className="underline underline-offset-4">Previous</Link>
      ) : null}
      <span className="text-[var(--color-text-muted)]">Page {page} of {lastPage}</span>
      {page < lastPage ? (
        <Link href={buildHref(page + 1)} className="underline underline-offset-4">Next</Link>
      ) : null}
    </nav>
  )
}
