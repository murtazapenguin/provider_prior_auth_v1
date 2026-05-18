import type { HTMLAttributes } from 'react'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline'
}

export default function Badge({ variant = 'default', className = '', children, ...props }: BadgeProps) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
  const variants = {
    default: 'bg-muted text-muted-foreground',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
    outline: 'border border-border text-surface-foreground bg-transparent',
  }
  return (
    <span className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </span>
  )
}
