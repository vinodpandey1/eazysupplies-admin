CREATE TABLE `order_idempotency` (
    `key` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `userId` INTEGER NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PROCESSING',
    `orderId` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,

    UNIQUE INDEX `order_idempotency_orderId_key`(`orderId`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
