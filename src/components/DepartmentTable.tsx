'use client';

import { useRef } from 'react';
import { Icon } from './icons';
import type { Department } from '@/types';

export type DepartmentEdit = Pick<Department, 'name' | 'description' | 'phone'>;

interface DepartmentRowProps {
  department: Department;
  editable: boolean;
  onChange: (id: string, patch: Partial<DepartmentEdit>) => void;
  onRemove: (id: string) => void;
}

function DepartmentRow({ department, editable, onChange, onRemove }: DepartmentRowProps) {
  const reasonRef = useRef<HTMLInputElement>(null);

  return (
    <tr>
      <td>
        <input
          ref={reasonRef}
          value={department.description}
          onChange={(e) => onChange(department.id, { description: e.target.value })}
          placeholder="e.g. Medical emergency or safety concern"
          readOnly={!editable}
          disabled={!editable}
        />
      </td>
      <td>
        <input
          value={department.name}
          onChange={(e) => onChange(department.id, { name: e.target.value })}
          placeholder="e.g. Campus Safety"
          readOnly={!editable}
          disabled={!editable}
        />
      </td>
      <td>
        <input
          type="tel"
          value={department.phone}
          onChange={(e) => onChange(department.id, { phone: e.target.value })}
          placeholder="+1 (555) 000-0000"
          readOnly={!editable}
          disabled={!editable}
        />
      </td>
      {editable && (
        <td>
          <div className="dept-row-actions">
            <button type="button" onClick={() => reasonRef.current?.focus()} aria-label={`Edit row for ${department.name || 'this department'}`}>
              <Icon name="edit" size={14} strokeWidth={2} />
            </button>
            <button type="button" onClick={() => onRemove(department.id)} aria-label={`Remove row for ${department.name || 'this department'}`}>
              <Icon name="trash" size={14} strokeWidth={2} />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

interface DepartmentTableProps {
  departments: Department[];
  editable: boolean;
  onChange: (id: string, patch: Partial<DepartmentEdit>) => void;
  onRemove: (id: string) => void;
  onAddRow: () => void;
}

/** Row-based Call Routing editor: one row per "caller's reason -> destination -> phone" mapping. */
export function DepartmentTable({ departments, editable, onChange, onRemove, onAddRow }: DepartmentTableProps) {
  return (
    <div className="card card-flush dept-table-card">
      <table className="dept-table">
        <thead>
          <tr>
            <th>Caller&rsquo;s reason</th>
            <th>Routed to</th>
            <th>Phone number</th>
            {editable && <th aria-hidden="true" />}
          </tr>
        </thead>
        <tbody>
          {departments.length === 0 && (
            <tr>
              <td colSpan={editable ? 4 : 3} className="empty-note">
                {editable ? 'No rows yet. Add one below.' : 'No transfer departments are configured on the agent.'}
              </td>
            </tr>
          )}
          {departments.map((dept) => (
            <DepartmentRow key={dept.id} department={dept} editable={editable} onChange={onChange} onRemove={onRemove} />
          ))}
        </tbody>
      </table>
      {editable && (
        <button type="button" className="btn btn-ghost btn-sm dept-add-row" onClick={onAddRow}>
          <Icon name="plus" size={14} />
          Add row
        </button>
      )}
    </div>
  );
}
