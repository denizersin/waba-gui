-- Fix get_group_members_with_details to handle text/uuid mismatch and strict type matching
-- Re-defining the function. Note: We use ::varchar and ::bigint to strictly match the RETURNS TABLE definition.

CREATE OR REPLACE FUNCTION "public"."get_group_members_with_details"("p_group_id" "uuid") 
RETURNS TABLE(
  "member_id" "uuid", 
  "user_id" character varying, 
  "whatsapp_name" "text", 
  "custom_name" "text", 
  "added_at" timestamp with time zone, 
  "unread_count" bigint
)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gm.id,                         -- matches member_id (uuid)
    gm.user_id::character varying, -- matches user_id (character varying) - Casting text to varchar
    COALESCE(u.whatsapp_name, u.name)::text, -- matches whatsapp_name (text)
    u.custom_name::text,           -- matches custom_name (text)
    gm.added_at,                  -- matches added_at (timestamp with time zone)
    COALESCE(
      (SELECT COUNT(*) 
       FROM messages m 
       WHERE m.sender_id = gm.user_id 
       AND m.receiver_id = (
         -- Resolve owner's phone number from auth.users (phone is stored in auth.users)
         -- We check both explicit phone column or implicit assumption that auth.users has phone.
         -- Given schema context, we assume auth.users has the phone number needed.
         SELECT phone 
         FROM auth.users 
         WHERE id = (SELECT owner_id FROM chat_groups WHERE id = p_group_id)
       )
       AND m.is_read = false
      ), 0
    )::bigint                     -- matches unread_count (bigint)
  FROM group_members gm
  LEFT JOIN users u ON u.id = gm.user_id
  WHERE gm.group_id = p_group_id
  ORDER BY NULLIF(u.custom_name, '') NULLS LAST, COALESCE(u.whatsapp_name, u.name);
END;
$$;

ALTER FUNCTION "public"."get_group_members_with_details"("p_group_id" "uuid") OWNER TO "postgres";
