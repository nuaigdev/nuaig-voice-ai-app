'use client';

import { Icon } from './icons';
import { useClient } from './providers/ClientConfigProvider';

export function AppFooter() {
  const client = useClient();
  const { website, phone, address } = client.contact;
  const year = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div className="footer-accent" aria-hidden="true" />
      <div className="app-footer-inner">
        <div className="footer-product">
          <span className="footer-for">
            Voice concierge for <b>{client.name}</b>
          </span>
        </div>

        <ul className="footer-contact">
          {address && (
            <li>
              <Icon name="mapPin" size={14} />
              {address}
            </li>
          )}
          {phone && (
            <li>
              <Icon name="calls" size={14} />
              <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a>
            </li>
          )}
          {website && (
            <li>
              <Icon name="globe" size={14} />
              <a href={website} target="_blank" rel="noreferrer">
                {new URL(website).hostname.replace(/^www\./, '')}
              </a>
            </li>
          )}
        </ul>

        <div className="footer-vendor">
          <span className="footer-copy">© {year} {client.name}</span>
        </div>
      </div>
    </footer>
  );
}
