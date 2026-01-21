import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { env } from 'process';

interface TemplateComponent {
    type: string;
    format?: string;
    text?: string;
    example?: {
        body_text?: string[][];
        header_text?: string[];
    };
    buttons?: Array<{
        type: string;
        text: string;
        phone_number?: string;
        url?: string;
    }>;
}

interface TemplateData {
    id: string;
    name: string;
    status?: string;
    category?: string;
    language: string;
    components: TemplateComponent[];
    formatted_components?: {
        header?: TemplateComponent;
        body?: TemplateComponent;
        footer?: TemplateComponent;
        buttons?: Array<{
            type: string;
            text: string;
            phone_number?: string;
            url?: string;
        }>;
    };
}

interface SendTemplateRequest {
    // Support both 'to' and 'phone' for backwards compatibility
    to?: string;
    phone?: string;
    language?: string;
    customer_name?: string;
    templateName: string;
    text?: string;
    // New format with templateData and variables
    templateData?: TemplateData;
    variables?: {
        header: Record<string, string>;
        body: Record<string, string>;
        footer: Record<string, string>;
    };
    // Legacy format
    components?: Array<{
        type: 'body';
        parameters: Array<{
            type: 'text';
            text: string;
            parameter_name: string;
        }>;
    }>;
}
/**
 * Send template message via WhatsApp Cloud API using user-specific credentials
 */
async function sendTemplateMessage(
    to: string,
    templateName: string,
    language: string,
    accessToken: string,
    phoneNumberId: string,
    apiVersion: string,
    variables: {
        header: Record<string, string>;
        body: Record<string, string>;
        footer: Record<string, string>;
    }
): Promise<{ messages: { id: string }[] }> {
    try {
        const whatsappApiUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

        // Build template parameters for each component
        const templateComponents = [];

        // Add header parameters if header variables exist
        if (Object.keys(variables.header).length > 0) {
            const headerParams = Object.keys(variables.header)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .map(key => ({
                    type: 'text',
                    text: variables.header[key]
                }));

            templateComponents.push({
                type: 'header',
                parameters: headerParams
            });
        }

        // Add body parameters if body variables exist
        if (Object.keys(variables.body).length > 0) {
            const bodyParams = Object.keys(variables.body)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .map(key => ({
                    type: 'text',
                    text: variables.body[key]
                }));

            templateComponents.push({
                type: 'body',
                parameters: bodyParams
            });
        }

        // Add footer parameters if footer variables exist
        if (Object.keys(variables.footer).length > 0) {
            const footerParams = Object.keys(variables.footer)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .map(key => ({
                    type: 'text',
                    text: variables.footer[key]
                }));

            templateComponents.push({
                type: 'footer',
                parameters: footerParams
            });
        }

        const messageData = {
            messaging_product: 'whatsapp',
            to: to,
            type: 'template',
            template: {
                name: templateName,
                language: {
                    code: language
                },
                ...(templateComponents.length > 0 && { components: templateComponents })
            }
        };

        console.log('Sending template message:', JSON.stringify(messageData, null, 2));

        const response = await fetch(whatsappApiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(messageData),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('WhatsApp template message send failed:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText,
                templateName,
                to
            });
            throw new Error(`Failed to send template message: ${errorText}`);
        }

        const result = await response.json();
        console.log('Template message sent successfully:', result);
        return result;

    } catch (error) {
        console.error('Error sending template message:', error);
        throw error;
    }
}


async function sendTemplateMessagev2(
    to: string,
    templateName: string,
    language: string,
    accessToken: string,
    phoneNumberId: string,
    apiVersion: string,
    components: Array<{
        type: string;
        parameters?: Array<{ type: string; text: string }>;
        sub_type?: string;
        index?: string;
    }>
): Promise<{ messages: { id: string }[] }> {
    try {
        const whatsappApiUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;


        const messageData = {
            messaging_product: 'whatsapp',
            to: to,
            type: 'template',
            template: {
                name: templateName,
                language: {
                    code: language
                },
                components
            }
        }

        console.log('Sending template message:', JSON.stringify(messageData, null, 2));

        const response = await fetch(whatsappApiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(messageData),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('WhatsApp template message send failed:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText,
                templateName,
                to
            });
            throw new Error(`Failed to send template message: ${errorText}`);
        }

        const result = await response.json();
        console.log('Template message sent successfully:', result);
        return result;

    } catch (error) {
        console.error('Error sending template message:', error);
        throw error;
    }
}

