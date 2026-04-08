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
    console.log('[broadcast] Request body summary:', {
      hasMessage: !!message,
      templateName,
      hasTemplateData: !!templateData,
      hasVariables: !!variables,
      headerMediaId,
    });

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
      console.error('[broadcast] Group not found or unauthorized:', {
        groupId,
        userId: user.id,
        error: groupError?.message,
      });
      return NextResponse.json(
        { error: 'Group not found or unauthorized' },
        { status: 404 }
      );
    }
    console.log('[broadcast] Group found:', group.name);

    // Get all group members
    const { data: members, error: membersError } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId);

    if (membersError) {
      console.error('[broadcast] Error fetching members:', membersError);
      return NextResponse.json(
        { error: 'Failed to fetch group members', details: membersError.message },
        { status: 500 }
      );
    }

    if (!members || members.length === 0) {
      console.warn('[broadcast] Group has no members:', groupId);
      return NextResponse.json(
        { error: 'Group has no members' },
        { status: 400 }
      );
    }
    console.log(`[broadcast] Member count: ${members.length}`);

    // Get user settings for WhatsApp credentials
    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('access_token, phone_number_id, api_version')
      .eq('id', user.id)
      .single();

    if (!settings || !settings.access_token || !settings.phone_number_id) {
      console.error('[broadcast] WhatsApp credentials missing:', {
        settingsError: settingsError?.message,
        hasSettings: !!settings,
        hasToken: !!settings?.access_token,
        hasPhoneId: !!settings?.phone_number_id,
      });
      return NextResponse.json(
        { error: 'WhatsApp credentials not configured' },
        { status: 400 }
      );
    }

    const accessToken = settings.access_token;
    const phoneNumberId = settings.phone_number_id;
    const apiVersion = settings.api_version || 'v23.0';
    const whatsappApiUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    console.log('[broadcast] WhatsApp API URL:', whatsappApiUrl);

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    const timestamp = new Date().toISOString();

    // Helper function to replace variables in text
    const replaceVariables = (text: string, componentVariables: Record<string, string>) => {
      let result = text;
      Object.entries(componentVariables).forEach(([key, value]) => {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      });
      return result;
    };

    // Send message to each member individually
    for (const member of members) {
      try {
        let cleanPhoneNumber = member.user_id.replace(/\s+/g, '').replace(/[^\d]/g, '');
        // Remove leading 0 if it exists
        if (cleanPhoneNumber.startsWith('0')) {
          cleanPhoneNumber = cleanPhoneNumber.substring(1);
        }
        console.log(`[broadcast] Processing member: raw=${member.user_id} clean=${cleanPhoneNumber}`);
        let whatsappResponse;
        let messageContent = message;
        let messageMediaData = null;

        // 1. Check User Existence (Recipient) for both Template and Text flows
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('id')
          .eq('id', cleanPhoneNumber)
          .maybeSingle();

        if (userError) {
          console.error(`Error checking user ${cleanPhoneNumber}:`, userError);
          results.failed++;
          results.errors.push(`${member.user_id}: Database check failed`);
          continue; // Skip this user
        }

        if (!userData) {
          console.log(`User does not exist, inserting before broadcast: ${cleanPhoneNumber}`);
          const { error: userInsertError } = await supabase
            .from('users')
            .insert([{
              id: cleanPhoneNumber,
              name: cleanPhoneNumber,
              last_active: timestamp
            }]);

          if (userInsertError) {
            console.error(`Error inserting user ${cleanPhoneNumber}:`, userInsertError);
            results.failed++;
            results.errors.push(`${member.user_id}: Database insert failed`);
            continue;
          }
        }

        if (templateName && templateData) {
          // --- TEMPLATE FLOW ---
          // Build template components for WhatsApp API
          const templateComponents = [];

          // Header component: IMAGE (pre-uploaded mediaId) takes priority over TEXT variables
          if (headerMediaId) {
            console.log(`[broadcast] Using IMAGE header (mediaId: ${headerMediaId}) for ${cleanPhoneNumber}`);
            templateComponents.push({
              type: 'header',
              parameters: [{ type: 'image', image: { id: headerMediaId } }],
            });
          } else if (variables?.header && Object.keys(variables.header).length > 0) {
            const headerParams = Object.keys(variables.header)
              .sort((a, b) => parseInt(a) - parseInt(b))
              .map(key => ({ type: 'text', text: variables.header[key] }));
            console.log(`[broadcast] Using TEXT header params for ${cleanPhoneNumber}:`, headerParams);
            templateComponents.push({ type: 'header', parameters: headerParams });
          }

          // Body parameters
          if (variables?.body && Object.keys(variables.body).length > 0) {
            const bodyParams = Object.keys(variables.body)
              .sort((a, b) => parseInt(a) - parseInt(b))
              .map(key => ({ type: 'text', text: variables.body[key] }));
            templateComponents.push({ type: 'body', parameters: bodyParams });
          }

          // Footer parameters
          if (variables?.footer && Object.keys(variables.footer).length > 0) {
            const footerParams = Object.keys(variables.footer)
              .sort((a, b) => parseInt(a) - parseInt(b))
              .map(key => ({ type: 'text', text: variables.footer[key] }));
            templateComponents.push({ type: 'footer', parameters: footerParams });
          }

          // Send template message via WhatsApp API
          const templateMessage = {
            messaging_product: 'whatsapp',
            to: cleanPhoneNumber,
            type: 'template',
            template: {
              name: templateName,
              language: {
                code: templateData.language || 'en'
              },
              ...(templateComponents.length > 0 && { components: templateComponents })
            }
          };

          console.log(`[broadcast] Sending TEMPLATE to ${cleanPhoneNumber}:`, JSON.stringify(templateMessage, null, 2));
          whatsappResponse = await fetch(whatsappApiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(templateMessage),
          });
          console.log(`[broadcast] WhatsApp template response status for ${cleanPhoneNumber}: ${whatsappResponse.status}`);

          // Process template components for storage with variables replaced
          interface ProcessedComponent {
            format?: string;
            text?: string;
            media_url?: string | null;
          }

          interface ProcessedButton {
            type: string;
            text: string;
            url?: string;
            phone_number?: string;
          }

          const processedComponents = {
            header: null as ProcessedComponent | null,
            body: null as ProcessedComponent | null,
            footer: null as ProcessedComponent | null,
            buttons: [] as ProcessedButton[]
          };

          templateData.components?.forEach((component: { type: string; format?: string; text?: string; buttons?: ProcessedButton[] }) => {
            switch (component.type) {
              case 'HEADER':
                processedComponents.header = {
                  format: component.format || 'TEXT',
                  text: component.text && variables?.header ? replaceVariables(component.text, variables.header) : component.text,
                  media_url: null
                };
                break;
              case 'BODY':
                processedComponents.body = {
                  text: component.text && variables?.body ? replaceVariables(component.text, variables.body) : component.text
                };
                break;
              case 'FOOTER':
                processedComponents.footer = {
                  text: component.text && variables?.footer ? replaceVariables(component.text, variables.footer) : component.text
                };
                break;
              case 'BUTTONS':
                if (component.buttons) {
                  processedComponents.buttons = component.buttons.map((button) => ({
                    type: button.type,
                    text: button.text,
                    url: button.url,
                    phone_number: button.phone_number
                  }));
                }
                break;
            }
          });

          // Generate display content from body with variables replaced
          const bodyComponent = templateData.components?.find((c: { type: string }) => c.type === 'BODY');
          messageContent = bodyComponent?.text && variables?.body
            ? replaceVariables(bodyComponent.text, variables.body)
            : (message || `Template: ${templateName}`);

          // Store template info in media_data for display
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
            broadcast_group_id: groupId // Mark as broadcast message
          });

          // Handle Response for Template
          const templateRawBody = await whatsappResponse.text();
          console.log(`[broadcast] WhatsApp template raw response for ${cleanPhoneNumber}:`, templateRawBody.substring(0, 500));
          interface WAResponse { messages?: { id: string }[]; error?: { message?: string; code?: number } }
          let responseData: WAResponse;
          try {
            responseData = JSON.parse(templateRawBody) as WAResponse;
          } catch {
            console.error(`[broadcast] Non-JSON response from WhatsApp for ${cleanPhoneNumber}:`, templateRawBody.substring(0, 300));
            results.failed++;
            results.errors.push(`${member.user_id}: WhatsApp API returned non-JSON response (status ${whatsappResponse.status})`);
            continue;
          }

          if (whatsappResponse.ok) {
            results.success++;

            // Store the broadcast message in the database for this recipient
            const messageId = responseData.messages?.[0]?.id || `broadcast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // NOTE: Keeping original sender/receiver logic for templates as requested to only change text flow, 
            // but functionally it might be better to align both. For now, preserving original template logic behavior 
            // but moving it inside the block.
            // Original: sender_id = recipient, receiver_id = user. 
            // Wait, this logic is inverted compared to send-message. 
            // I will fix it for template too because it's definitely wrong for "sent by me".

            const messageObject = {
              id: messageId,
              sender_id: user.id, // FIXED: User is sending
              receiver_id: cleanPhoneNumber, // FIXED: Member is receiving
              content: messageContent,
              timestamp: timestamp,
              is_sent_by_me: true,
              is_read: true,
              message_type: 'template',
              media_data: messageMediaData
            };

            // Store in database
            const { error: dbError } = await supabase
              .from('messages')
              .insert([messageObject]);

            if (dbError) {
              console.error(`Error storing broadcast message for ${member.user_id}:`, dbError);
            } else {
              console.log(`Broadcast message stored for ${member.user_id}`);
            }
          } else {
            results.failed++;
            results.errors.push(`${member.user_id}: ${responseData.error?.message || 'Unknown error'}`);
            console.error(`WhatsApp API error for ${member.user_id}:`, responseData);
          }

        } else {
          // --- TEXT FLOW (NEW LOGIC MATCHING send-message/route.ts) ---

          // 2. Send Text Message via WhatsApp API
          const textMessage = {
            messaging_product: 'whatsapp',
            to: cleanPhoneNumber,
            type: 'text',
            text: {
              body: message
            }
          };

          console.log(`[broadcast] Sending TEXT to ${cleanPhoneNumber}:`, JSON.stringify(textMessage, null, 2));
          whatsappResponse = await fetch(whatsappApiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(textMessage),
          });
          console.log(`[broadcast] WhatsApp text response status for ${cleanPhoneNumber}: ${whatsappResponse.status}`);

          // 3. Handle Response & storage
          const textRawBody = await whatsappResponse.text();
          console.log(`[broadcast] WhatsApp text raw response for ${cleanPhoneNumber}:`, textRawBody.substring(0, 500));
          interface WAResponse { messages?: { id: string }[]; error?: { message?: string; code?: number } }
          let responseData: WAResponse;
          try {
            responseData = JSON.parse(textRawBody) as WAResponse;
          } catch {
            console.error(`[broadcast] Non-JSON response from WhatsApp for ${cleanPhoneNumber}:`, textRawBody.substring(0, 300));
            results.failed++;
            results.errors.push(`${member.user_id}: WhatsApp API returned non-JSON response (status ${whatsappResponse.status})`);
            continue;
          }

          if (whatsappResponse.ok) {
            results.success++;
            const messageId = responseData.messages?.[0]?.id;

            const messageObject = {
              id: messageId || `broadcast_text_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              sender_id: user.id, // Current authenticated user
              receiver_id: cleanPhoneNumber, // Recipient
              content: message,
              timestamp: timestamp,
              is_sent_by_me: true,
              is_read: true,
              message_type: 'text',
              media_data: JSON.stringify({
                broadcast_group_id: groupId
              })
            };

            // Update Users Last Active
            // Recipient
            await supabase.from('users')
              .update({ last_active: timestamp })
              .eq('id', cleanPhoneNumber);

            // Sender (User) - Optional but good practice as in send-message
            // (Assuming User ID is in Users table, send-message doesn't explicitly upsert User UUID except via cleanPhoneNumber check if sender was a phone number? 
            // In send-message log: "User inserted into the users table: cleanPhoneNumber" refers to recipient.
            // I'll stick to updating recipient.)

            // Store Message
            const { error: dbError } = await supabase
              .from('messages')
              .insert([messageObject]);

            if (dbError) {
              console.error(`Error storing broadcast message for ${member.user_id}:`, dbError);
            } else {
              console.log(`Broadcast logic: Message stored for ${member.user_id}`);
            }

          } else {
            results.failed++;
            results.errors.push(`${member.user_id}: ${responseData.error?.message || 'Unknown error'}`);
            console.error(`WhatsApp API error for ${member.user_id}:`, responseData);
          }
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`${member.user_id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.error(`[broadcast] Unhandled error for member ${member.user_id}:`, error);
      }
    }

    console.log(`[broadcast] Done. success=${results.success} failed=${results.failed} total=${members.length}`);
    if (results.errors.length > 0) {
      console.warn('[broadcast] Errors:', results.errors);
    }

    return NextResponse.json({
      success: true,
      message: `Broadcast sent to ${results.success}/${members.length} members`,
      results: {
        total: members.length,
        success: results.success,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined,
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

