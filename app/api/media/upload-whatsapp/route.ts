import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * POST /api/media/upload-whatsapp
 * Uploads a single image to the WhatsApp Media API and returns its mediaId.
 * Used by broadcast flow to upload once, then reuse the same mediaId for all recipients.
 *
 * Body: multipart/form-data { file: File }
 * Response: { mediaId: string }
 */
export async function POST(request: NextRequest) {
  console.log('[upload-whatsapp] POST called');

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('[upload-whatsapp] Auth failed:', authError?.message ?? 'no user');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get WhatsApp credentials
    const serviceRole = await createServiceRoleClient();
    const { data: settings, error: settingsError } = await serviceRole
      .from('user_settings')
      .select('access_token, phone_number_id, api_version')
      .eq('id', user.id)
      .single();

    if (settingsError || !settings?.access_token || !settings?.phone_number_id) {
      console.error('[upload-whatsapp] Credentials missing:', settingsError?.message);
      return NextResponse.json({ error: 'WhatsApp credentials not configured' }, { status: 400 });
    }

    const { access_token: accessToken, phone_number_id: phoneNumberId, api_version } = settings;
    const apiVersion = (api_version as string) || 'v23.0';

    // Parse multipart body
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    console.log(`[upload-whatsapp] Uploading file: ${file.name} (${file.type}, ${file.size} bytes)`);

    // Upload to WhatsApp Media API
    const waFormData = new FormData();
    waFormData.append('file', file);
    waFormData.append('type', file.type);
    waFormData.append('messaging_product', 'whatsapp');

    const uploadResponse = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: waFormData,
      }
    );

    const rawBody = await uploadResponse.text();
    console.log(`[upload-whatsapp] WA response status: ${uploadResponse.status}`, rawBody.substring(0, 300));

    let result: { id?: string; error?: { message?: string } };
    try {
      result = JSON.parse(rawBody);
    } catch {
      console.error('[upload-whatsapp] Non-JSON response from WA:', rawBody.substring(0, 300));
      return NextResponse.json(
        { error: `WhatsApp API returned unexpected response (${uploadResponse.status})` },
        { status: 502 }
      );
    }

    if (!uploadResponse.ok || !result.id) {
      console.error('[upload-whatsapp] Upload failed:', result);
      return NextResponse.json(
        { error: result.error?.message || 'Failed to upload media to WhatsApp' },
        { status: uploadResponse.status }
      );
    }

    console.log('[upload-whatsapp] Media uploaded successfully, mediaId:', result.id);
    return NextResponse.json({ mediaId: result.id });

  } catch (error) {
    console.error('[upload-whatsapp] Fatal error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
