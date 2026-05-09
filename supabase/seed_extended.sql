-- AuraQC expanded Supabase seed
-- Run this after the schema migration:
--   supabase db reset
-- or paste into the Supabase SQL editor for an existing project.

INSERT INTO public.complaint_clusters (
    cluster_id, title, sku, defect_family, count, first_seen, last_seen, confidence, severity, ai_summary
)
VALUES
    ('CL-971', 'Packaging Defect - Cereal Box', 'CER-BOX-77', 'Damage', 12, 'Oct 22, 2023', '1d ago', 0.60, 'Low', 'Likely transit damage, monitoring.'),
    ('CL-984', 'Sour Taste - 1% Milk', 'Dairy-M-01', 'Taste', 84, 'Oct 25, 2023', '5h ago', 0.89, 'Medium', '90% localized to Northeast distribution.'),
    ('CL-992', 'Foreign Object - Canned Beans', 'CB-15-ORG', 'Foreign Object', 142, 'Oct 24, 2023', '2h ago', 0.92, 'Critical', 'High confidence anomaly localized to Batch 402.'),
    ('CL-995', 'Seal Failure - Tomato Sauce Jar', 'TS-24-GLS', 'Packaging Integrity', 67, 'Nov 03, 2023', '48m ago', 0.87, 'High', 'Cap torque variation aligns with leakage complaints from two filling lines.'),
    ('CL-1001', 'Off-Odor - Greek Yogurt Cup', 'GY-PLN-05', 'Odor', 54, 'Nov 04, 2023', '2h ago', 0.83, 'Medium', 'Complaints cluster around one co-packer and late-week production.'),
    ('CL-1004', 'Undercooked Texture - Frozen Nuggets', 'FN-CH-12', 'Texture', 91, 'Nov 05, 2023', '31m ago', 0.90, 'High', 'Texture complaints correlate with oven zone 3 drift and specific shift windows.'),
    ('CL-1008', 'Bottle Cap Crack - Sports Drink', 'SD-BTL-18', 'Packaging Integrity', 46, 'Nov 06, 2023', '3h ago', 0.79, 'Medium', 'Cap brittleness appears higher on one resin lot shipped to Southeast DCs.'),
    ('CL-1012', 'Color Variation - Vanilla Ice Cream', 'IC-VAN-48', 'Appearance', 38, 'Nov 06, 2023', '6h ago', 0.74, 'Low', 'Shade inconsistency may be driven by mix aging and vanilla base variation.'),
    ('CL-1017', 'Burnt Flavor - Roasted Coffee Beans', 'CF-RST-22', 'Taste', 73, 'Nov 07, 2023', '1h ago', 0.86, 'High', 'Burnt-note complaints concentrate in lots roasted during one overnight maintenance window.'),
    ('CL-1021', 'Plastic Fragment - Bread Loaf', 'BR-WHT-09', 'Foreign Object', 29, 'Nov 07, 2023', '4h ago', 0.81, 'Critical', 'Evidence suggests slicer guard wear or bagging-line plastic shedding.'),
    ('CL-1026', 'Excess Foam - Sparkling Water', 'SW-LMN-16', 'Fill / Carbonation', 64, 'Nov 08, 2023', '22m ago', 0.84, 'Medium', 'Foaming events map to high line speed and warmer pallet staging conditions.'),
    ('CL-1030', 'Label Misprint - Allergy Warning Missing', 'CK-ALM-03', 'Labeling', 21, 'Nov 08, 2023', '5h ago', 0.95, 'Critical', 'Artwork version mismatch created a potential undeclared allergen risk.'),
    ('CL-1035', 'Soft Center - Protein Bar', 'PB-CHO-14', 'Texture', 58, 'Nov 09, 2023', '2h ago', 0.82, 'High', 'Moisture migration and cooling dwell inconsistency likely caused softness.'),
    ('CL-1040', 'Rust Specks - Canned Corn', 'CC-SWT-11', 'Foreign Object', 34, 'Nov 09, 2023', '7h ago', 0.77, 'High', 'Visual defect may be linked to seam corrosion or retort basket residue.'),
    ('CL-1044', 'Short Fill - Olive Oil Bottle', 'OO-EVO-75', 'Fill Level', 49, 'Nov 10, 2023', '54m ago', 0.88, 'High', 'Short-fill complaints are concentrated on filler head bank B.'),
    ('CL-1049', 'Sticky Surface - Candy Pouch', 'CD-FRT-20', 'Packaging / Handling', 41, 'Nov 10, 2023', '3h ago', 0.76, 'Medium', 'Outer pouch tackiness appears tied to warehouse heat exposure and seal seepage.'),
    ('CL-1053', 'Metallic Aftertaste - Energy Drink', 'ED-BRY-12', 'Taste', 57, 'Nov 11, 2023', '1h ago', 0.80, 'High', 'Aftertaste complaints are isolated to one flavor blend and aluminum can supplier lot.'),
    ('CL-1058', 'Mold Spot - Tortilla Pack', 'TR-FLR-10', 'Microbiological', 26, 'Nov 11, 2023', '6h ago', 0.91, 'Critical', 'Shelf-life failures point to seal-channel contamination or low preservative dosing.'),
    ('CL-1062', 'Broken Tablet - Dishwasher Pods Tub', 'DP-LEM-32', 'Physical Damage', 33, 'Nov 12, 2023', '2h ago', 0.72, 'Medium', 'Pods fracture rate is elevated for tubs stacked above recommended pallet height.'),
    ('CL-1068', 'Oil Separation - Peanut Butter Jar', 'PB-CRY-18', 'Appearance / Texture', 62, 'Nov 12, 2023', '35m ago', 0.78, 'Medium', 'Excess oil separation trends with long hold time before final homogenization.')
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
    ('TKT-9925', 'CL-992', 'Oct 26, 01:14 PM', 'My child found a silver shard in the beans. Keeping the can and photos for investigation.', 'Critical', 'CB-15-ORG'),
    ('TKT-9928', 'CL-992', 'Oct 26, 04:07 PM', 'Metallic piece lodged between the beans and nearly chipped a filling.', 'High Severity', 'CB-15-ORG'),
    ('TKT-9841', 'CL-984', 'Nov 04, 05:20 PM', 'Tastes like it expired weeks ago, but date is fine.', 'Medium', 'Dairy-M-01'),
    ('TKT-9844', 'CL-984', 'Nov 04, 08:11 PM', 'Opened a fresh carton and it smelled fermented right away.', 'Medium', 'Dairy-M-01'),
    ('TKT-9848', 'CL-984', 'Nov 05, 09:02 AM', 'Milk had a sour chemical taste on first sip and the kids refused to drink it.', 'High', 'Dairy-M-01'),
    ('TKT-9712', 'CL-971', 'Nov 02, 09:30 AM', 'The cereal box was completely crushed on the bottom left corner.', 'Low', 'CER-BOX-77'),
    ('TKT-9717', 'CL-971', 'Nov 02, 11:45 AM', 'Outer carton was ripped and dented though inner bag was still closed.', 'Low', 'CER-BOX-77'),
    ('TKT-9721', 'CL-971', 'Nov 03, 07:12 AM', 'Box corner was caved in before opening, looked like it took a hard impact.', 'Low', 'CER-BOX-77'),
    ('TKT-9951', 'CL-995', 'Nov 03, 07:35 AM', 'Jar leaked tomato sauce all over the box before I even opened it.', 'High', 'TS-24-GLS'),
    ('TKT-9954', 'CL-995', 'Nov 03, 09:18 AM', 'The lid was loose and there was dried sauce under the cap seal.', 'High', 'TS-24-GLS'),
    ('TKT-9957', 'CL-995', 'Nov 03, 01:40 PM', 'Several jars from the same case had sticky necks and bubbling near the lid.', 'Critical', 'TS-24-GLS'),
    ('TKT-10011', 'CL-1001', 'Nov 04, 10:22 AM', 'Yogurt smelled yeasty even though it was within date.', 'Medium', 'GY-PLN-05'),
    ('TKT-10014', 'CL-1001', 'Nov 04, 03:06 PM', 'There was a weird sulfur smell when I peeled the cup open.', 'Medium', 'GY-PLN-05'),
    ('TKT-10018', 'CL-1001', 'Nov 04, 06:41 PM', 'Flavor was fine but the odor was off enough that I threw the whole pack away.', 'Low', 'GY-PLN-05'),
    ('TKT-10041', 'CL-1004', 'Nov 05, 08:17 AM', 'The nuggets stayed mushy in the middle even after the full cook time.', 'High', 'FN-CH-12'),
    ('TKT-10044', 'CL-1004', 'Nov 05, 12:02 PM', 'Texture was gummy and undercooked compared with our usual purchases.', 'Medium', 'FN-CH-12'),
    ('TKT-10047', 'CL-1004', 'Nov 05, 06:10 PM', 'Multiple pieces were soft inside while the outside looked fully browned.', 'High', 'FN-CH-12'),
    ('TKT-10081', 'CL-1008', 'Nov 06, 09:44 AM', 'Cap cracked while twisting it open and liquid sprayed out.', 'Medium', 'SD-BTL-18'),
    ('TKT-10085', 'CL-1008', 'Nov 06, 02:09 PM', 'Bottle top had hairline cracks all around the tamper ring.', 'Medium', 'SD-BTL-18'),
    ('TKT-10089', 'CL-1008', 'Nov 06, 07:28 PM', 'Three bottles in one multipack had broken cap edges and leaked in transit.', 'High', 'SD-BTL-18'),
    ('TKT-10171', 'CL-1017', 'Nov 07, 08:03 AM', 'Coffee tasted scorched and bitter far beyond a dark roast profile.', 'High', 'CF-RST-22'),
    ('TKT-10174', 'CL-1017', 'Nov 07, 11:51 AM', 'Bag smelled burnt and ashy right after opening.', 'Medium', 'CF-RST-22'),
    ('TKT-10178', 'CL-1017', 'Nov 07, 05:32 PM', 'Flavor was overwhelmingly charred and not drinkable.', 'High', 'CF-RST-22'),
    ('TKT-10211', 'CL-1021', 'Nov 07, 09:12 AM', 'Found a clear plastic fragment baked into the end slice of the loaf.', 'Critical', 'BR-WHT-09'),
    ('TKT-10214', 'CL-1021', 'Nov 07, 01:07 PM', 'There was a hard plastic corner in the bread bag and crumbs around it.', 'High Severity', 'BR-WHT-09'),
    ('TKT-10218', 'CL-1021', 'Nov 07, 04:50 PM', 'Bit into something sharp and pulled out a tiny plastic piece.', 'Critical', 'BR-WHT-09'),
    ('TKT-10301', 'CL-1030', 'Nov 08, 10:18 AM', 'The cookie box did not show the almond warning anywhere on the front label.', 'Critical', 'CK-ALM-03'),
    ('TKT-10305', 'CL-1030', 'Nov 08, 01:26 PM', 'Allergy panel was missing from the package we purchased today.', 'Critical', 'CK-ALM-03'),
    ('TKT-10308', 'CL-1030', 'Nov 08, 05:11 PM', 'Packaging lists generic ingredients but no nut allergen statement at all.', 'Critical', 'CK-ALM-03'),
    ('TKT-10581', 'CL-1058', 'Nov 11, 08:08 AM', 'There was visible mold inside one corner of the tortilla pack before opening.', 'Critical', 'TR-FLR-10'),
    ('TKT-10584', 'CL-1058', 'Nov 11, 01:14 PM', 'Pack was still in date but had blue-green growth on one tortilla.', 'Critical', 'TR-FLR-10'),
    ('TKT-10588', 'CL-1058', 'Nov 11, 04:48 PM', 'Strong stale smell and mold spots under the folded edge.', 'High Severity', 'TR-FLR-10'),
    ('TKT-10681', 'CL-1068', 'Nov 12, 09:36 AM', 'There was a thick layer of oil floating on top even after stirring.', 'Medium', 'PB-CRY-18'),
    ('TKT-10684', 'CL-1068', 'Nov 12, 12:27 PM', 'Peanut butter separated badly and the texture underneath was dry and crumbly.', 'Medium', 'PB-CRY-18'),
    ('TKT-10687', 'CL-1068', 'Nov 12, 05:52 PM', 'Jar had excessive oil pooling compared with every other jar from this brand.', 'Low', 'PB-CRY-18')
