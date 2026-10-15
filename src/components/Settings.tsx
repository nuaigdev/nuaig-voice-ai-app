'use client';

import { useCallback, useEffect, useState } from 'react';
import { DepartmentTable, type DepartmentEdit } from './DepartmentTable';
import { Icon } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { ErrorState, InlineError, PageHeader } from './ui';
import { PRODUCT } from '@/config/product';
import type { DepartmentTransferInput, LiveRouting } from '@/lib/retell';
import type { Department } from '@/types';

async function syncDepartmentsToAgent(list: Department[]): Promise<void> {
  const res = await fetch('/api/departments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      departments: list.map((d) => ({
        name: d.name,
        phone: d.phone,
        description: d.description,
        keywords: d.keywords,
      })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to sync with the voice agent');
}

function newRow(): Department {
  return {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    description: '',
    phone: '',
    keywords: [],
    icon: 'headset',
    tone: 'slate',
  };
}

interface SettingsProps {
  canEdit: boolean;
}

/** Live departments, decorated with icon/tone from the client config when a configured row matches. */
function fromLive(live: DepartmentTransferInput[], seeds: Department[]): Department[] {
  const norm = (v: string | undefined) => (v ?? '').trim().toLowerCase();
  return live.map((d, i) => {
    // Rows can share a name (one person, several reasons to call), so narrow by description before
    // falling back to the first same-name seed. The id stays unique per row whatever matched: it is
    // the React key and the handle updateRow/removeRow edit by, and it never goes to Retell.
    const sameName = seeds.filter((s) => norm(s.name) === norm(d.name));
    const seed = sameName.find((s) => norm(s.description) === norm(d.description)) ?? sameName[0];
    return {
      id: `${seed?.id ?? 'live'}-${i}`,
      name: d.name,
      description: d.description ?? seed?.description ?? '',
      phone: d.phone,
      keywords: d.keywords,
      icon: seed?.icon ?? 'headset',
      tone: seed?.tone ?? 'slate',
    };
  });
}

export function Settings({ canEdit }: SettingsProps) {
  const client = useClient();
  const [routing, setRouting] = useState<LiveRouting | null>(null);
  const [depts, setDepts] = useState<Department[]>([]);
  const [savedDepts, setSavedDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchRouting = useCallback(() => {
    fetch('/api/departments')
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to read call routing from the voice agent');
        return body as LiveRouting;
      })
      .then((live) => {
        setRouting(live);
        const initial = live.status === 'managed' ? fromLive(live.departments, client.departments) : client.departments;
        setDepts(initial);
        setSavedDepts(initial);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to read call routing'))
      .finally(() => setLoading(false));
  }, [client.departments]);

  useEffect(() => {
    fetchRouting();
  }, [fetchRouting]);

  const retry = () => {
    setLoading(true);
    setLoadError(null);
    fetchRouting();
  };

  const editable = canEdit;
  const dirty = JSON.stringify(depts) !== JSON.stringify(savedDepts);

  const updateRow = (id: string, patch: Partial<DepartmentEdit>) => {
    setDepts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    setSaveStatus('idle');
  };

  const addRow = () => setDepts((prev) => [...prev, newRow()]);

  const removeRow = (id: string) => {
    setDepts((prev) => prev.filter((d) => d.id !== id));
    setSaveStatus('idle');
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    setSaveError(null);
    // A row needs both a destination and a phone number to go live; blanks are kept in the editor but left out of the agent prompt.
    const ready = depts.filter((d) => d.name.trim() && d.phone.trim());
    try {
      await syncDepartmentsToAgent(ready);
      setRouting({ status: 'managed', departments: ready, summary: null });
      setSavedDepts(depts);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1800);
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : 'Failed to sync with the voice agent');
    }
  };

  const livePill =
    routing?.status === 'managed' ? (
      <span className="pill pill-live">
        <span className="sync-dot" aria-hidden="true" />
        Live on agent
      </span>
    ) : routing ? (
      <span className="pill">Not live</span>
    ) : null;

  return (
    <div className="page">
      <PageHeader
        eyebrow={`${client.name} · Agent configuration`}
        title="Call Routing"
        description={`${PRODUCT.name} transfers a caller to the right person based on what they need. Each row's destination and phone number go live on the agent when you save.`}
        actions={
          <>
            {livePill}
            {!canEdit && (
              <span className="pill">
                <Icon name="lock" size={14} />
                View only
              </span>
            )}
          </>
        }
      />

      {loading && (
        <div className="card card-flush dept-table-card skel" style={{ height: 420 }} aria-busy="true" />
      )}
      {!loading && loadError && <ErrorState message={loadError} onRetry={retry} />}

      {!loading && !loadError && routing && (
        <>
          <DepartmentTable departments={depts} editable={editable} onChange={updateRow} onRemove={removeRow} onAddRow={addRow} />

          {editable && (
            <div className="dept-save-bar">
              {saveStatus === 'saved' && (
                <span className="saved-note">
                  <Icon name="check" size={15} strokeWidth={2.4} /> Live on agent
                </span>
              )}
              {saveStatus === 'error' && saveError && <InlineError>{saveError}</InlineError>}
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saveStatus === 'saving' || (!dirty && saveStatus !== 'error')}
              >
                {saveStatus === 'saving' ? (
                  <>
                    <span className="spinner" /> Syncing…
                  </>
                ) : (
                  'Save changes'
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
