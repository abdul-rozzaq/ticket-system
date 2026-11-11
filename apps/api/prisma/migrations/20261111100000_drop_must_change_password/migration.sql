-- Forced password change was removed (internal system: admins may know staff passwords).
ALTER TABLE "User" DROP COLUMN "mustChangePassword";
