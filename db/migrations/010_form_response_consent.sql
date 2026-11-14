-- 2026-11-14：問卷個資告知同意紀錄（使用者要求；只新增欄位）
-- consent_at＝勾選同意的時間；consent_version＝當時告知內容版本（lib/privacy-notice.ts）；marketing_opt_in＝是否同意收行銷資訊
alter table event_form_responses add column if not exists consent_at timestamptz;
alter table event_form_responses add column if not exists consent_version text;
alter table event_form_responses add column if not exists marketing_opt_in boolean;
