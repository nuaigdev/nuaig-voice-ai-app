'use client';

import { ClientLogo, NuvaMark } from './brand';
import { Icon } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { Card, PageHeader } from './ui';
import { PRODUCT } from '@/config/product';
import type { SessionPayload } from '@/lib/auth';

interface AccountProps {
  onLogout: () => void;
  session: SessionPayload;
}

export function Account({ onLogout, session }: AccountProps) {
  const client = useClient();
  const isAdmin = session.role === 'admin';

  return (
    <div className="page page-narrow">
      <PageHeader eyebrow={`${client.name} · Account`} title="Your account" description="Your profile, access level, and this workspace." />

      <div className="grid grid-2">
        <Card title="Profile" subtitle="Accounts are managed by your administrator">
          <div className="field">
            <label>Email</label>
            <div className="input-icon">
              <Icon name="mail" size={15} />
              <input type="text" value={session.email} readOnly disabled />
            </div>
          </div>
          <div className="field">
            <label>Access level</label>
            <div className="role-row">
              <span className={`status ${isAdmin ? 'status-success' : 'status-muted'}`}>{isAdmin ? 'Administrator' : 'Viewer'}</span>
              <span className="muted-note">
                {isAdmin ? 'Can edit the knowledge base and call routing.' : 'Read-only access to analytics and call logs.'}
              </span>
            </div>
          </div>
          <div className="signout-row">
            <div>
              <b>Sign out of {PRODUCT.name}</b>
              <span>You&rsquo;ll need to sign in again to view the console.</span>
            </div>
            <button className="btn btn-danger" onClick={onLogout}>
              <Icon name="logout" size={16} />
              Sign out
            </button>
          </div>
        </Card>

        <Card title="Workspace" subtitle="The community this console serves">
          <div className="workspace">
            <ClientLogo height={56} />
            <div>
              <b>{client.name}</b>
              {client.descriptor && <span>{client.descriptor}</span>}
            </div>
          </div>
          <ul className="legend">
            {client.contact.address && (
              <li>
                <span>
                  <Icon name="mapPin" size={15} />
                  Address
                </span>
                <b>{client.contact.address}</b>
              </li>
            )}
            {client.contact.phone && (
              <li>
                <span>
                  <Icon name="calls" size={15} />
                  Main line
                </span>
                <b>{client.contact.phone}</b>
              </li>
            )}
          </ul>
          <div className="about-product">
            <NuvaMark size="sm" subtitle={PRODUCT.tagline} />
          </div>
          <p className="muted-note">
            Need help? Contact your community administrator.
          </p>
        </Card>
      </div>
    </div>
  );
}
