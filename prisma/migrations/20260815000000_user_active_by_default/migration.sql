-- New users are active immediately unless a caller explicitly overrides status.
ALTER TABLE `User` MODIFY `status` BOOLEAN NOT NULL DEFAULT true;
