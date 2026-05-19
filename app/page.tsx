import { redirect } from 'next/navigation'

/**
 * Root route. The middleware redirects unauthenticated visitors to /login;
 * authenticated visitors land here and we send them straight into the
 * queue (the provider workspace).
 */
export default function Home() {
  redirect('/queue')
}
