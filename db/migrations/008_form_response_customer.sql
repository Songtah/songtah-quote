-- 2026-11-14：問卷回覆的技所／診所直接關聯客戶主檔（使用者同意：只新增欄位、不改既有資料）
-- customer_id＝客戶主檔 id（customers.notion_page_id 寫法）；match_note＝配對說明，「人工」開頭者自動配對永不覆蓋
alter table event_form_responses add column if not exists customer_id text;
alter table event_form_responses add column if not exists match_note text;
