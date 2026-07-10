import { redirect } from 'next/navigation'

// FSD Phase 1 has no marketing landing (US-1.1: the entry is auth → the app).
// Send the root into the app; the (app) layout guard bounces unauthenticated
// users to /sign-in.
export default function Home() {
  redirect('/tables')
}
