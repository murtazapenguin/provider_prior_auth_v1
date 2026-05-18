import type { HTMLAttributes } from 'react'

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  color?: 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'purple' | 'pink'
}

const COLORS = {
  green: 'bg-green-100 text-green-800',
  yellow: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-800',
  gray: 'bg-slate-100 text-slate-700',
  purple: 'bg-purple-100 text-purple-800',
  pink: 'bg-pink-100 text-pink-800',
}

export default function Pill({ color = 'gray', className = '', children, ...props }: PillProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${COLORS[color]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}
