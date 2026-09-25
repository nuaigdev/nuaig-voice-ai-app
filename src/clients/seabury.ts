import type { ClientConfig } from './types';

export const seabury: ClientConfig = {
  id: 'seabury',
  name: 'Seabury',
  descriptor: 'Life Plan Community',
  logo: {
    light: '/clients/seabury/logo.png',
    dark: '/clients/seabury/logo-dark.png',
    width: 516,
    height: 302,
  },
  icon: '/clients/seabury/icon.png',
  contact: {
    website: 'https://seaburylife.org/',
    phone: '860-286-0243',
    address: '200 Seabury Drive, Bloomfield, CT 06002',
  },
  loginEmailHint: 'you@seaburylife.org',
  audience: 'residents',
  timezone: 'America/New_York',

  integrations: {
    retell: {
      toolCategories: {
        Food_Menu: 'meal',
        Grocery_events: 'grocery',
        Maintenance_request: 'service',
        Community_Info: 'community',
      },
    },
  },

  callCategories: {
    meal: { label: 'Dining & menu', tone: 'amber' },
    grocery: { label: 'Grocery & events', tone: 'emerald' },
    service: { label: 'Maintenance', tone: 'indigo' },
    community: { label: 'Community info', tone: 'brand' },
  },

  knowledgeBase: {
    categories: [
      {
        key: 'menu',
        label: "Today's Food Menu",
        uploadTitle: "Today's food menu",
        uploadDescription: 'PDF, DOCX, or image. The assistant reads it and offers these choices by voice.',
        icon: 'utensils',
      },
      {
        key: 'community',
        label: 'Community Info',
        uploadTitle: 'Community information',
        uploadDescription: 'Guidelines, hours, schedules: anything residents might ask the assistant about.',
        icon: 'building',
      },
      {
        key: 'events',
        label: 'Upcoming Events',
        uploadTitle: 'Upcoming events',
        uploadDescription: "This week's schedule of events and sessions.",
        icon: 'calendar',
      },
    ],
  },

  // Starting list for Call Routing. Left empty until the community supplies its real transfer numbers:
  // saving this list rewrites the live agent's transfer_call tool.
  departments: [],
};
