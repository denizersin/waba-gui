-- Database Migration Script for Media Messages Support
-- Run this in your Supabase SQL Editor

-- Add new columns to the messages table
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text',
ADD COLUMN IF NOT EXISTS media_data JSONB;

-- Create an index on message_type for better query performance
CREATE INDEX IF NOT EXISTS idx_messages_message_type ON messages(message_type);

-- Create an index on media_data for JSONB queries
CREATE INDEX IF NOT EXISTS idx_messages_media_data ON messages USING GIN (media_data);

-- Update existing messages to have message_type = 'text' if NULL
UPDATE messages 
SET message_type = 'text' 
WHERE message_type IS NULL;

-- Add a comment to document the new columns
COMMENT ON COLUMN messages.message_type IS 'Type of message: text, image, document, audio, video, sticker';
COMMENT ON COLUMN messages.media_data IS 'JSON data containing media information like URLs, filenames, etc.';

-- Optional: Create a check constraint to ensure valid message types
ALTER TABLE messages 
ADD CONSTRAINT check_message_type 
CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'sticker'));

-- Show the updated table structure
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'messages' 
ORDER BY ordinal_position; 