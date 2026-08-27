import { LoaderCircle } from 'lucide-react'

interface LoadingIconProps {
  size?: number
  className?: string
}

export function LoadingIcon({ size = 16, className = '' }: LoadingIconProps) {
  return <LoaderCircle size={size} className={`animate-spin ${className}`.trim()} aria-hidden="true" />
}
