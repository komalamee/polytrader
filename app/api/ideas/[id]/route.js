import { NextResponse } from 'next/server';
import { getIdeaById, updateIdeaById } from '../../../../lib/ideas';

export const runtime = 'nodejs';

export async function GET(_req, { params }) {
  try {
    const idea = getIdeaById(params.id);
    if (!idea) {
      return NextResponse.json({ error: 'idea_not_found' }, { status: 404 });
    }
    return NextResponse.json({ idea });
  } catch (error) {
    return NextResponse.json(
      { error: 'failed_to_load_idea', detail: String(error.message || error) },
      { status: 500 }
    );
  }
}

export async function PATCH(req, { params }) {
  try {
    const payload = await req.json();
    const idea = updateIdeaById(params.id, payload || {});
    if (!idea) {
      return NextResponse.json({ error: 'idea_not_found' }, { status: 404 });
    }
    return NextResponse.json({ idea });
  } catch (error) {
    return NextResponse.json(
      { error: 'failed_to_update_idea', detail: String(error.message || error) },
      { status: 400 }
    );
  }
}
