export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left">
            {headers.map((h) => (
              <Th key={h}>{h}</Th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2 font-medium text-[var(--color-text-muted)]">
      {children}
    </th>
  )
}

export function Td({ children }: { children: React.ReactNode }) {
  return <td className="border-b border-[var(--color-border)] px-3 py-2 align-middle">{children}</td>
}
