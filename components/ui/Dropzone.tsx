'use client'

import { useRef, useState, type DragEvent, type ChangeEvent } from 'react'

interface DropzoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  disabled?: boolean
  hint?: string
  className?: string
}

export default function Dropzone({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  hint = 'PDF, DOCX, TXT, PNG, JPG up to 50MB',
  className = '',
}: DropzoneProps) {
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onFiles(files)
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length) onFiles(files)
    e.target.value = ''
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && ref.current?.click()}
      onKeyDown={(e) => e.key === 'Enter' && !disabled && ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${dragging ? 'border-primary bg-pink-50' : 'border-border hover:border-primary hover:bg-muted'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      <svg className="h-8 w-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
      <div>
        <p className="text-sm font-medium text-surface-foreground">
          Drop files here or <span className="text-primary">browse</span>
        </p>
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      </div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  )
}
