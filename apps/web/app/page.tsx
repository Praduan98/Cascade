'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from './session'

// The app root gates on auth so the app opens on the sign-in screen: signed-in
// users go to the dashboard, everyone else to sign-in. The marketing hero lives
// at /welcome.
export default function RootPage() {
  const router = useRouter()
  const { status } = useSession()

  useEffect(() => {
    if (status === 'authenticated') router.replace('/welcome')
    else if (status === 'unauthenticated') router.replace('/sign-in')
  }, [status, router])

  return null
}
