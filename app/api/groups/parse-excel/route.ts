import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

interface MatchedUser {
  userId: string;
  name: string;
  phone: string;
  isNew: boolean;
}

interface InvalidNumber {
  phone: string;
  reason: string;
}

/**
 * POST - Parse Excel file and match phone numbers with existing users
 * Creates new users for phone numbers that don't exist
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(fileExtension || '')) {
      return NextResponse.json(
        { error: 'Invalid file format. Please upload an Excel (.xlsx, .xls) or CSV file.' },
        { status: 400 }
      );
    }

    // Read file
    const arrayBuffer = await file.arrayBuffer();

    // Parse Excel/CSV
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json<any>(sheet, { header: 1 });

    if (rawData.length < 2) {
      return NextResponse.json(
        { error: 'The file is empty or only contains headers.' },
        { status: 400 }
      );
    }

    // Extract headers (first row)
    const headers = rawData[0] as string[];

    // Find phone column (look for common phone column names)
    const phoneColumn = headers.findIndex(h =>
      h && (h.toLowerCase().includes('phone') ||
        h.toLowerCase().includes('mobile') ||
        h.toLowerCase().includes('number') ||
        h.toLowerCase().includes('whatsapp') ||
        h.toLowerCase().includes('tel'))
    );

    if (phoneColumn === -1) {
      return NextResponse.json(
        { error: 'Could not find phone number column. Please ensure your Excel has a column named "phone", "mobile", "number", or "whatsapp".' },
        { status: 400 }
      );
    }

    // Extract phone numbers from data (skip header row)
    const phoneNumbers: string[] = [];
    const names: string[] = [];
    const invalidNumbers: InvalidNumber[] = [];

    // Normalize and validate phone number
    // Rules:
    //   1. Remove all spaces and non-digit characters
    //   2. If starts with 0  → prepend '9'  (0XXXXXXXXXX  → 90XXXXXXXXXX)
    //   3. If starts with 5  → prepend '90' (5XXXXXXXXXX  → 905XXXXXXXXXX)
    //   4. Final number must be exactly 12 digits and start with '905'
    const normalizePhone = (raw: string): { normalized: string | null; reason?: string } => {
      // Step 1: remove spaces, then strip any remaining non-digit chars
      let digits = raw.replace(/\s+/g, '').replace(/\D/g, '');

      if (!digits) {
        return { normalized: null, reason: 'Empty after cleaning' };
      }

      // Step 2 & 3: fix prefix
      if (digits.startsWith('0')) {
        digits = '9' + digits; // 0XXXXXXXXXX → 90XXXXXXXXXX
      } else if (digits.startsWith('5')) {
        digits = '90' + digits; // 5XXXXXXXXXX → 905XXXXXXXXXX
      }

      // Step 4: must be exactly 12 digits
      if (digits.length !== 12) {
        return { normalized: null, reason: `Expected 12 digits, got ${digits.length}` };
      }

      // Must start with 905
      if (!digits.startsWith('905')) {
        return { normalized: null, reason: `Must start with 905, got ${digits.slice(0, 3)}` };
      }

      return { normalized: digits };
    };

    // Find name column once (outside the loop)
    const nameColumn = headers.findIndex(h =>
      h && (h.toLowerCase().includes('name') ||
        h.toLowerCase().includes('nom') ||
        h.toLowerCase().includes('fullname'))
    );

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i] as any[];
      const rawPhone = row[phoneColumn]?.toString() ?? '';
      if (!rawPhone.trim()) continue;

      const { normalized, reason } = normalizePhone(rawPhone);
      if (normalized) {
        phoneNumbers.push(normalized);
        names.push(nameColumn !== -1 ? (row[nameColumn]?.toString().trim() || '') : '');
      } else {
        invalidNumbers.push({ phone: rawPhone.trim(), reason: reason || 'Invalid' });
      }
    }

    if (phoneNumbers.length === 0) {
      let errorMsg = 'No valid phone numbers found in file.';
      if (invalidNumbers.length > 0) {
        errorMsg += ` ${invalidNumbers.length} invalid number(s) were skipped.`;
      }
      return NextResponse.json(
        { error: errorMsg },
        { status: 400 }
      );
    }

    // Get all existing users
    const { data: existingUsers, error: usersError } = await supabase
      .from('users')
      .select('id, name, custom_name, whatsapp_name');

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return NextResponse.json(
        { error: 'Failed to fetch existing users' },
        { status: 500 }
      );
    }

    // Create a map of phone numbers to user IDs (both exact and cleaned versions)
    const userMap = new Map<string, { id: string; name: string; custom_name?: string; whatsapp_name?: string }>();
    existingUsers?.forEach(u => {
      // Store with different formats for matching
      userMap.set(u.id, {
        id: u.id,
        name: u.name,
        custom_name: u.custom_name,
        whatsapp_name: u.whatsapp_name
      });
      // Also store cleaned version
      const cleanedId = u.id.replace(/\D/g, '');
      if (cleanedId && cleanedId !== u.id) {
        userMap.set(cleanedId, {
          id: u.id,
          name: u.name,
          custom_name: u.custom_name,
          whatsapp_name: u.whatsapp_name
        });
      }
    });

    // Process each phone number and create users for non-existing ones
    const matchedUsers: MatchedUser[] = [];
    const newUsersToInsert: Array<{ id: string; name: string }> = [];
    const uniquePhoneNumbers = new Set<string>();

    for (let i = 0; i < phoneNumbers.length; i++) {
      const phone = phoneNumbers[i];
      const name = names[i] || phone;

      // Skip duplicates
      if (uniquePhoneNumbers.has(phone)) {
        continue;
      }
      uniquePhoneNumbers.add(phone);

      // Try exact match
      let matchedUser = userMap.get(phone);

      // Try to clean and match
      if (!matchedUser) {
        const cleanedPhone = phone.replace(/\D/g, '');
        for (const [userId, userData] of userMap.entries()) {
          const cleanedUserId = userId.replace(/\D/g, '');
          if (cleanedUserId === cleanedPhone ||
            cleanedUserId.endsWith(cleanedPhone) ||
            cleanedPhone.endsWith(cleanedUserId)) {
            matchedUser = { ...userData };
            break;
          }
        }
      }

      if (matchedUser) {
        // User exists
        matchedUsers.push({
          userId: matchedUser.id,
          name: matchedUser.custom_name || matchedUser.whatsapp_name || matchedUser.name || name,
          phone,
          isNew: false,
        });
      } else {
        // User doesn't exist - will be created
        matchedUsers.push({
          userId: phone, // Use phone as ID
          name: name || phone,
          phone,
          isNew: true,
        });
        newUsersToInsert.push({
          id: phone,
          name: name || phone,
        });
      }
    }

    // Create new users if any
    if (newUsersToInsert.length > 0) {
      // Ensure newUsersToInsert is unique by cleaned phone number
      const uniqueUsersMap = new Map<string, { id: string; name: string }>();
      newUsersToInsert.forEach(user => {
        const cleanedPhone = user.id.replace(/\D/g, '');
        if (!uniqueUsersMap.has(cleanedPhone)) {
          uniqueUsersMap.set(cleanedPhone, user);
        }
      });
      const uniqueNewUsersToInsert = Array.from(uniqueUsersMap.values());

      const { error: insertError } = await supabase
        .from('users')
        .upsert(uniqueNewUsersToInsert, { onConflict: 'id', ignoreDuplicates: true });

      if (insertError) {
        console.error('Error creating new users:', insertError);
        // Don't fail completely, but note the error in response
        return NextResponse.json(
          {
            error: 'Failed to create some new users',
            details: insertError.message,
            data: {
              total: phoneNumbers.length,
              existing: matchedUsers.filter(u => !u.isNew).length,
              new: matchedUsers.filter(u => u.isNew).length,
              users: matchedUsers,
            },
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total: matchedUsers.length,
        existing: matchedUsers.filter(u => !u.isNew).length,
        new: matchedUsers.filter(u => u.isNew).length,
        invalid: invalidNumbers.length,
        users: matchedUsers,
        invalidNumbers,
      },
    });

  } catch (error) {
    console.error('Error in parse-excel API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
