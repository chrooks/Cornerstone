-- Catch additional reverse-order and slash-separated position variants
-- that were missed in the initial normalization migration.
UPDATE legends SET position = 'GF' WHERE position IN ('F-G', 'G/F', 'F/G');
UPDATE legends SET position = 'FC' WHERE position IN ('C-F', 'F-C', 'C/F', 'F/C');
