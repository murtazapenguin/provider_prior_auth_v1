'use client'

import { useState } from 'react'
import { Modal, Dropzone, Button } from '@/components/ui'
import { uploadAttachment, UploadError } from '@/lib/uploads/clientUpload'

interface UploadDropzoneProps {
  open: boolean
  onClose: () => void
  paId: string
  onComplete: () => void
}

export default function UploadDropzone({ open, onClose, paId, onComplete }: UploadDropzoneProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleFiles(files: File[]) {
    if (files[0]) {
      setSelectedFile(files[0])
      setError(null)
    }
  }

  async function handleUpload() {
    if (!selectedFile) return
    setUploading(true)
    setError(null)

    try {
      await uploadAttachment({ paId, file: selectedFile })
      setUploading(false)
      setSelectedFile(null)
      onComplete()
      onClose()
    } catch (err) {
      const message = err instanceof UploadError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Upload failed. Please try again.'
      setError(message)
      setUploading(false)
    }
  }

  function handleClose() {
    if (uploading) return
    setSelectedFile(null)
    setError(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Upload Supporting Document" size="md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Upload PT records, lab results, specialist notes, or any other documentation that supports
          this prior authorization request. The system will re-run evidence extraction across all
          criteria after upload.
        </p>

        <Dropzone
          onFiles={handleFiles}
          accept=".pdf,application/pdf"
          disabled={uploading}
          hint="PDF only · up to 10 MB"
        />

        {selectedFile && !uploading && (
          <div className="flex items-center gap-2 bg-muted rounded-lg p-3 text-sm">
            <svg
              className="h-4 w-4 text-muted-foreground shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="text-surface-foreground truncate flex-1">{selectedFile.name}</span>
            <button
              onClick={() => setSelectedFile(null)}
              className="text-muted-foreground hover:text-surface-foreground shrink-0"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}

        {error && (
          <p className="text-sm text-danger">{error}</p>
        )}

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={handleClose} disabled={uploading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleUpload}
            loading={uploading}
            disabled={!selectedFile || uploading}
          >
            {uploading ? 'Uploading & rechecking…' : 'Upload & recheck'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
