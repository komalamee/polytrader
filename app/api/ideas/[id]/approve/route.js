import { NextResponse } from 'next/server';
import { getIdeaById, updateIdeaById } from '../../../../../lib/ideas';

export const runtime = 'nodejs';

function encodeBasicAuth(user, pass) {
  return Buffer.from(`${user}:${pass}`).toString('base64');
}

function buildBattlestationPayload(idea) {
  const painSignals = Array.isArray(idea.pain_signals) ? idea.pain_signals : [];
  return {
    companyName: idea.title,
    idea: [
      idea.title,
      idea.description || '',
      idea.edge_reason ? `Edge reason: ${idea.edge_reason}` : '',
      painSignals.length ? `Pain signals:\n- ${painSignals.join('\n- ')}` : ''
    ]
      .filter(Boolean)
      .join('\n\n'),
    audience: idea.cycle_focus || '',
    problem: painSignals[0] || ''
  };
}

export async function POST(_req, { params }) {
  try {
    const idea = getIdeaById(params.id);
    if (!idea) {
      return NextResponse.json({ error: 'idea_not_found' }, { status: 404 });
    }

    const apiBase = process.env.BATTLESTATION_API_BASE || 'http://127.0.0.1:3333';
    const user = process.env.BATTLESTATION_BASIC_USER || process.env.MISSION_CONTROL_USER || '';
    const pass = process.env.BATTLESTATION_BASIC_PASS || process.env.MISSION_CONTROL_PASSWORD || '';

    const headers = { 'Content-Type': 'application/json' };
    if (user && pass) {
      headers.Authorization = `Basic ${encodeBasicAuth(user, pass)}`;
    }

    const response = await fetch(`${apiBase}/api/battlestation/incubator/propose`, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBattlestationPayload(idea))
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        {
          error: 'failed_to_push_battlestation',
          detail: payload?.error || `HTTP ${response.status}`
        },
        { status: 502 }
      );
    }

    const proposalId = payload?.proposal?.id || payload?.proposalId || payload?.id || null;
    const updated = updateIdeaById(params.id, {
      status: 'building',
      battlestation_id: proposalId
    });

    return NextResponse.json({
      ok: true,
      idea: updated,
      battlestation: payload
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'approve_failed', detail: String(error.message || error) },
      { status: 500 }
    );
  }
}
