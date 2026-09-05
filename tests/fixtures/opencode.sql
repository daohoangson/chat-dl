-- Synthetic database; no exported account or conversation data.
CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, parent_id TEXT, time_created INTEGER, time_updated INTEGER);
CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
CREATE TABLE part (id TEXT PRIMARY KEY, session_id TEXT, message_id TEXT, data TEXT);
INSERT INTO session VALUES ('root', 'Synthetic session', '/synthetic/project', NULL, 1, 2), ('child', 'Scout', '/synthetic/project', 'root', 2, 3);
INSERT INTO message VALUES ('user', 'root', 1, '{"role":"user"}'), ('assistant', 'root', 2, '{"role":"assistant","modelID":"synthetic-model"}');
INSERT INTO part VALUES ('1', 'root', 'user', '{"type":"text","text":"Show an example."}'), ('2', 'root', 'assistant', '{"type":"reasoning","text":"Check formatting."}'), ('3', 'root', 'assistant', '{"type":"tool","tool":"read","state":{"status":"completed","input":{"path":"example.md"},"output":"Example:\n```md\nhello\n```"}}'), ('4', 'root', 'assistant', '{"type":"text","text":"Done."}');
