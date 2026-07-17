CREATE TABLE canvas_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canvas_instance_url text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  canvas_user_id text NOT NULL,
  canvas_user_name text,
  canvas_user_email text,
  selected_course_id text,
  selected_course_name text,
  selected_assignment_id text,
  selected_assignment_name text,
  last_synced_at timestamptz,
  connected_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX idx_canvas_integrations_user_id ON canvas_integrations(user_id);
