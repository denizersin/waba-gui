-- Message Tracking Migration for WhatsApp Chat Application
-- Run these commands in your Supabase SQL Editor

-- 1. Add read status tracking to messages table
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- 2. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_messages_receiver_read ON messages(receiver_id, is_read);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(sender_id, receiver_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread_count ON messages(receiver_id, is_read) WHERE is_read = FALSE;

-- 3. Create a function to get unread message count for a user
CREATE OR REPLACE FUNCTION get_unread_count(user_id TEXT, other_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM messages 
    WHERE receiver_id = user_id 
    AND sender_id = other_user_id 
    AND is_read = FALSE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create a function to mark messages as read
CREATE OR REPLACE FUNCTION mark_messages_as_read(user_id TEXT, other_user_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE messages 
  SET is_read = TRUE, read_at = NOW()
  WHERE receiver_id = user_id 
  AND sender_id = other_user_id 
  AND is_read = FALSE;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create a view for user conversations with unread counts
CREATE OR REPLACE VIEW user_conversations AS
SELECT DISTINCT
  u.id,
  u.name,
  u.last_active,
  COALESCE(latest_msg.content, '') as last_message,
  COALESCE(latest_msg.timestamp, u.last_active) as last_message_time,
  COALESCE(latest_msg.message_type, 'text') as last_message_type,
  COALESCE(latest_msg.sender_id, '') as last_message_sender,
  COALESCE(unread_counts.unread_count, 0) as unread_count
FROM users u
LEFT JOIN LATERAL (
  SELECT content, timestamp, message_type, sender_id
  FROM messages m
  WHERE (m.sender_id = u.id OR m.receiver_id = u.id)
  ORDER BY m.timestamp DESC
  LIMIT 1
) latest_msg ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::INTEGER as unread_count
  FROM messages m
  WHERE m.receiver_id = auth.uid()::text
  AND m.sender_id = u.id
  AND m.is_read = FALSE
) unread_counts ON true
WHERE u.id != COALESCE(auth.uid()::text, '');

-- 6. Grant necessary permissions
GRANT EXECUTE ON FUNCTION get_unread_count(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_messages_as_read(TEXT, TEXT) TO authenticated;
GRANT SELECT ON user_conversations TO authenticated;

-- 7. Update RLS policies for the new columns
CREATE POLICY "Users can update message read status" ON messages
  FOR UPDATE USING (auth.uid()::text = receiver_id)
  WITH CHECK (auth.uid()::text = receiver_id);

-- 8. Create trigger to update user last_active when messages are sent
CREATE OR REPLACE FUNCTION update_user_last_active()
RETURNS TRIGGER AS $$
BEGIN
  -- Update sender's last_active
  UPDATE users 
  SET last_active = NEW.timestamp 
  WHERE id = NEW.sender_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_user_last_active ON messages;
CREATE TRIGGER trigger_update_user_last_active
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_user_last_active();

-- 9. Verify the migration
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default
FROM information_schema.columns 
WHERE table_name = 'messages' 
AND column_name IN ('is_read', 'read_at');

-- 10. Test the functions
SELECT 'Migration completed successfully' as status; 