// Product-level branding: NuVA, built by NuAIg. This is identical for every
// client deployment - anything that varies per community belongs in
// src/clients/<id>.ts instead.

export const PRODUCT = {
  name: 'NuVA',
  descriptor: 'Voice AI Console',
  tagline: 'The AI voice concierge for senior living',
  vendor: {
    name: 'NuAIg',
    tagline: 'Data, automation & AI, built for senior living',
    url: 'https://www.nuaig.ai/',
    email: 'info@nuaig.ai',
    logo: {
      light: '/brand/nuaig-logo.svg',
      dark: '/brand/nuaig-logo-white.svg',
      width: 362.5,
      height: 150,
    },
  },
} as const;
