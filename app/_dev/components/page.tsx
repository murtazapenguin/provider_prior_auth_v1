import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import StatusPill from '@/components/ui/StatusPill'
import Pill from '@/components/ui/Pill'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Spinner from '@/components/ui/Spinner'

// NoteHighlighter was deleted in Phase 6 / Session 7 T8 — its logic moved
// into DocumentPdfViewer's text-on-page fallback subcomponent. The
// component-gallery entry was removed alongside the source file. To exercise
// the text-on-page fallback, visit /_dev/pdfviewer (PDF branch) or open the
// EvidenceCheckModal from a PA detail page (fallback branch is exercised
// when a clinical note has no rendered pdfUrl).

const ALL_STATUSES = [
  'draft', 'pending_submission', 'ready_for_submission', 'voided', 'cancelled',
  'expired', 'pending', 'in_progress', 'rfi', 'approved', 'denied',
  'partial_approval', 'partial_denial', 'withdrawn',
] as const

export default function ComponentGallery() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-10">
      <h1 className="text-h1 font-bold text-surface-foreground">Component Gallery</h1>

      {/* Buttons */}
      <Card>
        <CardHeader><CardTitle>Button variants</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="primary" loading>Loading</Button>
          <Button variant="primary" disabled>Disabled</Button>
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="primary" size="lg">Large</Button>
        </CardContent>
      </Card>

      {/* Status Pills */}
      <Card>
        <CardHeader><CardTitle>StatusPill — all 14 statuses</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {ALL_STATUSES.map((s) => <StatusPill key={s} status={s} />)}
        </CardContent>
      </Card>

      {/* Badges */}
      <Card>
        <CardHeader><CardTitle>Badge variants</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="default">Default</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="outline">Outline</Badge>
        </CardContent>
      </Card>

      {/* Pills */}
      <Card>
        <CardHeader><CardTitle>Pill colors</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(['green','yellow','red','blue','gray','purple','pink'] as const).map((c) => (
            <Pill key={c} color={c}>{c}</Pill>
          ))}
        </CardContent>
      </Card>

      {/* Spinners */}
      <Card>
        <CardHeader><CardTitle>Spinner sizes</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-6">
          <Spinner size="sm" />
          <Spinner size="md" />
          <Spinner size="lg" />
        </CardContent>
      </Card>

      {/* Inputs */}
      <Card>
        <CardHeader><CardTitle>Input / Textarea</CardTitle></CardHeader>
        <CardContent className="space-y-4 max-w-sm">
          <Input label="Patient name" placeholder="Jordan Avery" />
          <Input label="With error" placeholder="Type here" error="This field is required" />
          <Input label="With hint" placeholder="CPT code" hint="Enter the procedure code" />
          <Textarea label="Clinical notes" placeholder="SOAP note..." rows={4} />
        </CardContent>
      </Card>

    </div>
  )
}
