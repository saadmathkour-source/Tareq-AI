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

/**
 * A HubSpot private-app token may be stored under the platform's legacy
 * HUBSPOT_ACCESS_TOKEN variable. Both must represent an owner-authorized
 * bearer token; mere presence is not proof the provider will accept it.
 */
function configuredToken(): string | null {
  if (hasSecret('HUBSPOT_PRIVATE_APP_TOKEN')) return process.env.HUBSPOT_PRIVATE_APP_TOKEN!.trim();
  if (hasSecret('HUBSPOT_ACCESS_TOKEN')) return process.env.HUBSPOT_ACCESS_TOKEN!.trim();
  return null;
}

export function status(): HubSpotStatus {
  return {
    configured: Boolean(configuredToken()),
    missing: configuredToken() ? [] : ['HUBSPOT_PRIVATE_APP_TOKEN or HUBSPOT_ACCESS_TOKEN'],
  };
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
  const token = configuredToken()!;
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

function token(): string {
  return configuredToken()!;
}

/** Read a contact by id. */
export async function getContact(id: string): Promise<{ ok: boolean; id?: string; properties?: Record<string, string>; reason?: string }> {
  if (!status().configured) return { ok: false, reason: 'HubSpot not configured' };
  const res = await fetch(`${BASE}/crm/v3/objects/contacts/${encodeURIComponent(id)}?properties=email,firstname,lastname`, {
    headers: { authorization: `Bearer ${token()}` },
  });
  const data = (await res.json()) as { id?: string; properties?: Record<string, string>; message?: string };
  if (!res.ok || !data.id) return { ok: false, reason: data.message ?? `HTTP ${res.status}` };
  return { ok: true, id: data.id, properties: data.properties };
}

/** Update specific contact properties. */
export async function updateContact(id: string, properties: Record<string, string>): Promise<{ ok: boolean; reason?: string }> {
  if (!status().configured) return { ok: false, reason: 'HubSpot not configured' };
  const res = await fetch(`${BASE}/crm/v3/objects/contacts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ properties }),
  });
  const data = (await res.json()) as { id?: string; message?: string };
  if (!res.ok || !data.id) return { ok: false, reason: data.message ?? `HTTP ${res.status}` };
  return { ok: true };
}

/** Find existing contacts by email. Empty array means no duplicate exists. */
export async function findContactByEmail(email: string): Promise<{ ok: boolean; ids: string[]; reason?: string }> {
  if (!status().configured) return { ok: false, ids: [], reason: 'HubSpot not configured' };
  const res = await fetch(`${BASE}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }] }),
  });
  const data = (await res.json()) as { results?: Array<{ id: string }>; message?: string };
  if (!res.ok) return { ok: false, ids: [], reason: data.message ?? `HTTP ${res.status}` };
  return { ok: true, ids: (data.results ?? []).map((r) => r.id) };
}

/** Create a company. */
export async function createCompany(name: string, domain?: string): Promise<{ ok: boolean; companyId?: string; reason?: string }> {
  if (!status().configured) return { ok: false, reason: 'HubSpot not configured' };
  const properties: Record<string, string> = { name };
  if (domain) properties['domain'] = domain;
  const res = await fetch(`${BASE}/crm/v3/objects/companies`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ properties }),
  });
  const data = (await res.json()) as { id?: string; message?: string };
  if (!res.ok || !data.id) return { ok: false, reason: data.message ?? `HTTP ${res.status}` };
  return { ok: true, companyId: data.id };
}

/** Associate a contact with a company (v4 association, default type). */
export async function associateContactToCompany(contactId: string, companyId: string): Promise<{ ok: boolean; reason?: string }> {
  if (!status().configured) return { ok: false, reason: 'HubSpot not configured' };
  const res = await fetch(
    `${BASE}/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/default/companies/${encodeURIComponent(companyId)}`,
    { method: 'PUT', headers: { authorization: `Bearer ${token()}` } },
  );
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  return { ok: true };
}

/** Create a deal and associate it with a contact. */
export async function createDeal(input: { name: string; amount?: number; stage?: string; contactId?: string }): Promise<{ ok: boolean; dealId?: string; reason?: string }> {
  if (!status().configured) return { ok: false, reason: 'HubSpot not configured' };
  const properties: Record<string, string> = { dealname: input.name };
  if (input.amount !== undefined) properties['amount'] = String(input.amount);
  if (input.stage) properties['dealstage'] = input.stage;
  const res = await fetch(`${BASE}/crm/v3/objects/deals`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ properties }),
  });
  const data = (await res.json()) as { id?: string; message?: string };
  if (!res.ok || !data.id) return { ok: false, reason: data.message ?? `HTTP ${res.status}` };
  if (input.contactId) {
    await fetch(
      `${BASE}/crm/v4/objects/deals/${encodeURIComponent(data.id)}/associations/default/contacts/${encodeURIComponent(input.contactId)}`,
      { method: 'PUT', headers: { authorization: `Bearer ${token()}` } },
    );
  }
  return { ok: true, dealId: data.id };
}

/** Delete a record of a given object type (used to clean up test data). */
export async function deleteObject(objectType: 'contacts' | 'companies' | 'deals', id: string): Promise<{ ok: boolean; reason?: string }> {
  if (!status().configured) return { ok: false, reason: 'HubSpot not configured' };
  const res = await fetch(`${BASE}/crm/v3/objects/${objectType}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token()}` },
  });
  if (!res.ok && res.status !== 204) return { ok: false, reason: `HTTP ${res.status}` };
  return { ok: true };
}
