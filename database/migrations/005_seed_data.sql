-- Default users
INSERT INTO users (email, name, role) VALUES
  ('andrew@primeplumbinggroup.com.au', 'Andrew', 'admin'),
  ('michael@primeplumbinggroup.com.au', 'Michael', 'estimator'),
  ('samuel@primeplumbinggroup.com.au', 'Samuel', 'estimator')
ON CONFLICT (email) DO NOTHING;
