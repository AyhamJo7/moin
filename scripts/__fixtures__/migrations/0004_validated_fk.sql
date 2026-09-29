-- Violates: add-foreign-key-validated
ALTER TABLE tasks ADD CONSTRAINT tasks_contact_fk FOREIGN KEY (contact_id) REFERENCES contacts (id);
