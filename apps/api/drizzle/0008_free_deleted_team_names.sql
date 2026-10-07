UPDATE "teams" SET "name" = "name" || '~' || "id" WHERE "deleted_at" IS NOT NULL AND position('~' in "name") = 0;