ON CONFLICT (ticket_id) DO UPDATE
SET
    cluster_id = EXCLUDED.cluster_id,
    timestamp = EXCLUDED.timestamp,
    content = EXCLUDED.content,
    severity = EXCLUDED.severity,
    associated_sku = EXCLUDED.associated_sku;

INSERT INTO public.todo_items (cluster_id, text, status)
SELECT 'CL-995', 'Hold all tomato sauce jars packed on capper line 2 pending torque review.', 'completed'
WHERE NOT EXISTS (
    SELECT 1 FROM public.todo_items
    WHERE cluster_id = 'CL-995'
      AND text = 'Hold all tomato sauce jars packed on capper line 2 pending torque review.'
);

INSERT INTO public.todo_items (cluster_id, text, status)
SELECT 'CL-1004', 'Verify oven zone 3 temperature calibration records for the last 72 hours.', 'pending'
WHERE NOT EXISTS (
    SELECT 1 FROM public.todo_items
    WHERE cluster_id = 'CL-1004'
      AND text = 'Verify oven zone 3 temperature calibration records for the last 72 hours.'
);

INSERT INTO public.todo_items (cluster_id, text, status)
SELECT 'CL-1021', 'Inspect slicer guards and downstream bagger plastics for fragment loss.', 'pending'
WHERE NOT EXISTS (
    SELECT 1 FROM public.todo_items
    WHERE cluster_id = 'CL-1021'
      AND text = 'Inspect slicer guards and downstream bagger plastics for fragment loss.'
);

