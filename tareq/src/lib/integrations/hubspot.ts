import { hasSecret } from '../env.ts';

/**
 * HubSpot adapter (section 19) — contact upsert via a private-app token.
 *
 * Uses the CRM v3 API. Idempotent by email: upserting the same email updates the
 * existing contact instead of creating a duplicate. Without a token every method
 * reports `configured: false` and `upsertContact()` refuses rather than claiming
 * a write happened.
 */

export interface HubSpotStatus {
  configured: boolean;
  missing: string[];
}

export function status(): HubSpotStatus {
  return { configured: hasSecret('HUBSPOT_PRIVATE_APP_TOKEN'), missing: hasSecret('HUBSPOT_PRIVATE_APP_TOKEN') ? [] : ['HUBSPOT_PRIVATE_APP_TOKEN'] };
}

const BASE = 'https://api.hubapi.com';

export interface UpsertResult {
  ok: boolean;
  contactId?: string;
  created?: boolean;
  reason?: string;
}

export async function upsertContact(input: {
  email: string;
  firstname?: string;
  lastname?: string;
  company?: string;
}): Promise<UpsertResult> {
  if (!status().configured) {
    return { ok: false, reason: 'HubSpot not configured (missing: HUBSPOT_PRIVATE_APP_TOKEN)' };
  }
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
  const properties: Record<string, string> = { email: input.email };
  if (input.firstname) properties['firstname'] = input.firstname;
  if (input.lastname) properties['lastname'] = input.lastname;
  if (input.company) properties['company'] = input.company;

  const res = await fetch(`${BASE}/crm/v3/objects/contacts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ properties }),
  });
  if (res.status === 409) {
    // Already exists: look it up and update.
    const search = await fetch(`${BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: input.email }] }] }),
    });
    const found = (await search.json()) as { results?: Array<{ id: string }> };
    const id = found.results?.[0]?.id;
    if (!id) return { ok: false, reason: 'contact exists but could not be found' };
    await fetch(`${BASE}/crm/v3/objects/contacts/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ properties }),
    });
    return { ok: true, contactId: id, created: false };
  }
  const data = (await res.json()) as { id?: string; message?: string };
  if (!res.ok || !data.id) return { ok: false, reason: data.message ?? `HTTP ${res.status}` };
  return { ok: true, contactId: data.id, created: true };
}
