import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// WhatsApp webhook verification token (set this in your environment variables)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'your-verify-token';

// TypeScript interfaces for webhook payload
interface WhatsAppContact {
  wa_id: string;
  profile?: {
    name: string;
  };
}

/**
 * GET handler for WhatsApp webhook verification
 * WhatsApp will call this endpoint to verify your webhook URL
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    // Verify the webhook
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified successfully');
      return new NextResponse(challenge, { status: 200 });
    } else {
      console.log('Webhook verification failed');
      return new NextResponse('Forbidden', { status: 403 });
    }
  } catch (error) {
    console.error('Error in webhook verification:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

/**
 * POST handler for incoming WhatsApp messages
 * WhatsApp will send message data to this endpoint
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();

    console.log('Received webhook payload:', JSON.stringify(body, null, 2));

    // Extract message data from WhatsApp webhook payload
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages || [];
    const contacts: WhatsAppContact[] = value?.contacts || [];
    
    // Process each incoming message
    for (const message of messages) {
      const phoneNumber = message.from;
      const messageText = message.text?.body || '';
      const messageTimestamp = new Date(parseInt(message.timestamp) * 1000).toISOString();

      // Find contact information
      const contact = contacts.find((c: WhatsAppContact) => c.wa_id === phoneNumber);
      const contactName = contact?.profile?.name || phoneNumber;

      console.log(`Processing message from ${contactName} (${phoneNumber}): ${messageText}`);

      // Check if user exists in our database
      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('id', phoneNumber)
        .single();

      // Create user if they don't exist
      if (!existingUser) {
        console.log(`Creating new user: ${contactName}`);
        const { error: userError } = await supabase
          .from('users')
          .insert([{
            id: phoneNumber,
            name: contactName,
            last_active: messageTimestamp
          }]);

        if (userError) {
          console.error('Error creating user:', userError);
          continue; // Skip this message if user creation fails
        }
      } else {
        // Update last_active timestamp for existing user
        const { error: updateError } = await supabase
          .from('users')
          .update({ last_active: messageTimestamp })
          .eq('id', phoneNumber);

        if (updateError) {
          console.error('Error updating user last_active:', updateError);
        }
      }

      // Find the receiver - this should be the authenticated user who owns the WhatsApp Business account
      // Option 1: Use a configured business owner ID from environment
      const businessOwnerId = process.env.WHATSAPP_BUSINESS_OWNER_ID;
      
      // Option 2: Find the first authenticated user (fallback)
      let receiverId = businessOwnerId;
      
      if (!receiverId) {
        // Try to find a user in the system (this is a fallback approach)
        const { data: users } = await supabase
          .from('users')
          .select('id')
          .neq('id', phoneNumber) // Don't select the sender
          .limit(1);
        
        if (users && users.length > 0) {
          receiverId = users[0].id;
        } else {
          // If no users found, we'll create a placeholder system user
          receiverId = 'whatsapp-business-account';
          
          // Ensure the system user exists
          const { error: systemUserError } = await supabase
            .from('users')
            .upsert([{
              id: receiverId,
              name: 'WhatsApp Business Account',
              last_active: messageTimestamp
            }], {
              onConflict: 'id'
            });

          if (systemUserError) {
            console.error('Error creating system user:', systemUserError);
          }
        }
      }

      console.log(`Message receiver identified as: ${receiverId}`);

      // Store the incoming message with proper receiver_id
      const { error: messageError } = await supabase
        .from('messages')
        .insert([{
          id: message.id, // Use WhatsApp message ID
          sender_id: phoneNumber,
          receiver_id: receiverId, // Now properly set to the business account owner
          content: messageText,
          timestamp: messageTimestamp,
          is_sent_by_me: false
        }]);

      if (messageError) {
        console.error('Error storing message:', messageError);
      } else {
        console.log(`Message stored successfully: ${message.id} (from: ${phoneNumber} to: ${receiverId})`);
      }
    }

    // Acknowledge receipt to WhatsApp
    return new NextResponse('OK', { status: 200 });

  } catch (error) {
    console.error('Error processing webhook:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
} 