INSERT INTO public.todo_items (cluster_id, text, status)
SELECT 'CL-1030', 'Quarantine all cookie inventory carrying the suspect artwork revision.', 'completed'
WHERE NOT EXISTS (
    SELECT 1 FROM public.todo_items
    WHERE cluster_id = 'CL-1030'
      AND text = 'Quarantine all cookie inventory carrying the suspect artwork revision.'
);

INSERT INTO public.todo_items (cluster_id, text, status)
SELECT 'CL-1058', 'Review seal-jaw sanitation and preservative dosing logs for tortilla line B.', 'pending'
WHERE NOT EXISTS (
    SELECT 1 FROM public.todo_items
    WHERE cluster_id = 'CL-1058'
      AND text = 'Review seal-jaw sanitation and preservative dosing logs for tortilla line B.'
);

INSERT INTO public.resolution_records (
    cluster_id, draft_text, locked, challenge_notes, log_items_json
)
VALUES
    (
        'CL-995',
        'URGENT: Quality Control Notice - TS-24-GLS',
        FALSE,
        'Counterpoint: leakage may be amplified by glass finish variation instead of torque drift alone. Verify supplier dimensional data before finalizing root cause.',
        '[{"id":"seed-cl995-1","actor":"System","message":"Seeded expanded tomato sauce resolution workspace","status":"done","time":"Setup"}]'
    ),
    (
        'CL-1021',
        'URGENT: Quality Control Notice - BR-WHT-09',
        FALSE,
        'Counterpoint: fragments may originate from secondary packaging trim rather than the slicer assembly. Compare fragment composition before locking cause.',
        '[{"id":"seed-cl1021-1","actor":"System","message":"Seeded expanded bread foreign-object workspace","status":"done","time":"Setup"}]'
    ),
    (
        'CL-1030',
        'URGENT: Quality Control Notice - CK-ALM-03',
        TRUE,
        'Counterpoint: artwork file mismatch may not be limited to one SKU family. Audit adjacent label jobs before reopening released inventory.',
        '[{"id":"seed-cl1030-1","actor":"System","message":"Seeded critical labeling incident workspace","status":"done","time":"Setup"}]'
    ),
    (
        'CL-1058',
        'URGENT: Quality Control Notice - TR-FLR-10',
        FALSE,
        'Counterpoint: visible mold could be driven by retail abuse after distribution. Compare sealed pack headspace and storage history before final escalation.',
        '[{"id":"seed-cl1058-1","actor":"System","message":"Seeded microbiological shelf-life workspace","status":"done","time":"Setup"}]'
    )
ON CONFLICT (cluster_id) DO UPDATE
SET
    draft_text = EXCLUDED.draft_text,
    locked = EXCLUDED.locked,
    challenge_notes = EXCLUDED.challenge_notes,
    log_items_json = EXCLUDED.log_items_json;
