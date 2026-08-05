-- 抓取会话分组:一次抓取的各步骤共享 run_group;历史行保持 NULL(API 按单行自成组处理)

ALTER TABLE fetch_runs ADD COLUMN run_group TEXT;
CREATE INDEX idx_fetch_runs_group ON fetch_runs (run_group);
