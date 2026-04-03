// ═══════════════════════════════════════════════
// RoofIgnite Command Center — Configuration
// ═══════════════════════════════════════════════
// Edit the values below when URLs or tokens change.
// The app will pick these up automatically on next page load.

const CONFIG = {
  // Google OAuth Client ID (for @roofignite.com login gate)
  // Get this from: https://console.cloud.google.com/apis/credentials → Create OAuth 2.0 Client ID
  GOOGLE_CLIENT_ID: '441152547871-18g0fpgbao19hi493csc1johtjvqe5ka.apps.googleusercontent.com',

  // Google Apps Script Web App URL (for write operations)
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyXDREtEeLeXggNxKVFcrQfMtLdK5YdXHfdfshOqlhUcOSWd66XDfMWAbaHIwAQAfT7/exec',

  // Google Sheet ID
  SHEET_ID: '1W560POSt6T4QsNObZGxz2BKyCNvRIW7dubAxhIVkAy4',

  // Pod sheet GIDs — these are fallback defaults.
  // On load, the dashboard fetches the live Pod Registry from Apps Script
  // and merges any new pods into this object automatically.
  SHEETS: {
    'Pod 2 - RoofIgnite': 0,
    'Pod 1 - RoofIgnite': 295240236
  },

  // Pod-to-lead-source mapping — populated dynamically from Pod Registry.
  // Fallback defaults used if registry isn't available yet.
  POD_LEAD_SOURCES: {
    'Pod 2 - RoofIgnite': { primary: 'ALL_ROOF', fallback: 'ALL_CiGN' },
    'Pod 1 - RoofIgnite': { primary: 'ALL_ROOF', fallback: 'ALL_CiGN' },
    'ContractorsIgnite':  { primary: 'ALL_CiGN', fallback: 'ALL_ROOF' }
  },

  // Lead sheet GIDs
  LEAD_SHEETS: {
    'ALL_ROOF': 1440123496,
    'ALL_CiGN': 951162408
  },

  // Meta API
  META_ACCESS_TOKEN: 'EAASdzH5TwEUBQRgZAhUKhIO1fHvuZCW9NA5ZBxJ2kxZAiRGDcKhY3FRQBwF53rzAtU4UADlTZCjZCvAKtAzdvPlDjeHZC5mrrmVe4RpSxcn1zJwDopKk7TaIz7ydeLYDFhXGgl8tB8Yd2HwZBaeVhU6DgOJt87xz0oHRA88lU6Ym9ZAhJVK4PK0P8VN4p2NsYLzS6kAZDZD',
  META_API_VERSION: 'v20.0',

  // Slack Defaults (channels managed via backend Script Properties)
  SLACK: {
    CHANNEL_B2C: 'C0AP0HTB951',  // #b2c-reports
    CHANNEL_B2B: 'C0AP6VAV18S',  // #b2b-reports
    APP_ID: 'A09CNAV4MCM',
    PERCENTAGE_INTERVALS: [0,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100],
  }
};
