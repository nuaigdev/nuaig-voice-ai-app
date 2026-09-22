'use client';

import { useState, type FormEvent } from 'react';
import { DepartmentCard } from './DepartmentCard';
import { Icon } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { InlineError, PageHeader } from './ui';
import { PRODUCT } from '@/config/product';
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

export function Settings({ canEdit }: SettingsProps) {
  const client = useClient();
  const [depts, setDepts] = useState<Department[]>(client.departments);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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
      await syncDepartmentsToAgent(nextDepts);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to sync with the voice agent');
    }
  };

  const handleSaveDepartment = async (id: string, phone: string, keywords: string[]) => {
    const nextDepts = depts.map((d) => (d.id === id ? { ...d, phone, keywords } : d));
    setDepts(nextDepts);
    await syncDepartmentsToAgent(nextDepts);
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow={`${client.name} · Agent configuration`}
        title="Call Routing"
        description={`${PRODUCT.name} transfers a caller to the right team based on what they need. Each department's number and trigger keywords go live on the agent when you save.`}
        actions={
          canEdit ? (
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
          )
        }
      />

      {addError && <InlineError>Added here, but syncing with the voice agent failed: {addError}</InlineError>}

      <div className="dept-grid">
        {canEdit && adding && <AddDepartmentForm onAdd={handleAddDepartment} onCancel={() => setAdding(false)} />}
        {depts.map((dept) => (
          <DepartmentCard
            key={dept.id}
            department={dept}
            canEdit={canEdit}
            onSave={(phone, keywords) => handleSaveDepartment(dept.id, phone, keywords)}
          />
        ))}
      </div>
    </div>
  );
}
