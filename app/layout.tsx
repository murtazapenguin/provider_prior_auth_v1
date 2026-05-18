import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Provider PA',
  description: 'Provider-side prior authorization workflow',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
