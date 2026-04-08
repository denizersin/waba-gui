import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { env } from 'process';
import { uploadFileToS3 } from '@/lib/aws-s3';

export const runtime = 'nodejs';

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
 * Upload an image file to WhatsApp Media API and return the media ID
 */
async function uploadImageToWhatsApp(
    file: File,
    accessToken: string,
    phoneNumberId: string,
    apiVersion: string
): Promise<string | null> {
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', file.type);
        formData.append('messaging_product', 'whatsapp');

        const uploadResponse = await fetch(
            `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`,
            {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}` },
                body: formData,
            }
        );

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error('WhatsApp media upload failed:', errorText);
            return null;
        }

        const result = await uploadResponse.json();
        console.log('Header image uploaded to WhatsApp, media ID:', result.id);
        return result.id as string;
    } catch (error) {
        console.error('Error uploading image to WhatsApp:', error);
        return null;
    }
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
        parameters?: Array<Record<string, unknown>>;
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
        const userId = env.PUBLIC_USER_ID;
        console.log('User ID:', userId);

        // ── 1. Parse request: supports both multipart/form-data (with image) and JSON ──
        let to: string | undefined;
        let templateName: string | undefined;
        let customer_name: string | undefined;
        let text: string | undefined;
        let headerImageFile: File | null = null;
        let requestBody: SendTemplateRequest;

        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            to = (formData.get('to') as string) || undefined;
            templateName = (formData.get('templateName') as string) || undefined;
            customer_name = (formData.get('customer_name') as string) || undefined;
            text = (formData.get('text') as string) || undefined;

            const templateDataRaw = formData.get('templateData') as string | null;
            const variablesRaw = formData.get('variables') as string | null;

            requestBody = {
                to,
                templateName: templateName || '',
                customer_name,
                text,
                templateData: templateDataRaw ? JSON.parse(templateDataRaw) : undefined,
                variables: variablesRaw ? JSON.parse(variablesRaw) : undefined,
            };

            const imageEntry = formData.get('headerImage');
            if (imageEntry instanceof File && imageEntry.size > 0) {
                headerImageFile = imageEntry;
            }
        } else {
            requestBody = (await request.json()) as SendTemplateRequest;
            to = requestBody.to || requestBody.phone;
            templateName = requestBody.templateName;
            customer_name = requestBody.customer_name;
            text = requestBody.text;
        }

        console.log('Request body received, templateName:', templateName, 'to:', to);

        // ── 2. Validate required parameters ──
        if (!to || !templateName) {
            console.error('Missing required parameters:', { to: !!to, templateName: !!templateName });
            return NextResponse.json(
                { error: 'Missing required parameters: to, templateName' },
                { status: 400 }
            );
        }

        // ── 3. Fetch WhatsApp credentials ──
        const serviceRoleClient = await createServiceRoleClient();

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

        const accessToken = settings.access_token as string;
        const phoneNumberId = settings.phone_number_id as string;
        const apiVersion = (settings.api_version as string) || 'v23.0';

        // ── 4. Build WhatsApp template components ──
        let templateData: TemplateData;
        let templateLanguage: string;
        const whatsappComponents: Array<{
            type: string;
            parameters?: Array<Record<string, unknown>>;
            sub_type?: string;
            index?: string;
        }> = [];

        if (requestBody.templateData && requestBody.variables) {
            templateData = requestBody.templateData;
            templateLanguage = templateData.language;
            const variables = requestBody.variables;

            // IMAGE header: upload image to WhatsApp first, then add component
            if (headerImageFile) {
                const mediaId = await uploadImageToWhatsApp(
                    headerImageFile,
                    accessToken,
                    phoneNumberId,
                    apiVersion
                );

                if (!mediaId) {
                    return NextResponse.json(
                        { error: 'Failed to upload header image to WhatsApp' },
                        { status: 500 }
                    );
                }

                // Per Meta docs: header component with image parameter
                whatsappComponents.push({
                    type: 'header',
                    parameters: [{ type: 'image', image: { id: mediaId } }],
                });

                // Best-effort S3 backup of the header image
                try {
                    const s3MediaId = `template_header_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    await uploadFileToS3(headerImageFile, userId || 'system', s3MediaId);
                    console.log('Header image also uploaded to S3');
                } catch (s3Error) {
                    console.warn('S3 upload for header image failed (non-fatal):', s3Error);
                }
            }

            // TEXT header variables (only if IMAGE header not already added)
            if (variables.header && Object.keys(variables.header).length > 0) {
                if (!whatsappComponents.some(c => c.type === 'header')) {
                    const headerParams = Object.keys(variables.header)
                        .sort((a, b) => parseInt(a) - parseInt(b))
                        .map(key => ({ type: 'text', text: variables.header[key] }));
                    whatsappComponents.push({ type: 'header', parameters: headerParams });
                }
            }

            // Body variables
            if (variables.body && Object.keys(variables.body).length > 0) {
                const bodyParams = Object.keys(variables.body)
                    .sort((a, b) => parseInt(a) - parseInt(b))
                    .map(key => ({ type: 'text', text: variables.body[key] }));
                whatsappComponents.push({ type: 'body', parameters: bodyParams });
            }

            // Footer variables
            if (variables.footer && Object.keys(variables.footer).length > 0) {
                const footerParams = Object.keys(variables.footer)
                    .sort((a, b) => parseInt(a) - parseInt(b))
                    .map(key => ({ type: 'text', text: variables.footer[key] }));
                whatsappComponents.push({ type: 'footer', parameters: footerParams });
            }

        } else {
            // Legacy format
            templateData = {
                id: templateName,
                name: templateName,
                language: requestBody.language || 'tr',
                components: requestBody.components || [],
            };
            templateLanguage = templateData.language;
            const legacyComponents = requestBody.components as typeof whatsappComponents || [];
            whatsappComponents.push(...legacyComponents);
        }

        console.log('WhatsApp components:', JSON.stringify(whatsappComponents, null, 2));

        // ── 5. Ensure customer exists in DB ──
        const { data: userData, error: userError } = await serviceRoleClient
            .from('users')
            .select('id')
            .eq('id', to)
            .maybeSingle();

        if (userError) {
            console.error('Error checking user exists:', userError);
            return NextResponse.json(
                { error: 'Error checking user exists in the users table' },
                { status: 500 }
            );
        }

        if (!userData) {
            console.log('Inserting new user:', to);
            const { error: userInsertError } = await serviceRoleClient
                .from('users')
                .insert([{
                    id: to,
                    name: customer_name || to,
                    last_active: new Date().toISOString(),
                }]);
            if (userInsertError) {
                console.error('Error inserting user:', userInsertError);
                return NextResponse.json(
                    { error: 'Error inserting user into the users table' },
                    { status: 500 }
                );
            }
        }

        // ── 6. Send the template via WhatsApp ──
        console.log(`Sending template message: ${templateName} to ${to}`);
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

        // ── 7. Build display text ──
        let finalText = text;
        if (!finalText && templateData) {
            const bodyComponent = templateData.formatted_components?.body ||
                templateData.components?.find(c => c.type === 'BODY' || c.type === 'body');
            if (bodyComponent?.text) {
                finalText = bodyComponent.text;
                if (requestBody.variables?.body) {
                    const bodyVars = requestBody.variables.body;
                    Object.keys(bodyVars).forEach(key => {
                        finalText = finalText!.replace(`{{${key}}}`, bodyVars[key]);
                    });
                }
            }
        }
        const displayContent = finalText || templateName;

        // ── 8. Store in DB ──
        const timestamp = new Date().toISOString();
        const messageObject = {
            id: messageId,
            sender_id: userId,
            receiver_id: to,
            content: displayContent,
            timestamp,
            is_sent_by_me: true,
            is_read: true,
            message_type: 'template',
            media_data: JSON.stringify({
                type: 'template',
                template_name: templateName,
                template_id: templateData.id,
                language: templateData.language,
                variables: templateData.components,
                original_content: finalText || templateName,
                header: null,
                body: null,
                footer: null,
                buttons: [],
            }),
        };

        const { error: dbError } = await createServiceRoleClient()
            .from('messages')
            .insert([messageObject]);

        if (dbError) {
            console.error('Error storing template message in database:', dbError);
        } else {
            console.log('Template message stored successfully:', messageObject.id);
        }

        return NextResponse.json({
            success: true,
            messageId,
            templateName,
            displayContent,
            timestamp,
        });

    } catch (error) {
        console.error('Error in send-template API:', error);
        return NextResponse.json(
            {
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error',
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

