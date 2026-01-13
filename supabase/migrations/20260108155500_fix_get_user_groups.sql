CREATE OR REPLACE FUNCTION "public"."get_user_groups_with_counts"() RETURNS TABLE("group_id" "uuid", "group_name" "text", "group_description" "text", "member_count" bigint, "unread_count" bigint, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cg.id AS group_id,
    cg.name AS group_name,
    cg.description AS group_description,
    COUNT(DISTINCT gm.id) AS member_count,
    COALESCE(SUM(
      (SELECT COUNT(*) 
       FROM messages m 
       WHERE m.sender_id = gm.user_id 
       AND m.receiver_id = auth.uid()::text
       AND m.is_read = false
      )
    ), 0)::bigint AS unread_count,
    cg.created_at,
    cg.updated_at
  FROM chat_groups cg
  LEFT JOIN group_members gm ON gm.group_id = cg.id
  WHERE cg.owner_id = auth.uid()
  GROUP BY cg.id, cg.name, cg.description, cg.created_at, cg.updated_at
  ORDER BY cg.updated_at DESC;
END;
$$;

ALTER FUNCTION "public"."get_user_groups_with_counts"() OWNER TO "postgres";
GRANT ALL ON FUNCTION "public"."get_user_groups_with_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_groups_with_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_groups_with_counts"() TO "service_role";
