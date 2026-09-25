'use client';

import { useRef, useState, type DragEvent } from 'react';
import { Icon } from './icons';
import { EmptyNote, InlineError } from './ui';
import type { KbCategory, KnowledgeBaseSourceInfo } from '@/lib/retell';

function formatSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocRow({
  name,
  meta,
  pending = false,
  onRemove,
  removing = false,
}: {
  name: string;
  meta: string;
  pending?: boolean;
  onRemove?: () => void;
  removing?: boolean;
}) {
  return (
    <li className={'doc-row' + (pending ? ' pending' : '')}>
      <span className="doc-icon">
        <Icon name="file" size={17} />
      </span>
      <div className="doc-text">
        <b title={name}>{name}</b>
        <span>{meta}</span>
      </div>
      {onRemove && (
        <button className="icon-btn icon-btn-sm" title="Remove" aria-label={`Remove ${name}`} onClick={onRemove} disabled={removing}>
          {removing ? <span className="spinner" /> : <Icon name="x" size={15} />}
        </button>
      )}
    </li>
  );
}

interface UploadPanelProps {
  title: string;
  description: string;
  category: KbCategory;
  remoteDocs: KnowledgeBaseSourceInfo[];
  canEdit: boolean;
  /** Receives this category's full source list after an upload. */
  onUploaded: (sources: KnowledgeBaseSourceInfo[]) => void;
  onDeleted: (sourceId: string) => void;
}

export function UploadPanel({ title, description, category, remoteDocs, canEdit, onUploaded, onDeleted }: UploadPanelProps) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setPendingFiles((prev) => [...Array.from(files), ...prev]);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const removePending = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removeRemote = async (sourceId: string) => {
    setDeletingId(sourceId);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/knowledge-base?${new URLSearchParams({ category, source_id: sourceId })}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete from the knowledge base');
      onDeleted(sourceId);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete from the knowledge base');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSave = async () => {
    if (pendingFiles.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const form = new FormData();
      form.set('category', category);
      for (const file of pendingFiles) form.append('files', file);
      const res = await fetch('/api/knowledge-base', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to upload to the knowledge base');
      onUploaded(data.sources ?? []);
      setPendingFiles([]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to upload to the knowledge base');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="pill">
          {remoteDocs.length} {remoteDocs.length === 1 ? 'document' : 'documents'}
        </span>
      </header>

      {canEdit && (
        <div
          className={'dropzone' + (dragging ? ' drag' : '')}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <span className="dz-icon">
            <Icon name="upload" size={22} />
          </span>
          <div className="dz-text">
            <b>Drop files here, or browse</b>
            <span>PDF, DOCX, TXT, CSV, XLSX or images, up to 25 MB each</span>
          </div>
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
            Browse files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,image/*"
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {canEdit && pendingFiles.length > 0 && (
        <div className="pending-block">
          <div className="pending-head">
            <span>Ready to upload</span>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <span className="spinner" /> Uploading…
                </>
              ) : (
                <>
                  <Icon name="upload" size={15} /> Upload {pendingFiles.length} {pendingFiles.length === 1 ? 'file' : 'files'}
                </>
              )}
            </button>
          </div>
          <ul className="doc-list">
            {pendingFiles.map((file, i) => (
              <DocRow
                key={`pending-${file.name}-${i}`}
                name={file.name}
                meta={`${formatSize(file.size)} · Not uploaded yet`}
                pending
                onRemove={saving ? undefined : () => removePending(i)}
              />
            ))}
          </ul>
        </div>
      )}
      {canEdit && saveError && <InlineError>{saveError}</InlineError>}

      <div className="doc-section">
        <h4>In the knowledge base</h4>
        {remoteDocs.length === 0 ? (
          <EmptyNote>Nothing here yet.{canEdit ? ' Upload a document above to get started.' : ''}</EmptyNote>
        ) : (
          <ul className="doc-list">
            {remoteDocs.map((doc) => (
              <DocRow
                key={doc.sourceId}
                name={doc.displayName}
                meta={[formatSize(doc.fileSize), 'Live'].filter(Boolean).join(' · ')}
                onRemove={canEdit ? () => removeRemote(doc.sourceId) : undefined}
                removing={deletingId === doc.sourceId}
              />
            ))}
          </ul>
        )}
      </div>

      {canEdit && deleteError && <InlineError>{deleteError}</InlineError>}
    </section>
  );
}
