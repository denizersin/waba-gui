import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST handler to mark messages as read
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Verify user authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('Authentication error:', authError);
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // Parse request body
    const { otherUserId } = await request.json();

    if (!otherUserId) {
      return new NextResponse('Missing otherUserId parameter', { status: 400 });
    }

    console.log(`Marking messages as read for conversation: ${user.id} <-> ${otherUserId}`);

    // Call the database function to mark messages as read
    const { data, error } = await supabase.rpc('mark_messages_as_read', {
      user_id: user.id,
      other_user_id: otherUserId
    });

    if (error) {
      console.error('Error marking messages as read:', error);
      return new NextResponse(
        JSON.stringify({ error: 'Failed to mark messages as read', details: error.message }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Successfully marked ${data} messages as read`);

    return NextResponse.json({
      success: true,
      markedCount: data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in mark-read API:', error);
    return new NextResponse(
      JSON.stringify({ 
        error: 'Internal server error', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * GET handler for checking API status
 */
export async function GET() {
  return NextResponse.json({
    status: 'Mark Messages Read API',
    timestamp: new Date().toISOString()
  });
} 