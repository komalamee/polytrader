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

async function parseJsonSafe(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function formatTelemetryLine({ ok, upstreamStatus, durationMs, detail }) {
  const ts = new Date().toISOString();
  const base = `${ts} | approve | upstream=${upstreamStatus} | duration_ms=${durationMs}`;
  if (ok) return `${base} | result=ok`;
  return `${base} | result=error | detail=${String(detail || '').slice(0, 400)}`;
}

export async function POST(req, { params }) {
  const startedAt = Date.now();
  const requestId = `approve_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  try {
    const idea = getIdeaById(params.id);
    if (!idea) {
      return NextResponse.json({ error: 'idea_not_found' }, { status: 404 });
    }

    const payloadIn = await parseJsonSafe(req);

    // If already submitted to Battlestation (via Assign to Researcher), skip re-submission
    if (idea.battlestation_id) {
      const existingNotes = String(idea.feedback_notes || '').trim();
      const inboundNotes = String(payloadIn?.feedback_notes || payloadIn?.feedback_note || '').trim();
      const durationMs = Date.now() - startedAt;
      const telemetryLine = formatTelemetryLine({ ok: true, upstreamStatus: 'skipped_existing', durationMs });
      const mergedNotes = [existingNotes, inboundNotes, telemetryLine].filter(Boolean).join('\n');

      const updated = updateIdeaById(params.id, {
        status: 'building',
        feedback_notes: mergedNotes
      });

      return NextResponse.json({
        ok: true,
        idea: updated,
        battlestation: { ok: true, skipped: true, existing_id: idea.battlestation_id },
        telemetry: {
          requestId,
          upstreamStatus: 'skipped_existing',
          durationMs,
          proposalId: idea.battlestation_id
        }
      });
    }

    const apiBase = process.env.BATTLESTATION_API_BASE || 'http://127.0.0.1:3333';
    const user = process.env.BATTLESTATION_BASIC_USER || process.env.MISSION_CONTROL_USER || '';
    const pass = process.env.BATTLESTATION_BASIC_PASS || process.env.MISSION_CONTROL_PASSWORD || '';

    const headers = {
      'Content-Type': 'application/json',
      'X-Ideas-Request-Id': requestId
    };
    if (user && pass) {
      headers.Authorization = `Basic ${encodeBasicAuth(user, pass)}`;
    }

    const response = await fetch(`${apiBase}/api/battlestation/incubator/propose`, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBattlestationPayload(idea))
    });

    const payload = await response.json().catch(() => ({}));
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      return NextResponse.json(
        {
          error: 'failed_to_push_battlestation',
          detail: payload?.error || `HTTP ${response.status}`,
          telemetry: {
            requestId,
            upstreamStatus: response.status,
            durationMs,
            logLine: formatTelemetryLine({
              ok: false,
              upstreamStatus: response.status,
              durationMs,
              detail: payload?.error || `HTTP ${response.status}`
            })
          }
        },
        { status: 502 }
      );
    }

    const proposalId = payload?.proposal?.id || payload?.proposalId || payload?.id || null;
    const existingNotes = String(idea.feedback_notes || '').trim();
    const inboundNotes = String(payloadIn?.feedback_notes || payloadIn?.feedback_note || '').trim();
    const telemetryLine = formatTelemetryLine({ ok: true, upstreamStatus: response.status, durationMs });
    const mergedNotes = [existingNotes, inboundNotes, telemetryLine].filter(Boolean).join('\n');

    const updated = updateIdeaById(params.id, {
      status: 'building',
      battlestation_id: proposalId,
      feedback_notes: mergedNotes
    });

    return NextResponse.json({
      ok: true,
      idea: updated,
      battlestation: payload,
      telemetry: {
        requestId,
        upstreamStatus: response.status,
        durationMs,
        proposalId
      }
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    return NextResponse.json(
      {
        error: 'approve_failed',
        detail: String(error.message || error),
        telemetry: {
          requestId,
          upstreamStatus: 'exception',
          durationMs,
          logLine: formatTelemetryLine({
            ok: false,
            upstreamStatus: 'exception',
            durationMs,
            detail: String(error.message || error)
          })
        }
      },
      { status: 500 }
    );
  }
}
