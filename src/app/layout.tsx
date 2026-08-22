import type { Metadata } from 'next'
import { Bodoni_Moda, Instrument_Sans } from 'next/font/google'
import './globals.css'

/**
 * Bodoni Moda is a didone — the face engraved invitations are actually set in.
 * Its optical-size axis is what keeps the hairlines from shimmering at small
 * sizes on a phone; loading it as a variable font keeps that axis available.
 */
const display = Bodoni_Moda({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-display',
  display: 'swap',
})

const body = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Gala RSVP',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  )
}
