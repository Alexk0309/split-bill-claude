import { type NextRequest, NextResponse } from 'next/server';

import { isSupportedMediaType } from '@/lib/ai/vision';
import { loadOwnerBill } from '@/lib/bill/load';
import { toBillInput } from '@/lib/bill/to-engine-input';
import { assessProof } from '@/lib/settlement/proof';
import { scanProof } from '@/lib/settlement/scan-proof';
import { computeSplit } from '@/lib/split';
import { throttleProofUpload } from '@/lib/ai/throttle';
import { createAdminClient, hasServiceRoleKey } from '@/lib/supabase/admin';

/**
 * Records a guest's transfer confirmation.
 *
 * The guest sends an image and nothing else. The amount, the reference and the
 * recipient are read here, on the server, and written with an authority the
 * guest does not have -- because a guest who could write their own amount could
 * mark themselves as paid, and a false "settled" is the worst bug this product
 * can have.
 *
 * A match settles the debt. Anything else is recorded as evidence and sent to
 * the payer to judge; it never rejects the guest outright, and it never accuses
 * them of anything.
 */

/** Backstop; the client downscales before sending. */
const MAX_IMAGE_BYTES = 3_500_000;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: shareToken } = await params;

  if (!hasServiceRoleKey()) {
    return NextResponse.json({
      ok: false,
      message:
        'Proof upload is not configured on this server. Ask the payer to mark you as paid instead.',
    });
  }

  let body: { claimToken?: unknown; imageBase64?: unknown; mediaType?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad('Bad request.');
  }

  const claimToken = typeof body.claimToken === 'string' ? body.claimToken : '';
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const mediaType = typeof body.mediaType === 'string' ? body.mediaType : 'image/jpeg';

  if (!claimToken || !imageBase64) return bad('Bad request.');
  if (!isSupportedMediaType(mediaType)) return bad('That image format is not supported.');
  // base64 inflates by about a third, so this is the byte size of the original.
  if (imageBase64.length * 0.75 > MAX_IMAGE_BYTES) {
    return bad('That screenshot is too large. Try again, or ask the payer to mark you as paid.');
  }

  // Row level security does not run for this client, so every lookup below is
  // scoped by hand and the two tokens are checked against each other.
  const admin = createAdminClient();

  const { data: bill } = await admin
    .from('bills')
    .select('id, owner_id')
    .eq('share_token', shareToken)
    .maybeSingle();
  if (!bill) return bad('This link does not work.', 404);
  const billId = bill.id as string;

  const { data: participant } = await admin
    .from('participants')
    .select('id, display_name')
    .eq('claim_token', claimToken)
    .eq('bill_id', billId)
    .maybeSingle();
  if (!participant) return bad('Open the link again and pick your name.', 403);
  const participantId = participant.id as string;

  // What they owe right now, from the same engine the guest is looking at.
  const bundle = await loadOwnerBill(admin, billId);
  if (!bundle) return bad('This bill is no longer available.', 404);

  let expectedSen: number;
  try {
    const split = computeSplit(toBillInput(bundle));
    const me = split.people.find((person) => person.personId === participantId);
    if (!me) return bad('Open the link again and pick your name.', 403);
    expectedSen = me.amountDueSen;
  } catch {
    return bad('This bill does not add up yet. Ask the payer to finish it first.');
  }

  // Checked before the vision call, so a flood costs nothing but a row count.
  const throttle = await throttleProofUpload(admin, participantId);
  if (!throttle.allowed) return NextResponse.json({ ok: false, message: throttle.message });

  const scanned = await scanProof(imageBase64, mediaType);
  if (!scanned.ok) {
    return NextResponse.json({ ok: false, message: scanned.message });
  }

  // References already used on this bill, so one screenshot cannot settle twice.
  const { data: priorProofs } = await admin
    .from('payment_proofs')
    .select('reference')
    .eq('bill_id', billId)
    .not('reference', 'is', null);

  // The payer's own number, so a transfer sent to somebody else is caught.
  const { data: payee } = await admin
    .from('profiles')
    .select('duitnow_mobile')
    .eq('id', bill.owner_id)
    .maybeSingle();

  const assessment = assessProof({
    parsed: scanned.proof,
    expectedSen,
    usedReferences: (priorProofs ?? []).map((row) => String(row.reference)),
    payeeMobile: (payee?.duitnow_mobile as string | null) ?? null,
  });

  await admin.from('payment_proofs').insert({
    bill_id: billId,
    participant_id: participantId,
    amount_sen: scanned.proof.amount_sen,
    reference: scanned.proof.reference,
    paid_at: scanned.proof.paid_at,
    recipient: scanned.proof.recipient,
    bank: scanned.proof.bank,
    confidence: scanned.proof.confidence,
    expected_sen: expectedSen,
    matched: assessment.matched,
    mismatch_reason: assessment.reason,
  });

  if (assessment.matched) {
    // The one place a guest's action settles a debt, and only because the
    // figures behind it were read here rather than sent by them.
    await admin
      .from('participants')
      .update({ settled_at: new Date().toISOString(), settled_method: 'duitnow' })
      .eq('id', participantId)
      .eq('bill_id', billId);
  }

  return NextResponse.json({
    ok: true,
    matched: assessment.matched,
    message: assessment.message,
    expectedSen,
    amountSen: scanned.proof.amount_sen,
  });
}
