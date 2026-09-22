'use client';

import { NuaigLogo, NuvaMark } from './brand';
import { Icon } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { PRODUCT } from '@/config/product';

export function AppFooter() {
  const client = useClient();
  const { website, phone, address } = client.contact;
  const year = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div className="footer-accent" aria-hidden="true" />
      <div className="app-footer-inner">
        <div className="footer-product">
          <NuvaMark size="sm" />
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
          <a className="built-by" href={PRODUCT.vendor.url} target="_blank" rel="noreferrer" aria-label={`Built by ${PRODUCT.vendor.name}`}>
            <span>Built by</span>
            <NuaigLogo height={22} />
          </a>
          <span className="footer-copy">© {year} {PRODUCT.vendor.name}</span>
        </div>
      </div>
    </footer>
  );
}
