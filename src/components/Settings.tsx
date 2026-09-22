'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { DepartmentCard } from './DepartmentCard';
import { Icon } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { ErrorState, InlineError, PageHeader, StateCard } from './ui';
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

function AddDepartmentForm({ onAdd, onCancel }: { onAdd: (name: string, phone: string, description: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onAdd(name.trim(), phone.trim(), description.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card dept-card dept-new" onSubmit={submit}>
      <header className="card-head">
        <div>
          <h3>New department</h3>
          <p>Add keywords after it&rsquo;s created.</p>
        </div>
      </header>
      <div className="field">
        <label htmlFor="new-dept-name">Name</label>
        <input id="new-dept-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Housekeeping" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="new-dept-desc">Description</label>
        <input id="new-dept-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this team handles" />
      </div>
      <div className="field">
        <label htmlFor="new-dept-phone">Transfer phone number</label>
        <input id="new-dept-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" required />
      </div>
      <div className="card-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? (
            <>
              <span className="spinner" /> Syncing…
            </>
          ) : (
            'Add & sync'
          )}
        </button>
      </div>
    </form>
  );
}

interface SettingsProps {
  canEdit: boolean;
}

/** Live departments, decorated with icon/tone from the client config when the name matches a configured one. */
function fromLive(live: DepartmentTransferInput[], seeds: Department[]): Department[] {
  return live.map((d, i) => {
    const seed = seeds.find((s) => s.name.trim().toLowerCase() === d.name.trim().toLowerCase());
    return {
      id: seed?.id ?? `live-${i}`,
      name: d.name,
      description: d.description ?? seed?.description ?? '',
      phone: d.phone,
      keywords: d.keywords,
      icon: seed?.icon ?? 'headset',
      tone: seed?.tone ?? 'slate',
    };
  });
}

function RoutingBanner({
  routing,
  canEdit,
  unlocked,
  onUnlock,
}: {
  routing: LiveRouting;
  canEdit: boolean;
  unlocked: boolean;
  onUnlock: () => void;
}) {
  if (routing.status === 'managed') return null;
  const missing = routing.status === 'missing';
  return (
    <div className="routing-banner" role="status">
      <Icon name="alert" size={18} />
      <div>
        <b>{missing ? 'Call transfers aren’t set up on the agent yet' : `This agent’s transfers were set up outside ${PRODUCT.name}`}</b>
        <p>
          {missing
            ? 'The departments below are a starting list and are not live. Check every number, then save to publish them.'
            : `${routing.summary ?? ''} Saving here will replace that setup with the departments below.`}
        </p>
      </div>
      {canEdit && !unlocked && (
        <button className="btn btn-secondary btn-sm" onClick={onUnlock}>
          {missing ? 'Review and publish' : 'Replace with this list'}
        </button>
      )}
    </div>
  );
}

export function Settings({ canEdit }: SettingsProps) {
  const client = useClient();
  const [routing, setRouting] = useState<LiveRouting | null>(null);
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Editing an agent whose routing wasn't written here needs an explicit opt-in, so a stray Save can't clobber it.
  const [unlocked, setUnlocked] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const fetchRouting = useCallback(() => {
    fetch('/api/departments')
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to read call routing from the voice agent');
        return body as LiveRouting;
      })
      .then((live) => {
        setRouting(live);
        setDepts(live.status === 'managed' ? fromLive(live.departments, client.departments) : client.departments);
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

  const editable = canEdit && (routing?.status === 'managed' || unlocked);

  const publish = async (nextDepts: Department[]) => {
    await syncDepartmentsToAgent(nextDepts);
    setRouting({ status: 'managed', departments: nextDepts, summary: null });
    setUnlocked(false);
  };

  const handleAddDepartment = async (name: string, phone: string, description: string) => {
    const newDept: Department = {
      id: `custom-${Date.now()}`,
      name,
      description: description || 'Custom department',
      phone,
      keywords: [],
      icon: 'headset',
      tone: 'slate',
    };
    const nextDepts = [...depts, newDept];
    setDepts(nextDepts);
    setAdding(false);
    setAddError(null);
    try {
      await publish(nextDepts);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to sync with the voice agent');
    }
  };

  const handleSaveDepartment = async (id: string, phone: string, keywords: string[]) => {
    const nextDepts = depts.map((d) => (d.id === id ? { ...d, phone, keywords } : d));
    setDepts(nextDepts);
    await publish(nextDepts);
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
        description={`${PRODUCT.name} transfers a caller to the right team based on what they need. Each department's number and trigger keywords go live on the agent when you save.`}
        actions={
          <>
            {livePill}
            {canEdit ? (
              editable &&
              !adding && (
                <button className="btn btn-primary" onClick={() => setAdding(true)}>
                  <Icon name="plus" size={16} />
                  Add department
                </button>
              )
            ) : (
              <span className="pill">
                <Icon name="lock" size={14} />
                View only
              </span>
            )}
          </>
        }
      />

      {loading && (
        <div className="dept-grid" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 300 }} />
          ))}
        </div>
      )}
      {!loading && loadError && <ErrorState message={loadError} onRetry={retry} />}

      {!loading && !loadError && routing && (
        <>
          <RoutingBanner routing={routing} canEdit={canEdit} unlocked={unlocked} onUnlock={() => setUnlocked(true)} />
          {addError && <InlineError>Added here, but syncing with the voice agent failed: {addError}</InlineError>}
          {depts.length === 0 && !adding && (
            <StateCard icon="route" title="No departments yet">
              {editable ? 'Add a department to start routing calls to staff.' : 'No transfer departments are configured on the agent.'}
            </StateCard>
          )}
          <div className="dept-grid">
            {editable && adding && <AddDepartmentForm onAdd={handleAddDepartment} onCancel={() => setAdding(false)} />}
            {depts.map((dept) => (
              <DepartmentCard
                key={dept.id}
                department={dept}
                canEdit={editable}
                onSave={(phone, keywords) => handleSaveDepartment(dept.id, phone, keywords)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
