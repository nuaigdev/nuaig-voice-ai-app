'use client';

import { useState } from 'react';
import { Icon } from './icons';
import { InlineError, toneVar } from './ui';
import type { Department } from '@/types';

interface DepartmentCardProps {
  department: Department;
  canEdit: boolean;
  onSave: (phone: string, keywords: string[]) => Promise<void>;
}

export function DepartmentCard({ department, canEdit, onSave }: DepartmentCardProps) {
  const [phone, setPhone] = useState(department.phone);
  const [keywords, setKeywords] = useState<string[]>(department.keywords);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const dirty = phone !== department.phone || keywords.join('\u0000') !== department.keywords.join('\u0000');

  const addKeyword = () => {
    const val = draft.trim();
    if (!val || keywords.includes(val)) {
      setDraft('');
      return;
    }
    setKeywords((prev) => [...prev, val]);
    setDraft('');
  };

  const removeKeyword = (kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  };

  const handleSave = async () => {
    setStatus('saving');
    setError(null);
    try {
      await onSave(phone, keywords);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1800);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to sync with the voice agent');
    }
  };

  return (
    <section className="card dept-card" style={{ '--tone': toneVar(department.tone) } as React.CSSProperties}>
      <header className="dept-head">
        <span className="dept-icon">
          <Icon name={department.icon} size={20} />
        </span>
        <div>
          <h3>{department.name}</h3>
          <p>{department.description}</p>
        </div>
      </header>

      <div className="field">
        <label htmlFor={`phone-${department.id}`}>Transfer phone number</label>
        <div className="input-icon">
          <Icon name="calls" size={15} />
          <input
            id={`phone-${department.id}`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            readOnly={!canEdit}
            disabled={!canEdit}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor={`kw-${department.id}`}>Trigger keywords</label>
        <div className="keyword-tags">
          {keywords.length === 0 && <span className="muted-note">No keywords yet</span>}
          {keywords.map((kw) => (
            <span className="kw" key={kw}>
              {kw}
              {canEdit && (
                <button onClick={() => removeKeyword(kw)} aria-label={`Remove keyword ${kw}`}>
                  <Icon name="x" size={12} strokeWidth={2.4} />
                </button>
              )}
            </span>
          ))}
        </div>
        {canEdit && (
          <div className="kw-input-row">
            <input
              id={`kw-${department.id}`}
              type="text"
              value={draft}
              placeholder="Add a keyword or phrase"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addKeyword();
                }
              }}
            />
            <button className="btn btn-secondary btn-sm" onClick={addKeyword} disabled={!draft.trim()}>
              Add
            </button>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="card-actions">
          {status === 'saved' && (
            <span className="saved-note">
              <Icon name="check" size={15} strokeWidth={2.4} /> Live on agent
            </span>
          )}
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={status === 'saving' || (!dirty && status !== 'error')}>
            {status === 'saving' ? (
              <>
                <span className="spinner" /> Syncing…
              </>
            ) : status === 'error' ? (
              'Retry'
            ) : (
              'Save changes'
            )}
          </button>
        </div>
      )}
      {canEdit && status === 'error' && error && <InlineError>{error}</InlineError>}
    </section>
  );
}