/**
 * POST handler for sending template messages
 * Now uses user-specific access tokens and phone number IDs
 */
export async function POST(request: NextRequest) {
    console.log('send-template API called');
    try {
        let userId = env.PUBLIC_USER_ID;

        console.log('User ID:', userId);

        // Parse request body - support both new and legacy formats
        const requestBody: SendTemplateRequest = await request.json();

        // Support both 'to' and 'phone' for backwards compatibility
        const to = requestBody.to || requestBody.phone;
        const templateName = requestBody.templateName;
        const customer_name = requestBody.customer_name;
        const text = requestBody.text;

        // Handle new format with templateData and variables
        let templateData: TemplateData;
        let templateLanguage: string;
        let whatsappComponents: Array<{
            type: string;
            parameters?: Array<{ type: string; text: string }>;
            sub_type?: string;
            index?: string;
        }> = [];

        if (requestBody.templateData && requestBody.variables) {
            // New format: templateData with variables object
            templateData = requestBody.templateData;
            templateLanguage = templateData.language;

            const variables = requestBody.variables;

            // Build WhatsApp API components from variables
            // Add header parameters if header variables exist
            if (variables.header && Object.keys(variables.header).length > 0) {
                const headerParams = Object.keys(variables.header)
                    .sort((a, b) => parseInt(a) - parseInt(b))
                    .map(key => ({
                        type: 'text' as const,
                        text: variables.header[key]
                    }));

                whatsappComponents.push({
                    type: 'header',
                    parameters: headerParams
                });
            }

            // Add body parameters if body variables exist
            if (variables.body && Object.keys(variables.body).length > 0) {
                const bodyParams = Object.keys(variables.body)
                    .sort((a, b) => parseInt(a) - parseInt(b))
                    .map(key => ({
                        type: 'text' as const,
                        text: variables.body[key]
                    }));

                whatsappComponents.push({
                    type: 'body',
                    parameters: bodyParams
                });
            }

            // Add footer parameters if footer variables exist
            if (variables.footer && Object.keys(variables.footer).length > 0) {
                const footerParams = Object.keys(variables.footer)
                    .sort((a, b) => parseInt(a) - parseInt(b))
                    .map(key => ({
                        type: 'text' as const,
                        text: variables.footer[key]
                    }));

                whatsappComponents.push({
                    type: 'footer',
                    parameters: footerParams
                });
            }

            // Note: PHONE_NUMBER buttons don't need additional parameters - they use the phone_number defined in the template

        } else {
            // Legacy format: components array directly
            templateData = {
                id: templateName,
                name: templateName,
                language: requestBody.language || 'tr',
                components: requestBody.components || []
            };
            templateLanguage = templateData.language;
            whatsappComponents = requestBody.components as typeof whatsappComponents || [];
        }

        console.log('Template data:', templateData);
        console.log('WhatsApp components:', JSON.stringify(whatsappComponents, null, 2));

        // Validate required parameters
        if (!to || !templateName) {
            console.error('Missing required parameters:', { to: !!to, templateName: !!templateName });
            return NextResponse.json(
                { error: 'Missing required parameters: to, templateName' },
                { status: 400 }
            );
        }

        const serviceRoleClient = await createServiceRoleClient();

        // Get user's WhatsApp API credentials
        const { data: settings, error: settingsError } = await serviceRoleClient
            .from('user_settings')
            .select('access_token, phone_number_id, api_version, access_token_added')
            .eq('id', userId)
            .single();

        if (settingsError || !settings) {
            console.error('User settings not found:', settingsError);
            return NextResponse.json(
                { error: 'WhatsApp credentials not configured. Please complete setup.' },
                { status: 400 }
            );
        }

        if (!settings.access_token_added || !settings.access_token || !settings.phone_number_id) {
            console.error('WhatsApp API credentials not configured for user:', userId);
            return NextResponse.json(
                { error: 'WhatsApp Access Token not configured. Please complete setup.' },
                { status: 400 }
            );
        }




        //check user exists in the users table
        const { data: userData, error: userError } = await serviceRoleClient
            .from('users')
            .select('id')
            .eq('id', to)
            .maybeSingle();


        if (userError) {
            console.error('Error checking user exists in the users table:', userError);
            return NextResponse.json(
                { error: 'Error checking user exists in the users table' },
                { status: 500 }
            );
        }

        if (!userData) {
            console.log('User does not exist in the users table, inserting user:', to);
            const { error: userInsertError } = await serviceRoleClient
                .from('users')
                .insert([{
                    id: to,
                    name: customer_name || to,
                    last_active: new Date().toISOString()
                }]);
            if (userInsertError) {
                console.error('Error inserting user into the users table:', userInsertError);
                return NextResponse.json(
                    { error: 'Error inserting user into the users table' },
                    { status: 500 }
                );
            } else {
                console.log('User inserted into the users table:', to);
            }

        }






        const accessToken = settings.access_token;
        const phoneNumberId = settings.phone_number_id;
        const apiVersion = settings.api_version || 'v23.0';

        console.log(`Sending template message: ${templateName} to ${to}`);

        // Send template message via WhatsApp using user-specific credentials
        const messageResponse = await sendTemplateMessagev2(
            to,
            templateName,
            templateLanguage,
            accessToken,
            phoneNumberId,
            apiVersion,
            whatsappComponents
        );
        const messageId = messageResponse.messages?.[0]?.id;

        if (!messageId) {
            throw new Error('No message ID returned from WhatsApp API');
        }

        // Generate content for display in chat

        let finalText = text;

        let displayContent = finalText || templateName

        // Store message in database
        const timestamp = new Date().toISOString();

        // Process template components for storage with variables replaced
        const processedComponents = {
            header: null as {
                format: string;
                text?: string;
                media_url?: string | null;
            } | null,
            body: null as {
                text?: string;
            } | null,
            footer: null as {
                text?: string;
            } | null,
            buttons: [] as Array<{
                type: string;
                text: string;
                url?: string;
                phone_number?: string;
            }>
        };







        const messageObject = {
            id: messageId,
            sender_id: userId, // Recipient phone number (sender in DB)
            receiver_id: to, // Current authenticated user (receiver in DB)
            content: displayContent,
            timestamp: timestamp,
            is_sent_by_me: true,
            is_read: true, // Outgoing messages are already "read" by the sender
            message_type: 'template',
            media_data: JSON.stringify({
                type: 'template',
                template_name: templateName,
                template_id: templateData.id,
                language: templateData.language,
                variables: templateData.components,
                original_content: finalText || templateName,
                // Add processed template components for rich display
                header: processedComponents.header,
                body: processedComponents.body,
                footer: processedComponents.footer,
                buttons: processedComponents.buttons
            }),
        };

        const { error: dbError } = await createServiceRoleClient()
            .from('messages')
            .insert([messageObject]);

        if (dbError) {
            console.error('Error storing template message in database:', dbError);
            // Don't fail the request if database storage fails
        } else {
            console.log('Template message stored successfully in database:', messageObject.id);
        }

        return NextResponse.json({
            success: true,
            messageId: messageId,
            templateName: templateName,
            displayContent: displayContent,
            timestamp: timestamp,
        });

    } catch (error) {
        console.error('Error in send-template API:', error);
        return NextResponse.json(
            {
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}

/**
 * GET handler for checking API status (now user-specific)
 */
export async function GET() {
    try {
        const supabase = await createClient();

        // Verify user authentication
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Get user's WhatsApp API credentials
        const { data: settings } = await supabase
            .from('user_settings')
            .select('access_token_added, api_version')
            .eq('id', user.id)
            .single();

        const isConfigured = settings?.access_token_added || false;
        const apiVersion = settings?.api_version || 'v23.0';

        return NextResponse.json({
            status: 'WhatsApp Send Template API',
            configured: isConfigured,
            version: apiVersion,
            timestamp: new Date().toISOString()
        });
    } catch {
        return NextResponse.json({
            status: 'WhatsApp Send Template API',
            configured: false,
            error: 'Failed to check configuration',
            timestamp: new Date().toISOString()
        });
    }
}

