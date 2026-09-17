export interface RedactionFixture {
  name: string;
  input: string;
  mustNotContain: string[];
  expectSecrets: number;
  expectEmails: number;
  expectPhones: number;
  expectCards: number;
}

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFhcnlhbiJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

export const REDACTION_FIXTURES: readonly RedactionFixture[] = [
  {
    name: 'orbital token in an env-style file',
    input: 'ORBITAL_TOKEN=orb_live_9f3aQ7xLm2 ORBITAL_PROJECT=nova',
    mustNotContain: ['orb_live_9f3aQ7xLm2'],
    expectSecrets: 1,
    expectEmails: 0,
    expectPhones: 0,
    expectCards: 0,
  },
  {
    name: 'jwt inside a prompt',
    input: `Use this session: ${JWT} and continue.`,
    mustNotContain: [JWT, 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'],
    expectSecrets: 1,
    expectEmails: 0,
    expectPhones: 0,
    expectCards: 0,
  },
  {
    name: 'vendor api keys and a bearer header',
    input:
      'keys: sk-abcdefghijklmnopqrstuvwxyz1234 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234 AKIAIOSFODNN7EXAMPLE Authorization: Bearer abcdef0123456789abcdef',
    mustNotContain: [
      'sk-abcdefghijklmnopqrstuvwxyz1234',
      'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234',
      'AKIAIOSFODNN7EXAMPLE',
      'abcdef0123456789abcdef',
    ],
    expectSecrets: 4,
    expectEmails: 0,
    expectPhones: 0,
    expectCards: 0,
  },
  {
    name: 'connection string and assigned password',
    input: 'DATABASE_URL=postgres://app:hunter22@db.internal:5432/prod password: "correct horse"',
    mustNotContain: ['hunter22', 'db.internal', 'correct horse'],
    expectSecrets: 2,
    expectEmails: 0,
    expectPhones: 0,
    expectCards: 0,
  },
  {
    name: 'pem private key',
    input:
      'cert:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AH\n-----END RSA PRIVATE KEY-----\nend',
    mustNotContain: ['MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn'],
    expectSecrets: 1,
    expectEmails: 0,
    expectPhones: 0,
    expectCards: 0,
  },
  {
    name: 'email, phone and card in a support transcript',
    input:
      'Customer Aaryan.Sinha@Example.com called from +1 (415) 555-0134 and read card 4111 1111 1111 1111 over the phone.',
    mustNotContain: ['Aaryan.Sinha@Example.com', '555-0134', '4111 1111 1111 1111'],
    expectSecrets: 0,
    expectEmails: 1,
    expectPhones: 1,
    expectCards: 1,
  },
  {
    name: 'our own api key',
    input: 'curl -H "Authorization: Bearer dbf_h3IpUWyCzLgbT2aVdZ4wNq7kJfRxE9sMoY1uCgQtB0K" …',
    mustNotContain: ['dbf_h3IpUWyCzLgbT2aVdZ4wNq7kJfRxE9sMoY1uCgQtB0K'],
    expectSecrets: 1,
    expectEmails: 0,
    expectPhones: 0,
    expectCards: 0,
  },
  {
    name: 'plain text with numbers that are not secrets',
    input:
      'Deploy 2026-09-17 took 812 ms; retry 3 of 5; volume vol-prod-01 has 1 backup; ticket 123456789.',
    mustNotContain: [],
    expectSecrets: 0,
    expectEmails: 0,
    expectPhones: 0,
    expectCards: 0,
  },
];
