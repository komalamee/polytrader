import { NextResponse } from 'next/server';
import { countIdeas, createIdea, listIdeas } from '../../../lib/ideas';

export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const sort = searchParams.get('sort') || 'created_at';
    const limit = Number(searchParams.get('limit') || 50);
    const offset = Number(searchParams.get('offset') || 0);
    const q = searchParams.get('q') || '';

    const ideas = listIdeas({ status, sort, limit, offset, q });
    const total = countIdeas({ status, q });

    return NextResponse.json({
      ideas,
      count: ideas.length,
      total,
      limit: Math.max(1, Math.min(200, Number(limit) || 50)),
      offset: Math.max(0, Number(offset) || 0)
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'failed_to_list_ideas', detail: String(error.message || error) },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const payload = await req.json();
    const idea = createIdea(payload || {});
    return NextResponse.json({ idea }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'failed_to_create_idea', detail: String(error.message || error) },
      { status: 400 }
    );
  }
}
