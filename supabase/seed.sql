INSERT INTO public.complaint_clusters (
    cluster_id, title, sku, defect_family, count, first_seen, last_seen, confidence, severity, ai_summary
)
VALUES
    ('CL-992', 'Foreign Object - Canned Beans', 'CB-15-ORG', 'Foreign Object', 142, 'Oct 24, 2023', '2h ago', 0.92, 'Critical', 'High confidence anomaly localized to Batch 402.'),
    ('CL-984', 'Sour Taste - 1% Milk', 'Dairy-M-01', 'Taste', 84, 'Oct 25, 2023', '5h ago', 0.89, 'Medium', '90% localized to Northeast distribution.'),
    ('CL-971', 'Packaging Defect - Cereal Box', 'CER-BOX-77', 'Damage', 12, 'Oct 22, 2023', '1d ago', 0.60, 'Low', 'Likely transit damage, monitoring.')
ON CONFLICT (cluster_id) DO UPDATE
SET
    title = EXCLUDED.title,
    sku = EXCLUDED.sku,
    defect_family = EXCLUDED.defect_family,
    count = EXCLUDED.count,
    first_seen = EXCLUDED.first_seen,
    last_seen = EXCLUDED.last_seen,
    confidence = EXCLUDED.confidence,
    severity = EXCLUDED.severity,
    ai_summary = EXCLUDED.ai_summary;

INSERT INTO public.investigation_tickets (
    ticket_id, cluster_id, timestamp, content, severity, associated_sku
)
VALUES
    ('TKT-8921', 'CL-992', 'Oct 26, 10:42 AM', 'Found a sharp piece of metal while eating my beans. Luckily I did not swallow it. Completely unacceptable.', 'High Severity', 'CB-15-ORG'),
    ('TKT-8894', 'CL-992', 'Oct 25, 03:15 PM', 'There was something hard in the can, almost broke a tooth. Need someone to call me back immediately.', 'Medium', 'CB-15-LOW'),
    ('TKT-8850', 'CL-992', 'Oct 24, 08:20 AM', 'Opened the can and noticed a strange metallic smell, poured it out and saw what looked like a machine screw at the bottom.', 'High Severity', 'CB-15-ORG'),
    ('TKT-9021', 'CL-971', 'Nov 02, 09:30 AM', 'The cereal box was completely crushed on the bottom left corner.', 'Low', 'CER-BOX-77'),
    ('TKT-9023', 'CL-984', 'Nov 04, 05:20 PM', 'Tastes like it expired weeks ago, but date is fine.', 'Medium', 'Dairy-M-01')
ON CONFLICT (ticket_id) DO UPDATE
SET
    cluster_id = EXCLUDED.cluster_id,
    timestamp = EXCLUDED.timestamp,
    content = EXCLUDED.content,
    severity = EXCLUDED.severity,
    associated_sku = EXCLUDED.associated_sku;

INSERT INTO public.todo_items (cluster_id, text, status)
SELECT 'CL-992', 'Quarantine Batch 402 inventory and verify all hold locations.', 'completed'
WHERE NOT EXISTS (
    SELECT 1 FROM public.todo_items
    WHERE cluster_id = 'CL-992'
      AND text = 'Quarantine Batch 402 inventory and verify all hold locations.'
);

INSERT INTO public.todo_items (cluster_id, text, status)
SELECT 'CL-992', 'Inspect filler line hardware for missing screws or metal fragments.', 'pending'
WHERE NOT EXISTS (
    SELECT 1 FROM public.todo_items
    WHERE cluster_id = 'CL-992'
      AND text = 'Inspect filler line hardware for missing screws or metal fragments.'
);

INSERT INTO public.resolution_records (
    cluster_id, draft_text, locked, challenge_notes, log_items_json
)
VALUES (
    'CL-992',
    'URGENT: Quality Control Notice - CB-15-ORG',
    FALSE,
    'Alternative explanation: the contamination could originate from downstream can handling instead of the filler head. Verify maintenance and packaging evidence before locking final cause.',
    '[{"id":"seed-1","actor":"System","message":"Seeded local resolution workspace","status":"done","time":"Setup"}]'
)
ON CONFLICT (cluster_id) DO UPDATE
SET
    draft_text = EXCLUDED.draft_text,
    locked = EXCLUDED.locked,
    challenge_notes = EXCLUDED.challenge_notes,
    log_items_json = EXCLUDED.log_items_json;
