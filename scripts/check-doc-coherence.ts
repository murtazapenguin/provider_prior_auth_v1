// Phase 6 docs-writer gate 14 — status-code tripwire.
// Heuristic: flag backticked snake_case tokens (len 4-25) in *.md files that
// look like status codes but aren't in the canonical 14 from CLAUDE.md.
// False positives expected; skiplist below tunes the signal. No new deps.
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
const DIRS = ['', 'tasks', 'docs']
const CANONICAL = new Set([
  'draft', 'pending_submission', 'ready_for_submission', 'voided', 'cancelled',
  'expired', 'pending', 'in_progress', 'rfi', 'approved', 'denied',
  'partial_approval', 'partial_denial', 'withdrawn',
])
// Hardcoded skiplist: snake_case tokens that AREN'T status codes (column names,
// PaEvent.type values, env vars, file slugs, schema fields, common identifiers).
// Extend as new vocabulary lands — the heuristic is intentionally permissive and
// noisy by default; tightening the regex (require pending/denied/etc. substring)
// would shrink false positives at the cost of recall on real status-name typos.
const SKIP = new Set([
  'created_at', 'updated_at', 'evaluated_at', 'authored_at', 'submitted_at',
  'last_used_at', 'last_fetched_at', 'expires_at', 'published_at', 'revoked_at',
  'pending_submission_60d', 'patient_context', 'encounter_context', 'fhir_user',
  'session_token', 'access_token', 'refresh_token', 'id_token', 'grant_type',
  'token_type', 'auth_response', 'error_response', 'evidence_citation',
  'pdfviewer_data', 'extraction_result', 'bbox_format', 'pa_provider_id',
  'provider_id', 'patient_id', 'encounter_id', 'criterion_id', 'priority_changed',
  'status_change', 'pa_created', 'codes_updated', 'rfi_response',
  'criterion_evaluated', 'criterion_override', 'criteria_all_met',
  'document_triage_completed', 'document_triage_skipped', 'audit_note',
  'code_added', 'simulator_in_progress', 'simulator_rfi', 'simulator_approved',
  'simulator_denied', 'simulator_partial_approval', 'simulator_partial_denial',
  'provider_submit', 'provider_park', 'provider_resume', 'provider_void',
  'provider_cancel', 'provider_withdraw', 'patient_decline', 'rfi_responded',
  'sixty_day_timer', 'audit_event', 'start_timer', 'clear_timer', 'set_field',
  'needs_info', 'manual_override', 'all_valid', 'provider_upload', 'rfi_upload',
  'submission_packet', 'clinical_note', 'policy_pdf', 'fhir_mode', 'fhir_real',
  'policy_source', 'publish_status', 'publish_at', 'published_by', 'policy_version',
  'pa_session', 'pa_event', 'service_request', 'document_reference',
  'cached_document_reference', 'long_context', 'with_structured_output',
  'load_asset', 'register_prompt', 'sync_to_langfuse', 'create_model',
  'aws_textract_provider', 'faithfulness_detector', 'apply_transition',
  'record_event', 'compute_destination', 'redirect_after_auth',
  'compute_post_launch_destination', 'find_applicable_policies',
  'extract_evidence_for_criterion', 'derive_codes', 'generate_submission_packet',
  'ingest_documents', 'triage_documents', 'ingest_policy', 'policy_rescrape',
  'find_line_as_bbox', 'get_bounding_boxes_by_line', 'ocr_result_to_bbox_format',
  'on_premise', 'page_number', 'page_images', 'page_image', 'supporting_text',
  'supporting_texts', 'source_id', 'source_type', 'cited_documents', 'packet_data',
  'no_op', 'use_client', 'phase_6_compliance', 'phase_6_followups',
  'phase_6_epic_verification', 'phase_6_foundation', 'phase_6_integration',
  'phase_6_smart_launch', 'phase_6_fhir_resource_adapters',
  'phase_6_fhir_domain_mapping', 'phase_6_clinical_doc_pdf_pipeline',
  'phase_6_document_triage', 'phase_6_policy_driven_checklist',
  'phase_6_submission_packet_real_docs', 'phase_6_citation_viewer_pdf_only',
  'phase_6_launch_routing_ui', 'phase_6_quality_tester', 'phase_6_review_tracker',
  'phase_3_cover_letter', 'phase_4_mock_auth', 'phase_4_review_tracker',
  'phase_1_cms_ingest', 'phase_1_uhc_ingest',
  'criteria_split', 'cover_letter_v1', 'evidence_extraction_v1',
  'document_triage_v1', 'pa_workflow', 'jiggly_origami', 'phase_6_compliance',
  'pdf_url', 'note_id', 'note_type', 'doc_slug', 'doc_ref', 'doc_refs',
  'short_code', 'plan_name', 'member_id', 'pa_session_cookie', 'auth_code',
  'authorization_code', 'on_demand', 'no_rbac', 'phase_5_polish',
  'pre_screen', 'queue_browse', 'audit_timeline', 'park_resume',
  'tracker_watch', 'manual_override', 'document_upload', 'citation_jump',
  'submission_packet_review', 'rfi_respond', 'withdraw_cancel_void',
  'launch_ehr', 'launch_standalone', 'token_refresh', 'token_revocation',
  'fhir_rate_limit', 'fhir_data_sync', 'encounter_pa_create',
  'document_triage_cache_warm', 'encounter_context_switch',
  'policy_review', 'trigger_rescrape', 'criteria_accuracy_monitoring',
  'data_assets', 'output_guard', 'hallucination', 'penguin_tracer',
  'page_images_files', 'cron_tick', 'cron_sweep',
  // OCR / FHIR field names (Penguin SDK + canonical contracts vocabulary)
  'full_text', 'line_number', 'line_numbers', 'page_number', 'page_numbers',
  'bounding_box', 'citation_invalid', 'citation_valid',
  // DB table names
  'policy_drafts', 'ai_call_cache', 'coverage_code_mappings', 'lcd_policies',
  'ncd_policies', 'policy_type', 'policy_contractor_mappings',
  // Backend-kit + tracing tokens
  'request_id_ctx', 'trace_id_ctx', 'tracing_enabled', 'strip_page_dimensions',
  // Env / infra tokens
  'pg_isready', 'postgres_data', 'expires_in', 'client_id', 'client_secret',
  'redirect_uri', 'jwks_uri', 'dropdown_order', 'drop_order',
  // Project narrative tokens
  'provider_pa_hackathon', 'benefit_category', 'code_changed', 'not_required',
])
const TOKEN_RE = /`([a-z][a-z_]{3,24})`/g

const drift: string[] = []
for (const sub of DIRS) {
  const dir = path.join(ROOT, sub)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md') || f === 'CLAUDE.md') continue // canonical defining doc
    const fp = path.join(dir, f)
    const lines = fs.readFileSync(fp, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(TOKEN_RE)) {
        const tok = m[1]
        if (!tok.includes('_') && !['draft', 'pending', 'expired', 'voided',
          'cancelled', 'rfi', 'approved', 'denied', 'withdrawn'].includes(tok)) continue
        if (CANONICAL.has(tok) || SKIP.has(tok)) continue
        drift.push(`${fp}:${i + 1} -> "${tok}"`)
      }
    }
  }
}

if (drift.length) {
  console.error('Potential status-code drift (tokens not in canonical 14 and not skiplisted):')
  for (const d of drift) console.error('  ' + d)
  console.error(`Total: ${drift.length}`)
  process.exit(1)
}
console.log('check-doc-coherence: no status-code drift detected.')
