# Gold and data change log

Every change to `eval/gold/` or `data/` after the dataset was frozen (Task 002 accepted, 2026-10-22).
Edits are made in `scripts/generate-data.ts` and regenerated; records, cards, edges and every table
except `work_orders.csv` are byte-identical before and after, so no record id moved.

## 2026-10-22 09:50 CDT — reviewer adjudication of Task 003 suspected gold errors

All entries below: **approved by reviewer** (Open Agent review session).

| question / file | field | old → new | reason | records |
|---|---|---|---|---|
| q-p3-rm02-hiss | expected_current_card | card.rm02.approve.v1 → card.rm02.reject | Approval seat rule: current = latest client decision on the seat | rec-0205, rec-0215 |
| q-p5-rm02-ids | expected_in_effect_card | card.rm02.reject → card.rm02.approve.v1 | Approval seat rule: in_effect = what is approved and binding; rejecting v3 does not undo the v1 approval | rec-0205, rec-0215 |
| q-p5-rm02-not-price | expected_in_effect_card | card.rm02.reject → card.rm02.approve.v1 | Same rule | rec-0205, rec-0215 |
| q-p7-rm02-inv | expected_current_card | card.rm02.approve.v1 → card.rm02.reject | Same rule | rec-0205, rec-0215 |
| q-p4-rm01-portal-still | expected_flags | [P4] → [] | A P4 warning means a rule in force was broken; this question only asks whether the rule is still in force, nothing was submitted | rec-0187 |
| q-p4-pw-quiet-still | expected_flags | [P4] → [] | Same | rec-0137 |
| q-p6-nl04-weather | expected_current_card, expected_in_effect_card | card.nl01.approve.v3 → null (both) | WO-NL-04 has no decision at 2026-04-03 09:25; the WO-NL-01 approval is a norm source, not the job's decision | rec-0016, rec-0061 |
| q-p6-nl04-weather | expected_norm_sources (new field) | — → card.nl01.approve.v1, v2, v3, card.nl02.approve.v1, card.nl03.approve.v1 | Norm sources recorded separately | rec-0002, rec-0008, rec-0013, rec-0025, rec-0040 |
| q-p1-oc03-valves | as_of | 2026-05-18T11:00:00-05:00 → 2026-05-18T11:16:00-05:00 | Was before Q-OC-03-v2 existed; moved to 1 minute after its submission | rec-0113 |
| q-p6-oc03-lump | expected_flags | [P6] → [P6, T10] | Lump sum decided 05-15, effective 06-01, asked 05-18: the T10 trap is present | rec-0091 |
| q-ctrl-rm03-v2-reason | expected_flags | [] → [T6] | Labor at the new rate, material kept, from one message; T6 is a time tag, not a warning | rec-0200, rec-0232 |
| q-t10-rm-june | as_of, question | 2026-06-02 "On 2 June" → 2026-05-31 "On 31 May" | 2 June is after the 06-01 effective date, so it was not a T10 trap; moved to the day before | rec-0200 |
| q-t10-rm-june | expected_in_effect_card, expected_reasons, expected_state, must_not_say | rm.labor.new → rm.labor.old; [new] → [old, new]; new_rate_in_effect → old_rate_in_effect_new_scheduled; "still use $88 on 2 June" → "$96/hr already applies on 31 May" | Recomputed for the new date | rec-0200 |
| data/tables/work_orders.csv | new column `trade` | — → electrical / plumbing / hvac / roofing / general per job | P6 norms are per client and trade | — |
| data/README.md | new sections | — → "Trades", "Approval seats: current vs in effect", "Warnings vs time tags" | Write down the rules the gold now follows | — |
| scripts/validate-data.ts | checks | CTRL "no flags" → "no warnings (time tags allowed)"; new: trade values, norm sources are approval cards decided by as_of | Follows the rules above | — |

## 2026-10-22 10:36 CDT — cost categories and client portals (P6 / P7 redesign)

Decision from the product owner's domain knowledge, relayed by the reviewer: a client portal accepts only a fixed set of
cost categories (labor, travel, material, freight, management) whatever the trade; trade-specific rates live
inside the labor amount. All entries below: **approved by reviewer**. Record ids unchanged (300 records,
same ids, types, timestamps and row keys); 16 record texts changed as listed.

| question / file | field | old → new | reason | records |
|---|---|---|---|---|
| data/tables/quote_lines.csv, invoice_lines.csv | new column `category` | — → labor / travel / material / freight / management (`kind` kept for the totals columns) | The category each line rolls up into on the client portal | — |
| quote_lines.csv, invoice_lines.csv | trip / mobilization lines | category labor → travel | A trip charge is travel on a client portal | Q-PW-03-v2, Q-RM-04-v2, INV-PW-03, INV-RM-04 rows |
| data/tables/clients.csv (new) | client_id, name, portal_categories | — → NL: labor;material;freight;management · OC: all five · PW: labor;material;freight · RM: labor;material;management | Which categories each client portal accepts ("no trip fees" = no travel category) | — |
| Q-NL-02-v1, v2, v3 | new line | + "Freight, 40gal heater delivery" freight 45.00 (totals 1398→1443, 1584→1629, 1754→1799) | Realistic freight line; the heater and tank lines the gold talks about are unchanged | quote records of Q-NL-02-v1..v3 |
| Q-PW-04-v1 | new line | + "Freight, compressor delivery" freight 95.00 (total 3432→3527) | Realistic freight on equipment; v2 (folded) and INV-PW-04 unchanged | quote record of Q-PW-04-v1 |
| Q-RM-03-v1, v2, INV-RM-03 | new line | + "Client portal packet and amp log upload" management 40.00 (418→458, 450→490, INV 418→458) | Realistic management line; v1→v2 still differs only in labor rate, invoice still matches v1 | quote/invoice records of Q-RM-03-v1, v2, INV-RM-03 |
| records, card.rm.rule.portal, q-p4-rm01-portal-still | wording | "civic portal" → "client portal" | Generic term only; no real portal product or vendor is named anywhere | card.rm.rule.portal (rec-0187) and the RM quote cover notes |
| quote / invoice record texts | line rendering | "N. labor: …" → "N. <category>: …" | Records show the category the client portal sees | the 16 changed records |
| data/README.md | new section | — → "Cost categories and the client portal" | Writes down the rules above and the two-part P6 norm | — |
| scripts/validate-data.ts | checks | + categories known and consistent with kind; + every work order's client in clients.csv; + every approved quote uses only categories its client portal accepts | Follows the rules above | — |
