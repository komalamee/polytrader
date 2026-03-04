import { NextResponse } from 'next/server';
import { getIdeaById, updateIdeaById } from '../../../../../lib/ideas';

export const runtime = 'nodejs';

function encodeBasicAuth(user, pass) {
  return Buffer.from(`${user}:${pass}`).toString('base64');
}

function buildBattlestationPayload(idea) {
  const painSignals = Array.isArray(idea.pain_signals) ? idea.pain_signals : [];
  const ideaText = [
    idea.title,
    idea.description || '',
    idea.edge_reason ? `Edge reason: ${idea.edge_reason}` : '',
    painSignals.length ? `Pain signals:\n- ${painSignals.join('\n- ')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    companyName: idea.title,
    idea: ideaText.length < 12 ? `${ideaText} — market opportunity` : ideaText,
    audience: idea.cycle_focus || 'general',
    problem: painSignals[0] || idea.title
  };
}

export async function POST(req, { params }) {
  try {
    const idea = getIdeaById(params.id);
    if (!idea) {
      return NextResponse.json({ error: 'idea_not_found' }, { status: 404 });
    }

    if (idea.battlestation_id) {
      return NextResponse.json({ ok: true, alreadyQueued: true, battlestation_id: idea.battlestation_id, idea });
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
        { error: 'battlestation_error', detail: payload?.error || `HTTP ${response.status}` },
        { status: 502 }
      );
    }

    const proposalId = payload?.proposal?.id || payload?.id || null;
    const researchTaskId = payload?.researchTaskId || null;

    const existingNotes = String(idea.feedback_notes || '').trim();
    const queueNote = `Research queued: ${new Date().toISOString()} | task=${researchTaskId}`;

    const updated = updateIdeaById(params.id, {
      battlestation_id: proposalId,
      status: 'interested',
      feedback_notes: [existingNotes, queueNote].filter(Boolean).join('\n')
    });

    return NextResponse.json({
      ok: true,
      idea: updated,
      battlestation: payload,
      battlestation_id: proposalId,
      research_task_id: researchTaskId
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'research_failed', detail: String(error.message || error) },
      { status: 500 }
    );
  }
}
