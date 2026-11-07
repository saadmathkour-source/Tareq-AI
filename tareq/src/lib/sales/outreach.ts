import { prisma } from '../core/db.ts';
import { think } from '../providers/router.ts';
import { authorize } from '../security/permissions.ts';
import { audit } from '../core/audit.ts';
import { ValidationError } from '../core/errors.ts';

/**
 * Outreach.
 *
 * Drafting is free; sending is gated. `send()` calls the permission engine for
 * the `outreach.send` action, which always requires an owner approval. The
 * content rules the directive sets are enforced here: no impersonation, no
 * unsubscribable bulk mail, and an opt-out line is mandatory.
 */

const BANNED_PATTERNS = [
  /i am (the )?(ceo|founder) of/i,
  /we already (worked|spoke) together/i,
  /as (discussed|agreed) (previously|earlier)/i,
];

export interface DraftInput {
  leadId: string;
  channel?: 'email' | 'message';
  offerName: string;
  valueSummary: string;
  evidenceIds?: string[];
}

/** Draft personalised outreach. Refuses if the lead opted out. */
export async function draft(input: DraftInput): Promise<string> {
  const lead = await prisma.lead.findUnique({ where: { id: input.leadId }, include: { buyer: true } });
  if (!lead) throw new ValidationError('Lead not found');
  if (lead.optedOut) throw new ValidationError('Lead has opted out — refusing to draft outreach');

  const buyerName = lead.buyer?.name ?? 'there';
  const org = lead.buyer?.organization ?? 'your team';

  let body: string;
  try {
    const res = await think({
      purpose: 'sales.outreach_draft',
      system:
        'Write a short, truthful, relevant B2B outreach message. No impersonation, no false claims, no fake prior relationship. End with a clear way to opt out.',
      messages: [
        {
          role: 'user',
          content: `Buyer: ${buyerName} at ${org}. Offer: ${input.offerName}. Value: ${input.valueSummary}. Write a 4-sentence message with a single clear next step.`,
        },
      ],
      maxTokens: 400,
    });
    body = res.content.trim();
  } catch {
    body = `Hello ${buyerName},\n\n${input.valueSummary}\n\nWould a short, paid pilot with clear acceptance criteria be useful?\n\nIf you would rather not hear from us again, reply "stop" and we will not contact you.\n`;
  }

  for (const p of BANNED_PATTERNS) {
    if (p.test(body)) throw new ValidationError('Draft contained a banned claim (impersonation / false prior relationship)');
  }
  if (!/stop|unsubscribe|إلغاء/i.test(body)) {
    body += '\n\nIf you would rather not hear from us again, reply "stop" and we will not contact you.';
  }

  const row = await prisma.outreachDraft.create({
    data: { leadId: input.leadId, channel: input.channel ?? 'email', subject: `A quick idea for ${org}`, body, status: 'DRAFT' },
  });
  return row.id;
}

/** Submit a draft for approval. Moves it to PENDING_APPROVAL and creates the approval. */
export async function submitForApproval(draftId: string): Promise<string> {
  const draftRow = await prisma.outreachDraft.findUnique({ where: { id: draftId } });
  if (!draftRow) throw new ValidationError('Draft not found');
  const approvalId = await authorize({
    action: 'outreach.send',
    actorType: 'agent',
    reason: `Send outreach draft ${draftId}`,
  }).then(() => null).catch(async (err) => {
    if (err.code === 'APPROVAL_REQUIRED') {
      const latest = await prisma.approval.findFirst({ where: { action: 'outreach.send', status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
      return latest?.id ?? null;
    }
    throw err;
  });
  await prisma.outreachDraft.update({ where: { id: draftId }, data: { status: 'PENDING_APPROVAL' } });
  return approvalId ?? '';
}

/**
 * Mark a draft as sent. Only an owner-approved draft may be marked sent, and
 * this method does not itself transmit anything — it records the transition
 * after an approved channel delivers it.
 */
export async function markSent(draftId: string, approvalId: string, actorId: string): Promise<void> {
  const approval = await prisma.approval.findUnique({ where: { id: approvalId } });
  if (!approval || approval.status !== 'APPROVED' || approval.action !== 'outreach.send') {
    throw new ValidationError('Sending requires an APPROVED outreach.send approval');
  }
  const draftRow = await prisma.outreachDraft.findUnique({ where: { id: draftId } });
  if (!draftRow) throw new ValidationError('Draft not found');
  await prisma.outreachDraft.update({
    where: { id: draftId },
    data: { status: 'SENT', sentAt: new Date(), approvedBy: actorId },
  });
  await prisma.lead.update({ where: { id: draftRow.leadId }, data: { status: 'CONTACTED' } });
  await audit({ actorType: 'owner', actorId, action: 'outreach.sent', target: draftId, severity: 'warn' });
}
