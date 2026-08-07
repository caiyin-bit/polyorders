-- 门禁码改为明文存储,过期即清。
--
-- 原设计只存哈希,明文仅在批准那一刻通过一次出站调用送给管理员。实测
-- VPS 到 api.telegram.org 有约 17% 间断超时,那次调用一失败,码就永久丢失,
-- 除重新申请外无法补救——安全强度用在了错地方,可用性却完全崩掉。
--
-- 权衡:这是一个 30 分钟失效、只授予只读权限的临时码,不是密码。明文入库
-- 换来的是管理员可在面板上随时查看与重发,以及不依赖任何单一通道。

ALTER TABLE access_requests ADD COLUMN code TEXT;
ALTER TABLE access_requests DROP COLUMN code_hash;
