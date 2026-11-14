-- 2026-11-14：告知頁上線前填寫的問卷「補告知」（使用者選定）。只新增欄位。
-- notice_sent_at＝行政寄出補告知信的時間（人工標記）；consent_source＝同意來源：'form' 填寫時勾選、'renotice' 補告知連結勾選
alter table event_form_responses add column if not exists notice_sent_at timestamptz;
alter table event_form_responses add column if not exists consent_source text;
update event_form_responses set consent_source = 'form' where consent_at is not null and consent_source is null;
