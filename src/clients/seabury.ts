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
        uploadDescription: 'PDF, DOCX, or image. NuVA reads it and offers these choices by voice.',
        icon: 'utensils',
      },
      {
        key: 'community',
        label: 'Community Info',
        uploadTitle: 'Community information',
        uploadDescription: 'Guidelines, hours, schedules: anything residents might ask NuVA about.',
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

  departments: [
    {
      id: 'nursing',
      name: 'Nursing Staff',
      description: 'Medical, wellness & health-related calls',
      phone: '+1 (555) 019-2244',
      keywords: ['fall', 'chest pain', "can't breathe", 'medication', 'dizzy'],
      icon: 'pulse',
      tone: 'rose',
    },
    {
      id: 'admin',
      name: 'Admin Staff',
      description: 'Billing, leasing & account questions',
      phone: '+1 (555) 019-2255',
      keywords: ['billing', 'lease', 'move out', 'complaint', 'paperwork'],
      icon: 'briefcase',
      tone: 'amber',
    },
    {
      id: 'maintenance',
      name: 'Maintenance',
      description: 'Repairs & facility issues',
      phone: '+1 (555) 019-2266',
      keywords: ['leaking', 'broken', 'air conditioner', 'door lock', 'wifi'],
      icon: 'wrench',
      tone: 'indigo',
    },
    {
      id: 'dining',
      name: 'Dining Services',
      description: 'Menus, meal delivery & dietary needs',
      phone: '+1 (555) 019-2277',
      keywords: ['food allergy', 'special diet', 'meal delivery', 'kitchen'],
      icon: 'utensils',
      tone: 'emerald',
    },
    {
      id: 'frontdesk',
      name: 'Front Desk / Security',
      description: 'Visitors, packages & access issues',
      phone: '+1 (555) 019-2288',
      keywords: ['visitor', 'package', 'locked out', 'suspicious'],
      icon: 'shield',
      tone: 'brand',
    },
  ],
};
