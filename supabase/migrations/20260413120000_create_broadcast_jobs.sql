CREATE TABLE IF NOT EXISTS public.broadcast_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id uuid REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  status text DEFAULT 'pending',
  total_messages integer DEFAULT 0,
  success_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Note: created_by should ideally be a foreign key to users, 
-- but we leave it as plain uuid if standard auth.users isn't heavily enforced or if users table is custom.

ALTER TABLE public.broadcast_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own broadcast jobs" ON public.broadcast_jobs
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Users can create their own broadcast jobs" ON public.broadcast_jobs
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update their own broadcast jobs" ON public.broadcast_jobs
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid());
