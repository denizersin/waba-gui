import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST - Broadcast a message to all group members
 * Sends messages via WhatsApp and stores them in the database
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  console.log('[broadcast] POST called');
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('[broadcast] Auth failed:', authError?.message ?? 'no user session');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    console.log('[broadcast] Authenticated as user:', user.id);

    const { id: groupId } = await params;
    console.log('[broadcast] Group ID:', groupId);

    const body = await request.json();
    const { message, templateName = null, templateData = null, variables = null, headerMediaId = null } = body;
    
    // Validate input
    if (!message && !templateName) {
      return NextResponse.json(
        { error: 'Message or template name is required' },
        { status: 400 }
      );
    }

    // Verify group ownership and get group details
    const { data: group, error: groupError } = await supabase
      .from('chat_groups')
      .select('id, name, owner_id')
      .eq('id', groupId)
      .eq('owner_id', user.id)
      .single();

    if (groupError || !group) {
      return NextResponse.json(
        { error: 'Group not found or unauthorized' },
        { status: 404 }
      );
    }

    // Get all group members
    const { data: members, error: membersError } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId);

    if (membersError) {
      return NextResponse.json(
        { error: 'Failed to fetch group members', details: membersError.message },
        { status: 500 }
      );
    }

    if (!members || members.length === 0) {
      return NextResponse.json(
        { error: 'Group has no members' },
        { status: 400 }
      );
    }

    // Get user settings for WhatsApp credentials
    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('access_token, phone_number_id, api_version')
      .eq('id', user.id)
      .single();

    if (!settings || !settings.access_token || !settings.phone_number_id) {
      return NextResponse.json(
        { error: 'WhatsApp credentials not configured' },
        { status: 400 }
      );
    }

    const accessToken = settings.access_token;
    const phoneNumberId = settings.phone_number_id;
    const apiVersion = settings.api_version || 'v23.0';
    const whatsappApiUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    const timestamp = new Date().toISOString();

    // 1. Create Broadcast Job Database Entry
    const { data: job, error: jobDbError } = await supabase
      .from('broadcast_jobs')
      .insert([{
        group_id: groupId,
        created_by: user.id,
        total_messages: members.length,
        status: 'processing'
      }])
      .select('id')
      .single();

    if (jobDbError || !job) {
      console.error('[broadcast] Failed to create job record:', jobDbError);
      return NextResponse.json({ error: 'Failed to initialize broadcast job' }, { status: 500 });
    }

    const jobId = job.id;

    // 2. Start Background Task
    // Safe standard Supabase client for background tasks (avoids Request context termination)
    const { createClient: createSupClient } = require('@supabase/supabase-js');
    const backgroundSupabase = createSupClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    );

    // Detached promise logic
    (async () => {
      console.log(`[broadcast-bg] Job ${jobId} started for ${members.length} members`);
      let successCount = 0;
      let failedCount = 0;
      const jobErrors: string[] = [];

      const replaceVariables = (text: string, componentVariables: Record<string, string>) => {
        let result = text;
        Object.entries(componentVariables).forEach(([key, value]) => {
          result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        });
        return result;
      };

      for (const member of members) {
        try {
          let cleanPhoneNumber = member.user_id.replace(/\s+/g, '').replace(/[^\d]/g, '');
          if (cleanPhoneNumber.startsWith('0')) cleanPhoneNumber = cleanPhoneNumber.substring(1);
          
          let whatsappResponse;
          let messageContent = message;
          let messageMediaData = null;

          const { data: userData, error: userError } = await backgroundSupabase
            .from('users')
            .select('id')
            .eq('id', cleanPhoneNumber)
            .maybeSingle();

          if (userError) {
            failedCount++;
            jobErrors.push(`${member.user_id}: DB user check failed`);
            continue;
          }

          if (!userData) {
            const { error: userInsertError } = await backgroundSupabase
              .from('users')
              .insert([{ id: cleanPhoneNumber, name: cleanPhoneNumber, last_active: timestamp }]);
            if (userInsertError) {
              failedCount++;
              jobErrors.push(`${member.user_id}: DB insert failed`);
              continue;
            }
          }

          if (templateName && templateData) {
            const templateComponents = [];
            if (headerMediaId) {
              templateComponents.push({ type: 'header', parameters: [{ type: 'image', image: { id: headerMediaId } }] });
            } else if (variables?.header && Object.keys(variables.header).length > 0) {
              const headerParams = Object.keys(variables.header)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .map(key => ({ type: 'text', text: variables.header[key] }));
              templateComponents.push({ type: 'header', parameters: headerParams });
            }

            if (variables?.body && Object.keys(variables.body).length > 0) {
              const bodyParams = Object.keys(variables.body)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .map(key => ({ type: 'text', text: variables.body[key] }));
              templateComponents.push({ type: 'body', parameters: bodyParams });
            }

            if (variables?.footer && Object.keys(variables.footer).length > 0) {
              const footerParams = Object.keys(variables.footer)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .map(key => ({ type: 'text', text: variables.footer[key] }));
              templateComponents.push({ type: 'footer', parameters: footerParams });
            }

            const templateMessage = {
              messaging_product: 'whatsapp',
              to: cleanPhoneNumber,
              type: 'template',
              template: {
                name: templateName,
                language: { code: templateData.language || 'en' },
                ...(templateComponents.length > 0 && { components: templateComponents })
              }
            };

            whatsappResponse = await fetch(whatsappApiUrl, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(templateMessage),
            });

            const processedComponents = { header: null as any, body: null as any, footer: null as any, buttons: [] as any[] };
            templateData.components?.forEach((component: any) => {
              switch (component.type) {
                case 'HEADER':
                  processedComponents.header = { format: component.format || 'TEXT', text: component.text && variables?.header ? replaceVariables(component.text, variables.header) : component.text, media_url: null };
                  break;
                case 'BODY':
                  processedComponents.body = { text: component.text && variables?.body ? replaceVariables(component.text, variables.body) : component.text };
                  break;
                case 'FOOTER':
                  processedComponents.footer = { text: component.text && variables?.footer ? replaceVariables(component.text, variables.footer) : component.text };
                  break;
                case 'BUTTONS':
                  if (component.buttons) {
                    processedComponents.buttons = component.buttons.map((button: any) => ({ type: button.type, text: button.text, url: button.url, phone_number: button.phone_number }));
                  }
                  break;
              }
            });

            const bodyComponent = templateData.components?.find((c: any) => c.type === 'BODY');
            messageContent = bodyComponent?.text && variables?.body ? replaceVariables(bodyComponent.text, variables.body) : (message || `Template: ${templateName}`);
            
            messageMediaData = JSON.stringify({
              type: 'template',
              template_name: templateName,
              template_id: templateData.id,
              language: templateData.language,
              variables: variables,
              original_content: bodyComponent?.text || templateName,
              header: processedComponents.header,
              body: processedComponents.body,
              footer: processedComponents.footer,
              buttons: processedComponents.buttons,
              broadcast_group_id: groupId
            });

            const templateRawBody = await whatsappResponse.text();
            let responseData;
            try { responseData = JSON.parse(templateRawBody); } catch {
              failedCount++;
              jobErrors.push(`${member.user_id}: non-JSON response`);
              continue;
            }

            if (whatsappResponse.ok) {
              successCount++;
              const messageId = responseData.messages?.[0]?.id || `broadcast_${Date.now()}`;
              await backgroundSupabase.from('messages').insert([{
                id: messageId,
                sender_id: user.id,
                receiver_id: cleanPhoneNumber,
                content: messageContent,
                timestamp: timestamp,
                is_sent_by_me: true,
                is_read: true,
                message_type: 'template',
                media_data: messageMediaData
              }]);
            } else {
              failedCount++;
              jobErrors.push(`${member.user_id}: ${responseData.error?.message || 'Unknown CA'}`);
            }

          } else {
            // TEXT FLOW
            const textMessage = {
              messaging_product: 'whatsapp',
              to: cleanPhoneNumber,
              type: 'text',
              text: { body: message }
            };

            whatsappResponse = await fetch(whatsappApiUrl, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(textMessage),
            });

            const textRawBody = await whatsappResponse.text();
            let responseData;
            try { responseData = JSON.parse(textRawBody); } catch {
              failedCount++;
              jobErrors.push(`${member.user_id}: non-JSON response`);
              continue;
            }

            if (whatsappResponse.ok) {
              successCount++;
              const messageId = responseData.messages?.[0]?.id || `broadcast_text_${Date.now()}`;
              
              await backgroundSupabase.from('users').update({ last_active: timestamp }).eq('id', cleanPhoneNumber);
              await backgroundSupabase.from('messages').insert([{
                id: messageId,
                sender_id: user.id,
                receiver_id: cleanPhoneNumber,
                content: message,
                timestamp: timestamp,
                is_sent_by_me: true,
                is_read: true,
                message_type: 'text',
                media_data: JSON.stringify({ broadcast_group_id: groupId })
              }]);
            } else {
              failedCount++;
              jobErrors.push(`${member.user_id}: ${responseData.error?.message || 'Unknown error'}`);
            }
          }
        } catch (error) {
          failedCount++;
          jobErrors.push(`${member.user_id}: ${error instanceof Error ? error.message : 'Unknown'}`);
        }

        // Periodically update job status every 10 messages so UI can see progress
        if ((successCount + failedCount) % 10 === 0) {
          await backgroundSupabase.from('broadcast_jobs').update({
            success_count: successCount,
            failed_count: failedCount
          }).eq('id', jobId);
        }
      }

      // Final job update
      await backgroundSupabase.from('broadcast_jobs').update({
        status: 'completed',
        success_count: successCount,
        failed_count: failedCount,
        errors: jobErrors,
        updated_at: new Date().toISOString()
      }).eq('id', jobId);
      
      console.log(`[broadcast-bg] Job ${jobId} finished. Success: ${successCount}, Failed: ${failedCount}`);
    })().catch(err => {
      console.error(`[broadcast-bg] Fatal background loop error for job ${jobId}:`, err);
      // Try to mark as failed
      try {
        const { createClient: createSupClient } = require('@supabase/supabase-js');
        const bgSup = createSupClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || '',
          process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
        );
        bgSup.from('broadcast_jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', jobId);
      } catch (e) {}
    });

    // 3. Return immediately to the client
    return NextResponse.json({
      success: true,
      message: `Broadcast job started in background`,
      job_id: jobId,
      results: {
        total: members.length,
        success: 0,
        failed: 0
      },
    });

  } catch (error) {
    console.error('[broadcast] Fatal error in POST handler:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
