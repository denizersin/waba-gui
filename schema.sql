


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."create_or_get_user"("phone_number" "text", "user_name" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "text", "name" "text", "custom_name" "text", "whatsapp_name" "text", "last_active" timestamp with time zone, "is_new" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  user_exists BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM users WHERE users.id = phone_number) INTO user_exists;
  
  IF NOT user_exists THEN
    INSERT INTO users (id, name, whatsapp_name, last_active)
    VALUES (phone_number, COALESCE(user_name, phone_number), user_name, NOW());
    
    RETURN QUERY
    SELECT users.id, users.name, users.custom_name, users.whatsapp_name, users.last_active, TRUE as is_new
    FROM users
    WHERE users.id = phone_number;
  ELSE
    IF user_name IS NOT NULL THEN
      UPDATE users
      SET whatsapp_name = user_name, last_active = NOW()
      WHERE users.id = phone_number;
    END IF;
    
    RETURN QUERY
    SELECT users.id, users.name, users.custom_name, users.whatsapp_name, users.last_active, FALSE as is_new
    FROM users
    WHERE users.id = phone_number;
  END IF;
END;
$$;


ALTER FUNCTION "public"."create_or_get_user"("phone_number" "text", "user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_conversation_messages"("other_user_id" "text", "current_user_phone" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "text", "sender_id" "text", "receiver_id" "text", "content" "text", "message_timestamp" timestamp with time zone, "is_sent_by_me" boolean, "message_type" "text", "media_data" "jsonb", "is_read" boolean, "read_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.sender_id,
    m.receiver_id,
    m.content,
    m.timestamp as message_timestamp,
    (m.sender_id != other_user_id) as is_sent_by_me,
    m.message_type,
    m.media_data,
    m.is_read,
    m.read_at
  FROM messages m
  WHERE (m.sender_id = other_user_id OR m.receiver_id = other_user_id)
  ORDER BY m.timestamp ASC;
END;
$$;


ALTER FUNCTION "public"."get_conversation_messages"("other_user_id" "text", "current_user_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_group_members_with_details"("p_group_id" "uuid") RETURNS TABLE("member_id" "uuid", "user_id" character varying, "whatsapp_name" "text", "custom_name" "text", "added_at" timestamp with time zone, "unread_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gm.id AS member_id,
    gm.user_id,
    COALESCE(u.whatsapp_name, u.name) AS whatsapp_name,
    u.custom_name,
    gm.added_at,
    COALESCE(
      (SELECT COUNT(*) 
       FROM messages m 
       WHERE m.sender_id = gm.user_id 
       AND m.receiver_id = (SELECT owner_id FROM chat_groups WHERE id = p_group_id)
       AND m.is_read = false
      ), 0
    ) AS unread_count
  FROM group_members gm
  LEFT JOIN users u ON u.id = gm.user_id
  WHERE gm.group_id = p_group_id
  ORDER BY NULLIF(u.custom_name, '') NULLS LAST, COALESCE(u.whatsapp_name, u.name);
END;
$$;


ALTER FUNCTION "public"."get_group_members_with_details"("p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_group_unread_count"("p_group_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  total_unread BIGINT;
BEGIN
  SELECT COALESCE(SUM(
    (SELECT COUNT(*) 
     FROM messages m 
     WHERE m.sender_id = gm.user_id 
     AND m.receiver_id = (SELECT owner_id FROM chat_groups WHERE id = p_group_id)
     AND m.is_read = false
    )
  ), 0)
  INTO total_unread
  FROM group_members gm
  WHERE gm.group_id = p_group_id;
  
  RETURN total_unread;
END;
$$;


ALTER FUNCTION "public"."get_group_unread_count"("p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unread_conversations"("limit_count" integer DEFAULT 10) RETURNS TABLE("conversation_id" "text", "display_name" "text", "unread_count" bigint, "last_message_time" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.sender_id as conversation_id,
    COALESCE(u.custom_name, u.whatsapp_name, u.name, u.id) as display_name,
    COUNT(*) as unread_count,
    MAX(m.timestamp) as last_message_time
  FROM messages m
  LEFT JOIN users u ON u.id = m.sender_id
  WHERE m.is_read = FALSE
  GROUP BY m.sender_id, u.custom_name, u.whatsapp_name, u.name, u.id
  ORDER BY last_message_time DESC
  LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."get_unread_conversations"("limit_count" integer) OWNER TO "postgres";


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
       AND m.receiver_id = (SELECT id FROM auth.users() LIMIT 1)
       AND m.is_read = false
      )
    ), 0) AS unread_count,
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


CREATE OR REPLACE FUNCTION "public"."mark_messages_as_read"("current_user_id" "text", "other_user_id" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  affected_rows INTEGER;
BEGIN
  UPDATE messages
  SET is_read = TRUE, read_at = NOW()
  WHERE receiver_id = current_user_id
    AND sender_id = other_user_id
    AND is_read = FALSE;
  
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$$;


ALTER FUNCTION "public"."mark_messages_as_read"("current_user_id" "text", "other_user_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_user_conversations"("p_user_id" "text", "search_term" "text") RETURNS TABLE("id" "text", "display_name" "text", "last_message" "text", "last_message_time" timestamp with time zone, "unread_count" bigint, "match_type" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  WITH matched_users AS (
    -- İsim üzerinden eşleşen kullanıcıları bul
    SELECT 
      u.id AS contact_id
    FROM public.users u
    WHERE 
      u.custom_name ILIKE '%' || search_term || '%' OR 
      u.whatsapp_name ILIKE '%' || search_term || '%' OR 
      u.name ILIKE '%' || search_term || '%'
  ),
  matched_messages AS (
    -- Mesaj içeriği üzerinden eşleşenleri bul
    SELECT 
      CASE 
        WHEN m.sender_id = p_user_id THEN m.receiver_id 
        ELSE m.sender_id 
      END AS contact_id
    FROM public.messages m
    WHERE 
      (m.sender_id = p_user_id OR m.receiver_id = p_user_id) AND
      m.content ILIKE '%' || search_term || '%'
  ),
  combined_ids AS (
    -- Benzersiz ID listesi oluştur
    SELECT contact_id FROM matched_users
    UNION
    SELECT contact_id FROM matched_messages
  )
  SELECT 
    u.id, -- Artık belirsiz değil, tablo alias'ı (u) var
    COALESCE(u.custom_name, u.whatsapp_name, u.name, u.id) AS display_name,
    lm.content AS last_message,
    lm.timestamp AS last_message_time,
    (SELECT COUNT(*) FROM public.messages m2 
     WHERE m2.sender_id = u.id 
     AND m2.receiver_id = p_user_id 
     AND m2.is_read = false) AS unread_count,
    CASE 
      WHEN EXISTS (
        SELECT 1 FROM public.messages m3 
        WHERE (m3.sender_id = u.id OR m3.receiver_id = u.id) 
        AND m3.content ILIKE '%' || search_term || '%'
      ) THEN 'content'
      ELSE 'user'
    END AS match_type
  FROM combined_ids ci
  JOIN public.users u ON u.id = ci.contact_id
  LEFT JOIN LATERAL (
    SELECT m.content, m.timestamp
    FROM public.messages m
    WHERE (m.sender_id = p_user_id AND m.receiver_id = u.id) 
       OR (m.sender_id = u.id AND m.receiver_id = p_user_id)
    ORDER BY m.timestamp DESC
    LIMIT 1
  ) lm ON TRUE
  ORDER BY 
    -- İçerik eşleşmesi olanlara öncelik ver (match_type = 'content')
    (CASE WHEN EXISTS (
        SELECT 1 FROM public.messages m4 
        WHERE (m4.sender_id = u.id OR m4.receiver_id = u.id) 
        AND m4.content ILIKE '%' || search_term || '%'
      ) THEN 1 ELSE 2 END) ASC,
    lm.timestamp DESC NULLS LAST;
END;
$$;


ALTER FUNCTION "public"."search_user_conversations"("p_user_id" "text", "search_term" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_custom_name"("user_id" "text", "new_custom_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE users 
  SET custom_name = new_custom_name
  WHERE id = user_id;
  RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."update_user_custom_name"("user_id" "text", "new_custom_name" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."chat_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."chat_groups" REPLICA IDENTITY FULL;


ALTER TABLE "public"."chat_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "user_id" "text" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."group_members" REPLICA IDENTITY FULL;


ALTER TABLE "public"."group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "text" NOT NULL,
    "sender_id" "text" NOT NULL,
    "receiver_id" "text" NOT NULL,
    "content" "text" NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"(),
    "is_sent_by_me" boolean DEFAULT false,
    "message_type" "text" DEFAULT 'text'::"text",
    "media_data" "jsonb",
    "is_read" boolean DEFAULT false,
    "read_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "custom_name" "text",
    "whatsapp_name" "text",
    "last_active" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."users" REPLICA IDENTITY FULL;


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_conversations" WITH ("security_invoker"='on') AS
 WITH "unread_counts" AS (
         SELECT "messages"."sender_id",
            "count"(*) AS "unread_count"
           FROM "public"."messages"
          WHERE ("messages"."is_read" = false)
          GROUP BY "messages"."sender_id"
        ), "latest_messages" AS (
         SELECT DISTINCT ON (
                CASE
                    WHEN ("messages"."sender_id" < "messages"."receiver_id") THEN (("messages"."sender_id" || '-'::"text") || "messages"."receiver_id")
                    ELSE (("messages"."receiver_id" || '-'::"text") || "messages"."sender_id")
                END) "messages"."sender_id",
            "messages"."receiver_id",
            "messages"."content",
            "messages"."message_type",
            "messages"."timestamp" AS "last_message_time",
            "messages"."sender_id" AS "last_message_sender"
           FROM "public"."messages"
          ORDER BY
                CASE
                    WHEN ("messages"."sender_id" < "messages"."receiver_id") THEN (("messages"."sender_id" || '-'::"text") || "messages"."receiver_id")
                    ELSE (("messages"."receiver_id" || '-'::"text") || "messages"."sender_id")
                END, "messages"."timestamp" DESC
        )
 SELECT DISTINCT "u"."id",
    COALESCE("u"."custom_name", "u"."whatsapp_name", "u"."name", "u"."id") AS "display_name",
    "u"."custom_name",
    "u"."whatsapp_name",
    "u"."name" AS "original_name",
    "u"."last_active",
    COALESCE("unread_counts"."unread_count", (0)::bigint) AS "unread_count",
    "lm"."content" AS "last_message",
    "lm"."message_type" AS "last_message_type",
    "lm"."last_message_time",
    "lm"."last_message_sender",
        CASE
            WHEN ("unread_counts"."unread_count" > 0) THEN 1
            ELSE 0
        END AS "has_unread"
   FROM (("public"."users" "u"
     LEFT JOIN "unread_counts" ON (("u"."id" = "unread_counts"."sender_id")))
     LEFT JOIN "latest_messages" "lm" ON ((("u"."id" = "lm"."sender_id") OR ("u"."id" = "lm"."receiver_id"))))
  ORDER BY
        CASE
            WHEN ("unread_counts"."unread_count" > 0) THEN 1
            ELSE 0
        END DESC, "lm"."last_message_time" DESC NULLS LAST;


ALTER VIEW "public"."user_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_settings" (
    "id" "uuid" NOT NULL,
    "access_token" "text",
    "phone_number_id" "text",
    "business_account_id" "text",
    "verify_token" "text",
    "webhook_token" "text",
    "api_version" "text" DEFAULT 'v23.0'::"text",
    "webhook_verified" boolean DEFAULT false,
    "access_token_added" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_settings" OWNER TO "postgres";


ALTER TABLE ONLY "public"."chat_groups"
    ADD CONSTRAINT "chat_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_user_id_key" UNIQUE ("group_id", "user_id");



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_webhook_token_key" UNIQUE ("webhook_token");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_chat_groups_owner_id" ON "public"."chat_groups" USING "btree" ("owner_id");



CREATE INDEX "idx_group_members_group_id" ON "public"."group_members" USING "btree" ("group_id");



CREATE INDEX "idx_group_members_user_id" ON "public"."group_members" USING "btree" ("user_id");



CREATE INDEX "idx_messages_conversation" ON "public"."messages" USING "btree" ("sender_id", "receiver_id", "timestamp" DESC);



CREATE INDEX "idx_messages_is_read" ON "public"."messages" USING "btree" ("is_read");



CREATE INDEX "idx_messages_media_data" ON "public"."messages" USING "gin" ("media_data");



CREATE INDEX "idx_messages_receiver" ON "public"."messages" USING "btree" ("receiver_id");



CREATE INDEX "idx_messages_sender" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "idx_messages_timestamp" ON "public"."messages" USING "btree" ("timestamp" DESC);



CREATE INDEX "idx_user_settings_business_account_id" ON "public"."user_settings" USING "btree" ("business_account_id");



CREATE INDEX "idx_user_settings_phone_number_id" ON "public"."user_settings" USING "btree" ("phone_number_id");



CREATE INDEX "idx_user_settings_webhook_token" ON "public"."user_settings" USING "btree" ("webhook_token");



CREATE OR REPLACE TRIGGER "update_chat_groups_updated_at" BEFORE UPDATE ON "public"."chat_groups" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_settings_updated_at" BEFORE UPDATE ON "public"."user_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."chat_groups"
    ADD CONSTRAINT "chat_groups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Authenticated users can insert users" ON "public"."users" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can update users" ON "public"."users" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can add members to their groups" ON "public"."group_members" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."chat_groups"
  WHERE (("chat_groups"."id" = "group_members"."group_id") AND ("chat_groups"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Users can create groups" ON "public"."chat_groups" FOR INSERT WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can delete their own groups" ON "public"."chat_groups" FOR DELETE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can insert own settings" ON "public"."user_settings" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can remove members from their groups" ON "public"."group_members" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."chat_groups"
  WHERE (("chat_groups"."id" = "group_members"."group_id") AND ("chat_groups"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Users can send messages" ON "public"."messages" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can update messages" ON "public"."messages" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can update own settings" ON "public"."user_settings" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own groups" ON "public"."chat_groups" FOR UPDATE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can view all messages" ON "public"."messages" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can view all users" ON "public"."users" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can view members of their groups" ON "public"."group_members" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."chat_groups"
  WHERE (("chat_groups"."id" = "group_members"."group_id") AND ("chat_groups"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own settings" ON "public"."user_settings" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their own groups" ON "public"."chat_groups" FOR SELECT USING (("auth"."uid"() = "owner_id"));



ALTER TABLE "public"."chat_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_groups";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."group_members";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."users";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."create_or_get_user"("phone_number" "text", "user_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_or_get_user"("phone_number" "text", "user_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_or_get_user"("phone_number" "text", "user_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_conversation_messages"("other_user_id" "text", "current_user_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_conversation_messages"("other_user_id" "text", "current_user_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_conversation_messages"("other_user_id" "text", "current_user_phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_group_members_with_details"("p_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_group_members_with_details"("p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_group_members_with_details"("p_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_group_unread_count"("p_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_group_unread_count"("p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_group_unread_count"("p_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unread_conversations"("limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_unread_conversations"("limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unread_conversations"("limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_groups_with_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_groups_with_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_groups_with_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_messages_as_read"("current_user_id" "text", "other_user_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_messages_as_read"("current_user_id" "text", "other_user_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_messages_as_read"("current_user_id" "text", "other_user_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_user_conversations"("p_user_id" "text", "search_term" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."search_user_conversations"("p_user_id" "text", "search_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_user_conversations"("p_user_id" "text", "search_term" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_custom_name"("user_id" "text", "new_custom_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_custom_name"("user_id" "text", "new_custom_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_custom_name"("user_id" "text", "new_custom_name" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."chat_groups" TO "anon";
GRANT ALL ON TABLE "public"."chat_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_groups" TO "service_role";



GRANT ALL ON TABLE "public"."group_members" TO "anon";
GRANT ALL ON TABLE "public"."group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."group_members" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."user_conversations" TO "anon";
GRANT ALL ON TABLE "public"."user_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."user_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."user_settings" TO "anon";
GRANT ALL ON TABLE "public"."user_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_settings" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































