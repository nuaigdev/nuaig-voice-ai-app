'use client';

import { useCallback, useEffect, useState } from 'react';
import { UploadPanel } from './UploadPanel';
import { Icon } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { Card, ErrorState, PageHeader } from './ui';
import { PRODUCT } from '@/config/product';
import type { KnowledgeBaseSourceInfo } from '@/lib/retell';

interface KnowledgeBaseProps {
  canEdit: boolean;
}

export function KnowledgeBase({ canEdit }: KnowledgeBaseProps) {
  const client = useClient();
  const categories = client.knowledgeBase.categories;
  const [activeKey, setActiveKey] = useState(categories[0]?.key ?? '');
  const [sources, setSources] = useState<KnowledgeBaseSourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchSources = useCallback(() => {
    fetch('/api/knowledge-base')
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to load the knowledge base');
        return body.sources as KnowledgeBaseSourceInfo[];
      })
      .then(setSources)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load the knowledge base'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const retry = () => {
    setLoading(true);
    setLoadError(null);
    fetchSources();
  };

  const handleDeleted = (sourceId: string) => setSources((prev) => prev.filter((s) => s.sourceId !== sourceId));

  const active = categories.find((c) => c.key === activeKey) ?? categories[0];
  const otherDocs = sources.filter((s) => s.category === null);
  const countFor = (key: string) => sources.filter((s) => s.category === key).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow={`${client.name} · Agent knowledge`}
        title="Knowledge Base"
        description={`What ${PRODUCT.name} shares with ${client.audience} by voice. Keep it current so answers stay accurate.`}
        actions={
          !canEdit && (
            <span className="pill">
              <Icon name="lock" size={14} />
              View only
            </span>
          )
        }
      />

      <div className="tabs" role="tablist" aria-label="Knowledge base sections">
        {categories.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={active?.key === c.key}
            className={'tab' + (active?.key === c.key ? ' active' : '')}
            onClick={() => setActiveKey(c.key)}
          >
            <Icon name={c.icon} size={17} />
            {c.label}
            {!loading && !loadError && <span className="tab-count">{countFor(c.key)}</span>}
          </button>
        ))}
      </div>

      {loading && (
        <div className="grid grid-2-1">
          <div className="skel" style={{ height: 360 }} />
          <div className="skel" style={{ height: 240 }} />
        </div>
      )}
      {!loading && loadError && <ErrorState message={loadError} onRetry={retry} what="the knowledge base" />}

      {!loading && !loadError && active && (
        <div className="grid grid-2-1">
          <UploadPanel
            key={active.key}
            title={active.uploadTitle}
            description={active.uploadDescription}
            category={active.key}
            remoteDocs={sources.filter((s) => s.category === active.key)}
            otherDocs={otherDocs}
            canEdit={canEdit}
            onUploaded={setSources}
            onDeleted={handleDeleted}
          />
          <aside className="stack">
            <Card title="Library" subtitle="Documents the agent can draw on">
              <ul className="legend">
                {categories.map((c) => (
                  <li key={c.key}>
                    <span>
                      <Icon name={c.icon} size={15} />
                      {c.label}
                    </span>
                    <b>{countFor(c.key)}</b>
                  </li>
                ))}
                {otherDocs.length > 0 && (
                  <li>
                    <span>
                      <Icon name="file" size={15} />
                      Other documents
                    </span>
                    <b>{otherDocs.length}</b>
                  </li>
                )}
              </ul>
            </Card>
            <div className="tip-card">
              <Icon name="sparkle" size={18} />
              <div>
                <b>How this works</b>
                <p>
                  Uploads go straight to {PRODUCT.name}&rsquo;s knowledge base. New documents usually take a minute to index before the
                  agent can quote them on calls.
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
