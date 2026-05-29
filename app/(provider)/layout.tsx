import type { ReactNode } from 'react'
import AppLayout from '@/components/app/AppLayout'

export default function ProviderLayout({ children }: { children: ReactNode }) {
  return <AppLayout>{children}</AppLayout>
}
