import { NextResponse } from 'next/server';
import { getIdeaById } from '../../../../../lib/ideas';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const RESEARCH_BASE_PATHS = [
  '/home/kendra/.openclaw/hq/data/battlestation-research',
  '/home/kendra/.openclaw/workspace-researcher/data/battlestation-research'
];

async function readReportFile(battlestationId, filename) {
  for (const base of RESEARCH_BASE_PATHS) {
    const filePath = path.join(base, battlestationId, filename);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      if (content && content.trim()) return content;
    } catch {
      // try next path
    }
  }
  return null;
}

export async function GET(req, { params }) {
  try {
    const idea = getIdeaById(params.id);
    if (!idea) {
      return NextResponse.json({ error: 'idea_not_found' }, { status: 404 });
    }

    if (!idea.battlestation_id) {
      return NextResponse.json({
        status: 'no_research',
        message: 'No research has been triggered. Use "Assign to Researcher" to start market research.'
      });
    }

    const report = await readReportFile(idea.battlestation_id, 'full-report.md');

    if (!report) {
      return NextResponse.json({
        status: 'pending',
        battlestation_id: idea.battlestation_id,
        message: 'Research is in progress. Check back in a few minutes.'
      });
    }

    const scorecard = await readReportFile(idea.battlestation_id, 'scorecard.json')
      .then((s) => (s ? JSON.parse(s) : null))
      .catch(() => null);

    return NextResponse.json({
      status: 'ready',
      battlestation_id: idea.battlestation_id,
      report,
      scorecard
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'report_failed', detail: String(error.message || error) },
      { status: 500 }
    );
  }
}
