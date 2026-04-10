-- Normalize position values in the players table to the 9-position abbreviation
-- system. Same mappings as the legends normalization migrations.
-- Covers both orderings (e.g. G-F and F-G) and slash-separated variants.
UPDATE players SET position = 'G'  WHERE position IN ('PG-SG', 'SG-PG', 'PG/SG', 'SG/PG');
UPDATE players SET position = 'GF' WHERE position IN ('SG-SF', 'SF-SG', 'G-F', 'F-G', 'SG/SF', 'SF/SG', 'G/F', 'F/G');
UPDATE players SET position = 'F'  WHERE position IN ('SF-PF', 'PF-SF', 'SF/PF', 'PF/SF');
UPDATE players SET position = 'FC' WHERE position IN ('PF-C', 'C-PF', 'F-C', 'C-F', 'PF/C', 'C/PF', 'F/C', 'C/F');
