CREATE TYPE "UserRole" AS ENUM ('DUTY', 'ENGINEER', 'DIRECTOR');
CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "login" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");
