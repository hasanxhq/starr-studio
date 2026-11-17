ALTER TABLE requests ADD COLUMN alt_item TEXT;
CREATE INDEX requests_alt_item ON requests (alt_item);